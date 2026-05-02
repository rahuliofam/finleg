/**
 * Resend Inbound Email Webhook — entry point for emails sent to
 * `agent@finleg.net`. For each processable attachment (PDF or image):
 *   1. Fetch the email + attachment bytes from Resend.
 *   2. Classify PDFs via Gemini 2.5 Flash as statement vs receipt.
 *   3. Statements → store in `statements` bucket + insert into `statement_inbox`.
 *   4. Receipts → parse with Claude Haiku, store in `receipts` bucket, attempt
 *      to auto-match against an existing `qb_transactions` row (score >= 0.5).
 *   5. Email the sender a branded summary BCC'd to the forward address.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const RESEND_API_URL = "https://api.resend.com";
const FORWARD_TO = "rahchak@gmail.com";
const FROM_ADDRESS = "agent@finleg.net";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta";

const CLASSIFICATION_PROMPT = `Analyze this PDF document. Determine if it is a financial STATEMENT (bank statement, credit card statement, brokerage/investment statement, loan statement, HELOC statement, mortgage statement) or a RECEIPT/INVOICE (a record of a single purchase or payment).

If it is a STATEMENT, extract:
- institution: lowercase slug (e.g. "amex", "chase", "schwab", "us-bank", "apple", "robinhood", "pnc", "bank-of-america", "coinbase", "wells-fargo")
- account_type: one of "credit-card", "checking", "brokerage", "ira", "crypto", "heloc", "auto-loan", "mortgage", "credit-line"
- account_name: human-readable name (e.g. "Blue Cash Preferred", "Brokerage Account")
- account_number: last 4 digits only (e.g. "4206")
- account_holder: name on account
- statement_date: closing/statement date as "YYYY-MM-DD"
- period_start: "YYYY-MM-DD"
- period_end: "YYYY-MM-DD"

Return ONLY valid JSON, no markdown fences:
{"doc_type": "statement", "institution": "...", "account_type": "...", "account_name": "...", "account_number": "...", "account_holder": "...", "statement_date": "YYYY-MM-DD", "period_start": "YYYY-MM-DD", "period_end": "YYYY-MM-DD", "confidence": 0.95}

If it is a RECEIPT/INVOICE or you cannot determine, return:
{"doc_type": "receipt", "confidence": 0.95}

If you truly cannot tell what this document is, return:
{"doc_type": "unknown", "confidence": 0.0}`;

/**
 * Fetch the full email content from Resend API.
 */
async function fetchEmailContent(emailId: string, apiKey: string, attempt = 1): Promise<any> {
  const maxAttempts = 5;
  const res = await fetch(`${RESEND_API_URL}/emails/receiving/${emailId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const text = await res.text();
    if (attempt < maxAttempts) {
      console.log(`Fetch attempt ${attempt} failed (${res.status}), retrying in 2s...`);
      await new Promise((r) => setTimeout(r, 2000));
      return fetchEmailContent(emailId, apiKey, attempt + 1);
    }
    throw new Error(`Failed to fetch email ${emailId}: ${res.status} ${text}`);
  }

  const email = await res.json();

  // Resend webhook fires before attachments are fully processed.
  // If the email has no attachments yet, retry with increasing delays.
  if ((!email.attachments || email.attachments.length === 0) && attempt < maxAttempts) {
    const delay = attempt * 2000; // 2s, 4s, 6s, 8s
    console.log(`No attachments on attempt ${attempt}, retrying in ${delay}ms...`);
    await new Promise((r) => setTimeout(r, delay));
    return fetchEmailContent(emailId, apiKey, attempt + 1);
  }

  return email;
}

/**
 * Fetch attachments separately via the List Attachments endpoint.
 * Fallback when the email response doesn't include attachments.
 */
async function fetchAttachmentsList(emailId: string, apiKey: string): Promise<any[]> {
  const res = await fetch(
    `${RESEND_API_URL}/emails/receiving/${emailId}/attachments`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  if (!res.ok) {
    console.error(`List attachments failed: ${res.status}`);
    return [];
  }
  const data = await res.json();
  return data.data || [];
}

/**
 * Send a processing summary email after all attachments have been processed.
 */
async function sendSummaryEmail(
  original: any,
  apiKey: string,
  processedStatements: any[],
  processedReceipts: any[]
): Promise<void> {
  const fromLine = typeof original.from === "string"
    ? original.from
    : original.from?.[0]?.address || original.from?.[0] || "unknown sender";

  const totalProcessed = processedStatements.length + processedReceipts.length;
  const errors = processedStatements.filter((s: any) => s.error).length +
    processedReceipts.filter((r: any) => r.error).length;

  // Build subject line
  const parts: string[] = [];
  if (processedStatements.length > 0) {
    parts.push(`${processedStatements.length} statement${processedStatements.length > 1 ? "s" : ""}`);
  }
  if (processedReceipts.length > 0) {
    parts.push(`${processedReceipts.length} receipt${processedReceipts.length > 1 ? "s" : ""}`);
  }
  const subject = totalProcessed > 0
    ? `Processed ${parts.join(" & ")} from ${fromLine}`
    : `No attachments processed from ${fromLine}`;

  // Build HTML body
  let html = `<div style="font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">`;
  html += `<h2 style="margin-bottom: 4px;">📬 Import Summary</h2>`;
  html += `<p style="color: #666; margin-top: 0;">From <strong>${fromLine}</strong> · ${new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>`;

  if (processedStatements.length > 0) {
    html += `<h3 style="border-bottom: 1px solid #e5e5e5; padding-bottom: 4px;">Statements (${processedStatements.length})</h3>`;
    for (const stmt of processedStatements) {
      if (stmt.error) {
        html += `<p style="color: #dc2626;">❌ Error: ${stmt.error}</p>`;
      } else {
        const institution = (stmt.institution || "unknown").replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
        const accountType = (stmt.account_type || "").replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
        const acctLabel = stmt.account_name || accountType;
        const sizeKb = stmt.attachment_size ? `${(stmt.attachment_size / 1024).toFixed(1)} KB` : "—";
        const period = stmt.period_start && stmt.period_end
          ? `${stmt.period_start} → ${stmt.period_end}`
          : "—";

        // Document metadata card
        const metaRow = (label: string, value: string) =>
          `<tr><td style="padding: 3px 8px; color: #666; font-size: 13px; white-space: nowrap;">${label}</td><td style="padding: 3px 8px; font-size: 13px;">${value}</td></tr>`;

        html += `<div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin-bottom: 12px;">`;
        html += `<div style="font-weight: 600; margin-bottom: 8px;">📄 ${stmt.filename || "Statement"}</div>`;
        html += `<table style="border-collapse: collapse; font-size: 14px;">`;
        html += metaRow("Category", "Statement");
        html += metaRow("Account", acctLabel);
        html += metaRow("Institution", institution);
        html += metaRow("Account Type", accountType);
        if (stmt.account_holder) html += metaRow("Holder", stmt.account_holder);
        html += metaRow("Date", stmt.statement_date || "—");
        html += metaRow("Period", period);
        html += metaRow("Size", sizeKb);
        html += metaRow("Type", "PDF");
        html += `</table>`;
        html += `</div>`;
      }
    }
  }

  if (processedReceipts.length > 0) {
    html += `<h3 style="border-bottom: 1px solid #e5e5e5; padding-bottom: 4px;">Receipts (${processedReceipts.length})</h3>`;
    html += `<table style="width: 100%; border-collapse: collapse; font-size: 14px;">`;
    html += `<tr style="background: #f5f5f5; text-align: left;"><th style="padding: 6px 8px;">Vendor</th><th style="padding: 6px 8px;">Amount</th><th style="padding: 6px 8px;">Status</th></tr>`;
    for (const rcpt of processedReceipts) {
      if (rcpt.error) {
        html += `<tr><td colspan="3" style="padding: 6px 8px; color: #dc2626;">❌ Error: ${rcpt.error}</td></tr>`;
      } else {
        const amount = rcpt.amount != null ? `$${Number(rcpt.amount).toFixed(2)}` : "—";
        const status = rcpt.matched ? "✅ Matched" : "⏳ Unmatched";
        html += `<tr style="border-bottom: 1px solid #eee;">`;
        html += `<td style="padding: 6px 8px;">${rcpt.vendor || "Unknown"}</td>`;
        html += `<td style="padding: 6px 8px;">${amount}</td>`;
        html += `<td style="padding: 6px 8px;">${status}</td>`;
        html += `</tr>`;
      }
    }
    html += `</table>`;
  }

  if (totalProcessed === 0) {
    html += `<p style="color: #666;">No statements or receipts found in the email attachments.</p>`;
  }

  if (errors > 0) {
    html += `<p style="color: #dc2626; margin-top: 12px;">⚠️ ${errors} attachment${errors > 1 ? "s" : ""} had processing errors.</p>`;
  }

  html += `<p style="margin-top: 16px; font-size: 13px; color: #999;"><a href="https://finleg.net/intranet/bookkeeping/statements" style="color: #2563eb;">View in Finleg →</a></p>`;
  html += `</div>`;

  const res = await fetch(`${RESEND_API_URL}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [fromLine],
      bcc: [FORWARD_TO],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to send summary email: ${res.status} ${text}`);
  }

  const result = await res.json();
  console.log(`Summary email sent to ${FORWARD_TO}, Resend ID: ${result.id}`);
}

/**
 * Download attachment content from Resend API.
 * Resend doesn't inline attachment data — we must fetch it separately.
 */
async function fetchAttachmentContent(
  emailId: string,
  attachmentId: string,
  apiKey: string
): Promise<{ base64: string; bytes: Uint8Array }> {
  // Step 1: Get the download URL
  const metaRes = await fetch(
    `${RESEND_API_URL}/emails/receiving/${emailId}/attachments/${attachmentId}`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  if (!metaRes.ok) {
    const text = await metaRes.text();
    throw new Error(`Resend attachment meta error: ${metaRes.status} ${text}`);
  }
  const meta = await metaRes.json();
  const downloadUrl = meta.download_url;
  if (!downloadUrl) throw new Error("No download_url in attachment metadata");

  // Step 2: Download the actual file
  const fileRes = await fetch(downloadUrl);
  if (!fileRes.ok) {
    throw new Error(`Attachment download error: ${fileRes.status}`);
  }
  const arrayBuffer = await fileRes.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // Step 3: Convert to base64
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const base64 = btoa(binary);

  return { base64, bytes };
}

/**
 * Classify a PDF attachment using Gemini Flash 2.5.
 * Returns classification JSON with doc_type, institution, account_type, etc.
 */
async function classifyWithGemini(
  base64Data: string,
  geminiKey: string
): Promise<any> {
  const res = await fetch(
    `${GEMINI_API_URL}/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: "application/pdf", data: base64Data } },
            { text: CLASSIFICATION_PROMPT },
          ],
        }],
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error: ${res.status} ${text}`);
  }

  const result = await res.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";

  // Extract JSON from response (handle markdown fences)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("No JSON found in Gemini response:", text.slice(0, 300));
    return { doc_type: "unknown", confidence: 0 };
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    console.error("Failed to parse Gemini JSON:", jsonMatch[0].slice(0, 300));
    return { doc_type: "unknown", confidence: 0 };
  }
}

/**
 * Store a statement PDF in Supabase Storage (statements bucket).
 */
async function storeStatementAttachment(
  supabase: any,
  filename: string,
  data: Uint8Array,
  contentType: string
): Promise<string> {
  const path = `inbox/${Date.now()}_${filename}`;

  const { error } = await supabase.storage
    .from("statements")
    .upload(path, data, { contentType, upsert: false });

  if (error) {
    if (error.message?.includes("not found") || error.statusCode === 404) {
      console.log("Creating statements storage bucket...");
      await supabase.storage.createBucket("statements", { public: true });
      const { error: retryError } = await supabase.storage
        .from("statements")
        .upload(path, data, { contentType, upsert: false });
      if (retryError) throw retryError;
    } else {
      throw error;
    }
  }

  const { data: urlData } = supabase.storage.from("statements").getPublicUrl(path);
  return urlData.publicUrl;
}

/**
 * Parse a receipt image/PDF using Claude API.
 */
async function parseReceiptWithClaude(
  attachmentBase64: string,
  mediaType: string,
  emailSubject: string,
  emailBody: string,
  anthropicKey: string
): Promise<any> {
  const isImage = mediaType.startsWith("image/");
  const isPdf = mediaType === "application/pdf";

  const content: any[] = [];

  if (isImage) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: attachmentBase64 },
    });
  } else if (isPdf) {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: attachmentBase64 },
    });
  }

  content.push({
    type: "text",
    text: `Parse this receipt/invoice and extract the following as JSON:
{
  "vendor": "store/company name",
  "amount": 0.00,
  "date": "YYYY-MM-DD",
  "category": "best category guess (e.g. Office Supplies, Meals & Entertainment, Software, Travel, Professional Services, Utilities, etc.)",
  "tax": 0.00,
  "payment_method": "card type or last 4 digits if visible",
  "line_items": [{"description": "item", "amount": 0.00, "quantity": 1}],
  "confidence": 0.95
}

Email subject was: "${emailSubject}"
Email body snippet: "${emailBody?.slice(0, 500) || "(none)"}"

If the subject contains a category hint (e.g. "meals" or "office supplies"), use that as the category.
Return ONLY valid JSON, no markdown.`,
  });

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API error: ${res.status} ${text}`);
  }

  const result = await res.json();
  const text = result.content?.[0]?.text || "";

  try {
    return JSON.parse(text);
  } catch {
    console.error("Failed to parse Claude response as JSON:", text);
    return { raw_text: text, confidence: 0 };
  }
}

/**
 * Store attachment in Supabase Storage and return the public URL.
 */
async function storeAttachment(
  supabase: any,
  filename: string,
  data: Uint8Array,
  contentType: string
): Promise<string> {
  const path = `receipts/${Date.now()}_${filename}`;

  const { error } = await supabase.storage
    .from("receipts")
    .upload(path, data, { contentType, upsert: false });

  if (error) {
    // If bucket doesn't exist, create it
    if (error.message?.includes("not found") || error.statusCode === 404) {
      console.log("Creating receipts storage bucket...");
      await supabase.storage.createBucket("receipts", { public: true });
      const { error: retryError } = await supabase.storage
        .from("receipts")
        .upload(path, data, { contentType, upsert: false });
      if (retryError) throw retryError;
    } else {
      throw error;
    }
  }

  const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(path);
  return urlData.publicUrl;
}

/**
 * Try to match a receipt to an unmatched QB transaction. Searches within
 * a ±5-day window, scores candidates: exact amount 0.6 (close ±$1 = 0.3,
 * else skip), date proximity up to 0.2, vendor substring match 0.2. Returns
 * the best candidate only if final score >= 0.5.
 */
async function tryMatchTransaction(
  supabase: any,
  amount: number,
  date: string,
  vendor: string
): Promise<{ qb_txn_id: string; confidence: number } | null> {
  if (!amount || !date) return null;

  // Look for transactions within ±5 days with matching amount
  const { data: candidates } = await supabase
    .from("qb_transactions")
    .select("id, txn_date, amount, vendor_name, receipt_id")
    .is("receipt_id", null)
    .gte("txn_date", shiftDate(date, -5))
    .lte("txn_date", shiftDate(date, 5))
    .order("txn_date", { ascending: false });

  if (!candidates?.length) return null;

  // Score candidates
  let bestMatch: any = null;
  let bestScore = 0;

  for (const txn of candidates) {
    let score = 0;
    const txnAmount = Math.abs(parseFloat(txn.amount));
    const receiptAmount = Math.abs(amount);

    // Exact amount match = 0.6
    if (Math.abs(txnAmount - receiptAmount) < 0.01) {
      score += 0.6;
    } else if (Math.abs(txnAmount - receiptAmount) < 1.0) {
      score += 0.3; // Close amount (rounding)
    } else {
      continue; // Skip if amounts don't match at all
    }

    // Date proximity (0-0.2)
    const daysDiff = Math.abs(daysBetween(date, txn.txn_date));
    score += Math.max(0, 0.2 - daysDiff * 0.04);

    // Vendor name similarity (0-0.2)
    if (vendor && txn.vendor_name) {
      const vendorLower = vendor.toLowerCase();
      const txnVendorLower = txn.vendor_name.toLowerCase();
      if (txnVendorLower.includes(vendorLower) || vendorLower.includes(txnVendorLower)) {
        score += 0.2;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = txn;
    }
  }

  if (bestMatch && bestScore >= 0.5) {
    return { qb_txn_id: bestMatch.id, confidence: Math.round(bestScore * 100) / 100 };
  }

  return null;
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  return Math.round((da.getTime() - db.getTime()) / 86400000);
}

/**
 * Log an activity.
 */
async function logActivity(
  supabase: any,
  action: string,
  entityType: string,
  entityId: string,
  actor: string,
  details: any
) {
  await supabase.from("bookkeeping_activity_log").insert({
    action,
    entity_type: entityType,
    entity_id: entityId,
    actor,
    details,
  });
}

/**
 * Extract category hint from email subject.
 * e.g. "Office Supplies" or "meals" in the subject line.
 */
function extractCategoryFromSubject(subject: string): string | null {
  if (!subject) return null;
  // Common category keywords
  const categories: Record<string, string> = {
    meals: "Meals & Entertainment",
    meal: "Meals & Entertainment",
    dinner: "Meals & Entertainment",
    lunch: "Meals & Entertainment",
    food: "Meals & Entertainment",
    restaurant: "Meals & Entertainment",
    office: "Office Supplies",
    supplies: "Office Supplies",
    software: "Software & Subscriptions",
    subscription: "Software & Subscriptions",
    travel: "Travel",
    flight: "Travel",
    hotel: "Travel",
    uber: "Travel",
    lyft: "Travel",
    gas: "Auto & Transport",
    parking: "Auto & Transport",
    professional: "Professional Services",
    legal: "Professional Services",
    accounting: "Professional Services",
    utilities: "Utilities",
    electric: "Utilities",
    internet: "Utilities",
    phone: "Utilities",
    insurance: "Insurance",
    medical: "Medical & Health",
    health: "Medical & Health",
  };

  const lower = subject.toLowerCase();
  for (const [keyword, category] of Object.entries(categories)) {
    if (lower.includes(keyword)) return category;
  }
  return null;
}

// ============================================================
// Document Request Handler
// ============================================================

const DOC_REQUEST_PROMPT = `You are analyzing an email sent to a document retrieval agent. The sender is requesting a document from our file vault.

Extract the following from the email body:
- person_name: who the document belongs to (the person mentioned, NOT necessarily the sender)
- doc_type: what type of document (e.g. "tax return", "bank statement", "1099", "credit report", "insurance", "brokerage statement", etc.)
- year: the tax year or document year (number, e.g. 2023)
- institution: if mentioned, the bank/brokerage/institution name
- account_type: if mentioned (checking, credit-card, brokerage, ira, etc.)
- any other filtering details

If this does NOT look like a document request (it's spam, a forwarded receipt, etc.), set is_request to false.

Return ONLY valid JSON, no markdown fences:
{"is_request": true, "person_name": "...", "doc_type": "...", "year": 2023, "institution": null, "account_type": null, "search_keywords": ["tax", "return"]}`;

/**
 * Parse a document request from email body using Gemini Flash 2.5.
 */
async function parseDocumentRequest(
  emailBody: string,
  emailSubject: string,
  geminiKey: string
): Promise<any> {
  const prompt = `Subject: ${emailSubject || "(none)"}\n\nBody:\n${emailBody.slice(0, 2000)}\n\n${DOC_REQUEST_PROMPT}`;

  const res = await fetch(
    `${GEMINI_API_URL}/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error: ${res.status} ${text}`);
  }

  const result = await res.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { is_request: false };

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return { is_request: false };
  }
}

/**
 * Resolve a person name to canonical account_holder using person_aliases table.
 * Also returns partial matches on the name for filename searching.
 */
async function resolvePersonName(
  supabase: any,
  personName: string
): Promise<{ canonical: string | null; searchNames: string[] }> {
  const nameLower = personName.toLowerCase().trim();

  // Try exact alias match
  const { data: aliasMatch } = await supabase
    .from("person_aliases")
    .select("canonical_name")
    .eq("alias", nameLower)
    .limit(1)
    .single();

  if (aliasMatch) {
    // Get all aliases for this canonical name (for filename searching)
    const { data: allAliases } = await supabase
      .from("person_aliases")
      .select("alias")
      .eq("canonical_name", aliasMatch.canonical_name);

    const searchNames = [
      aliasMatch.canonical_name,
      ...(allAliases || []).map((a: any) => a.alias),
    ];
    return { canonical: aliasMatch.canonical_name, searchNames };
  }

  // Try partial match (contains)
  const { data: partialMatches } = await supabase
    .from("person_aliases")
    .select("canonical_name, alias")
    .ilike("alias", `%${nameLower}%`)
    .limit(5);

  if (partialMatches?.length > 0) {
    const canonical = partialMatches[0].canonical_name;
    const { data: allAliases } = await supabase
      .from("person_aliases")
      .select("alias")
      .eq("canonical_name", canonical);

    const searchNames = [
      canonical,
      ...(allAliases || []).map((a: any) => a.alias),
    ];
    return { canonical, searchNames };
  }

  // No match — use the raw name for searching
  return { canonical: null, searchNames: [personName] };
}

/**
 * Search document_index for matching documents.
 */
async function searchDocuments(
  supabase: any,
  canonical: string | null,
  searchNames: string[],
  request: any
): Promise<any[]> {
  // Build the query — search by account_holder AND/OR filename
  let query = supabase
    .from("document_index")
    .select("id, filename, bucket, r2_key, category, account_type, account_holder, year, institution, file_type, file_size")
    .order("year", { ascending: false });

  // Filter by year if specified
  if (request.year) {
    query = query.eq("year", request.year);
  }

  // Filter by doc_type mapping
  const docType = (request.doc_type || "").toLowerCase();
  if (docType.includes("tax return") || docType.includes("tax filing")) {
    query = query.in("account_type", ["tax-return", "tax"]);
  } else if (docType.includes("1099")) {
    query = query.in("account_type", ["1099", "tax-1099"]);
  } else if (docType.includes("bank statement") || docType.includes("checking")) {
    query = query.eq("account_type", "checking");
    query = query.eq("category", "statement");
  } else if (docType.includes("credit card")) {
    query = query.eq("account_type", "credit-card");
    query = query.eq("category", "statement");
  } else if (docType.includes("brokerage")) {
    query = query.eq("account_type", "brokerage");
    query = query.eq("category", "statement");
  } else if (docType.includes("credit report")) {
    query = query.eq("category", "credit-report");
  } else if (docType.includes("insurance")) {
    query = query.eq("category", "insurance");
  }

  // Filter by institution if specified
  if (request.institution) {
    query = query.ilike("institution", `%${request.institution}%`);
  }

  const { data: results, error } = await query.limit(50);
  if (error || !results) return [];

  // Score and filter results by person name relevance
  const scored = results.map((doc: any) => {
    let score = 0;
    const filenameLower = (doc.filename || "").toLowerCase();
    const holderLower = (doc.account_holder || "").toLowerCase();

    // Check account_holder match
    if (canonical && holderLower === canonical.toLowerCase()) {
      score += 10;
    }

    // Check filename contains any of the search names
    for (const name of searchNames) {
      const nameParts = name.toLowerCase().split(" ");
      if (filenameLower.includes(name.toLowerCase())) {
        score += 8;
      } else {
        // Check individual name parts (e.g., "Sonnad Hannah" in filename)
        const matchedParts = nameParts.filter((p: string) => p.length > 2 && filenameLower.includes(p));
        score += matchedParts.length * 3;
      }
    }

    return { ...doc, _score: score };
  });

  // Filter to docs with score > 0 and sort by score descending
  return scored
    .filter((d: any) => d._score > 0)
    .sort((a: any, b: any) => b._score - a._score)
    .slice(0, 5);
}

/**
 * Download a file from R2 using S3-compatible API.
 */
async function downloadFromR2(
  bucket: string,
  r2Key: string
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const accountId = Deno.env.get("R2_ACCOUNT_ID");
  const accessKey = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretKey = Deno.env.get("R2_SECRET_ACCESS_KEY");

  if (!accountId || !accessKey || !secretKey) {
    console.error("R2 credentials not set");
    return null;
  }

  const aws = new AwsClient({
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    region: "auto",
    service: "s3",
  });

  const url = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${r2Key}`;
  const res = await aws.fetch(url);

  if (!res.ok) {
    console.error(`R2 download failed: ${res.status} for ${r2Key}`);
    return null;
  }

  const arrayBuffer = await res.arrayBuffer();
  return {
    bytes: new Uint8Array(arrayBuffer),
    contentType: res.headers.get("content-type") || "application/octet-stream",
  };
}

/**
 * Send a document retrieval response email.
 */
async function sendDocumentEmail(
  to: string,
  apiKey: string,
  request: any,
  documents: any[],
  attachments: { filename: string; content: string; type: string }[]
): Promise<void> {
  let html = `<div style="font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">`;
  html += `<h2 style="margin-bottom: 4px;">📁 Document Request</h2>`;

  if (documents.length === 0) {
    html += `<p>I couldn't find any documents matching your request. Here's what I understood:</p>`;
    html += `<ul>`;
    html += `<li><strong>Person:</strong> ${request.person_name || "unknown"}</li>`;
    html += `<li><strong>Document type:</strong> ${request.doc_type || "unknown"}</li>`;
    if (request.year) html += `<li><strong>Year:</strong> ${request.year}</li>`;
    html += `</ul>`;
    html += `<p>Try being more specific, or reply with a correction.</p>`;
  } else {
    html += `<p>Found ${documents.length} matching document${documents.length > 1 ? "s" : ""}:</p>`;

    for (const doc of documents) {
      const sizeKb = doc.file_size ? `${(doc.file_size / 1024).toFixed(0)} KB` : "—";
      html += `<div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin-bottom: 12px;">`;
      html += `<div style="font-weight: 600;">📄 ${doc.filename}</div>`;
      html += `<div style="font-size: 13px; color: #666; margin-top: 4px;">`;
      html += `${doc.category} · ${doc.account_type} · ${doc.year || "—"} · ${sizeKb}`;
      html += `</div>`;
      html += `</div>`;
    }

    if (attachments.length > 0) {
      html += `<p style="color: #16a34a; font-weight: 600;">✅ ${attachments.length} file${attachments.length > 1 ? "s" : ""} attached to this email.</p>`;
    }
    if (attachments.length < documents.length) {
      html += `<p style="color: #666; font-size: 13px;">Some files could not be attached (too large or unavailable). Contact admin for help.</p>`;
    }
  }

  html += `<p style="margin-top: 16px; font-size: 13px; color: #999;">Sent by Finleg Document Agent</p>`;
  html += `</div>`;

  const emailPayload: any = {
    from: FROM_ADDRESS,
    to: [to],
    bcc: [FORWARD_TO],
    subject: documents.length > 0
      ? `📁 ${request.doc_type || "Document"} — ${request.person_name || ""}${request.year ? ` (${request.year})` : ""}`
      : `📁 Document not found — ${request.person_name || "unknown"}`,
    html,
  };

  // Attach files (Resend supports base64 attachments)
  if (attachments.length > 0) {
    emailPayload.attachments = attachments.map((a) => ({
      filename: a.filename,
      content: a.content, // base64 string
      content_type: a.type,
    }));
  }

  const res = await fetch(`${RESEND_API_URL}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(emailPayload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to send document email: ${res.status} ${text}`);
  }

  const result = await res.json();
  console.log(`Document email sent to ${to}, Resend ID: ${result.id}`);
}

/**
 * Handle a document request email: parse intent, search, fetch from R2, reply.
 */
async function handleDocumentRequest(
  supabase: any,
  email: any,
  emailBody: string,
  fromAddress: string,
  resendKey: string,
  geminiKey: string
): Promise<boolean> {
  // Parse the request with Gemini Flash 2.5
  let request: any;
  try {
    request = await parseDocumentRequest(emailBody, email.subject || "", geminiKey);
  } catch (err) {
    console.error("Failed to parse document request:", err);
    return false;
  }

  if (!request.is_request) {
    console.log("Email is not a document request");
    return false;
  }

  console.log(`Document request parsed: ${JSON.stringify(request)}`);

  // Resolve person name via aliases — try extracted name first, then sender email
  let personToResolve = request.person_name || "";
  let { canonical, searchNames } = await resolvePersonName(supabase, personToResolve);

  // If no match from the extracted name, try the sender's email address
  if (!canonical && fromAddress) {
    const emailOnly = fromAddress.includes("<")
      ? fromAddress.match(/<([^>]+)>/)?.[1] || fromAddress
      : fromAddress;
    console.log(`No match for "${personToResolve}", trying sender email: ${emailOnly}`);
    const emailResult = await resolvePersonName(supabase, emailOnly.toLowerCase());
    if (emailResult.canonical) {
      canonical = emailResult.canonical;
      searchNames = emailResult.searchNames;
      // Update request.person_name for the response email
      if (!request.person_name) request.person_name = canonical;
    }
  }

  console.log(`Person resolved: canonical="${canonical}", searchNames=${JSON.stringify(searchNames)}`);

  // Search for matching documents
  const documents = await searchDocuments(supabase, canonical, searchNames, request);
  console.log(`Found ${documents.length} matching documents`);

  // Download top results from R2 and prepare attachments
  const attachments: { filename: string; content: string; type: string }[] = [];
  const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024; // 20MB limit for email
  let totalSize = 0;

  for (const doc of documents) {
    if (totalSize > MAX_ATTACHMENT_SIZE) break;

    try {
      const downloaded = await downloadFromR2(doc.bucket, doc.r2_key);
      if (downloaded && downloaded.bytes.length < MAX_ATTACHMENT_SIZE - totalSize) {
        // Convert to base64
        let binary = "";
        const chunkSize = 8192;
        for (let i = 0; i < downloaded.bytes.length; i += chunkSize) {
          const chunk = downloaded.bytes.subarray(i, i + chunkSize);
          binary += String.fromCharCode(...chunk);
        }
        const base64 = btoa(binary);

        attachments.push({
          filename: doc.filename,
          content: base64,
          type: downloaded.contentType,
        });
        totalSize += downloaded.bytes.length;
      }
    } catch (err) {
      console.error(`Failed to download ${doc.r2_key}:`, err);
    }
  }

  // Send the response email
  await sendDocumentEmail(fromAddress, resendKey, request, documents, attachments);

  // Log the activity
  await logActivity(supabase, "document_request", "document_index", documents[0]?.id || "none", fromAddress, {
    request,
    canonical,
    documents_found: documents.length,
    documents_attached: attachments.length,
  });

  return true;
}

// ============================================================
// Main handler
// ============================================================
serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://gjdvzzxsrzuorguwkaih.supabase.co";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const geminiKey = Deno.env.get("GEMINI_API_KEY");

  if (!resendKey) throw new Error("RESEND_API_KEY not set");

  const supabase = supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

  try {
    const payload = await req.json();
    const emailId = payload?.data?.email_id;

    if (!emailId) {
      console.error("No email_id in webhook payload:", JSON.stringify(payload));
      return new Response("Missing email_id", { status: 400 });
    }

    console.log(`Received inbound email webhook, email_id: ${emailId}`);

    // Fetch full email content (retries if attachments not yet available)
    const email = await fetchEmailContent(emailId, resendKey);
    console.log(`Email from: ${email.from}, subject: ${email.subject}`);

    // Check if this is an agent prompt email — forward to agent-prompt-handler
    const emailBodyForPromptCheck = email.text || email.html?.replace(/<[^>]+>/g, "") || "";
    if (/prompt:\s/i.test(emailBodyForPromptCheck)) {
      console.log("Detected agent prompt email, forwarding to agent-prompt-handler");
      try {
        const agentUrl = `${supabaseUrl}/functions/v1/agent-prompt-handler`;
        const agentRes = await fetch(agentUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({ email }),
        });
        const agentResult = await agentRes.json();
        console.log("Agent prompt handler response:", JSON.stringify(agentResult));
        return new Response(JSON.stringify({ success: true, type: "agent_prompt", ...agentResult }), {
          status: agentRes.status,
          headers: { "Content-Type": "application/json" },
        });
      } catch (agentErr) {
        console.error("Agent prompt handler forwarding failed:", agentErr);
        // Fall through to normal processing
      }
    }

    // Check if this email has processable attachments (images or PDFs)
    let attachments = email.attachments || [];
    console.log(`Email attachments from retrieve: ${attachments.length}`, JSON.stringify(attachments.map((a: any) => ({ id: a.id, ct: a.content_type, fn: a.filename, disp: a.content_disposition }))));

    // Fallback: if no attachments from email retrieve, try the dedicated attachments endpoint
    if (attachments.length === 0) {
      console.log("No attachments from email retrieve, trying list attachments endpoint...");
      const listedAttachments = await fetchAttachmentsList(emailId, resendKey);
      console.log(`List attachments endpoint returned: ${listedAttachments.length}`, JSON.stringify(listedAttachments.map((a: any) => ({ id: a.id, ct: a.content_type, fn: a.filename, disp: a.content_disposition }))));
      if (listedAttachments.length > 0) {
        attachments = listedAttachments;
      }
    }

    const processableAttachments = attachments.filter((a: any) => {
      const type = a.content_type || a.type || "";
      return (
        type.startsWith("image/") ||
        type === "application/pdf" ||
        type.includes("jpeg") ||
        type.includes("png")
      );
    });

    console.log(`Processable attachments: ${processableAttachments.length} out of ${attachments.length} total`);

    if (processableAttachments.length === 0) {
      console.log("No processable attachments found, checking for document request");

      // Try to handle as a document request
      const emailBodyText = email.text || email.html?.replace(/<[^>]+>/g, "") || "";
      const senderAddress = typeof email.from === "string"
        ? email.from
        : email.from?.[0]?.address || email.from?.[0] || "";

      if (emailBodyText.trim().length > 5 && supabase && geminiKey) {
        try {
          const handled = await handleDocumentRequest(
            supabase, email, emailBodyText, senderAddress, resendKey, geminiKey
          );
          if (handled) {
            return new Response(JSON.stringify({ success: true, type: "document_request" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
        } catch (docErr) {
          console.error("Document request handling failed:", docErr);
        }
      }

      // Log all attachment types for debugging
      if (attachments.length > 0) {
        console.log("Non-processable attachment types:", attachments.map((a: any) => a.content_type || a.type).join(", "));
      }
      try {
        await sendSummaryEmail(email, resendKey, [], []);
      } catch (fwdErr) {
        console.error("Failed to send summary email:", fwdErr);
      }
      return new Response(JSON.stringify({ success: true, receipts: 0, statements: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!supabase) {
      console.log("Missing SUPABASE_SERVICE_ROLE_KEY — processing skipped");
      try {
        await sendSummaryEmail(email, resendKey, [], []);
      } catch (fwdErr) {
        console.error("Failed to send summary email:", fwdErr);
      }
      return new Response(JSON.stringify({ success: true, receipts: 0, statements: 0, reason: "missing_keys" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Extract category hint from subject
    const userCategory = extractCategoryFromSubject(email.subject);
    const emailBody = email.text || email.html?.replace(/<[^>]+>/g, "") || "";
    const fromLine = typeof email.from === "string"
      ? email.from
      : email.from?.[0]?.address || email.from?.[0] || "";

    const processedReceipts: any[] = [];
    const processedStatements: any[] = [];
    const _debugClassifications: any[] = [];

    for (const attachment of processableAttachments) {
      try {
        const contentType = attachment.content_type || attachment.type || "application/octet-stream";
        const filename = attachment.filename || `attachment_${Date.now()}`;
        // Resend receiving API doesn't inline attachment content — fetch via API
        let base64Data = attachment.content || attachment.data || "";
        let binaryData: Uint8Array;
        if (!base64Data && attachment.id && resendKey) {
          console.log(`Fetching attachment "${filename}" via Resend API (id: ${attachment.id})`);
          const fetched = await fetchAttachmentContent(emailId, attachment.id, resendKey);
          base64Data = fetched.base64;
          binaryData = fetched.bytes;
        } else {
          binaryData = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
        }
        const isPdf = contentType === "application/pdf";

        // ── Classification gate: PDFs get classified by Gemini ──
        if (isPdf && geminiKey) {
          let classification: any = { doc_type: "receipt", confidence: 0 };
          try {
            classification = await classifyWithGemini(base64Data, geminiKey);
            console.log(`Gemini classified "${filename}" as: ${classification.doc_type} (confidence: ${classification.confidence})`);
            _debugClassifications.push(classification);
          } catch (classErr: any) {
            console.error(`Gemini classification failed for "${filename}", falling back to receipt:`, classErr);
            _debugClassifications.push({ error: String(classErr) });
          }

          // ── Statement flow ──
          if (classification.doc_type === "statement" && classification.confidence >= 0.5) {
            console.log(`Processing as statement: ${classification.institution} ${classification.account_type} ${classification.statement_date}`);

            // Store PDF in statements bucket
            const attachmentUrl = await storeStatementAttachment(supabase, filename, binaryData, contentType);

            // Insert into statement_inbox
            const inboxRow = {
              email_id: emailId,
              from_address: fromLine,
              subject: email.subject || null,
              received_at: email.created_at || new Date().toISOString(),
              attachment_filename: filename,
              attachment_url: attachmentUrl,
              attachment_size: binaryData.length,
              doc_type: "statement",
              institution: classification.institution || null,
              account_type: classification.account_type || null,
              account_name: classification.account_name || null,
              account_number: classification.account_number || null,
              account_holder: classification.account_holder || null,
              statement_date: classification.statement_date || null,
              period_start: classification.period_start || null,
              period_end: classification.period_end || null,
              classification_confidence: classification.confidence || 0,
              classification_raw: classification,
              status: "pending",
            };

            const { data: inserted, error: insertError } = await supabase
              .from("statement_inbox")
              .insert(inboxRow)
              .select("id")
              .single();

            if (insertError) {
              console.error("Failed to insert statement_inbox:", insertError);
            } else {
              await logActivity(supabase, "statement_received", "statement_inbox", inserted.id, "gemini", {
                institution: classification.institution,
                account_type: classification.account_type,
                statement_date: classification.statement_date,
                confidence: classification.confidence,
                filename,
                from: fromLine,
              });

              processedStatements.push({
                id: inserted.id,
                institution: classification.institution,
                account_type: classification.account_type,
                account_name: classification.account_name,
                account_number: classification.account_number,
                account_holder: classification.account_holder,
                statement_date: classification.statement_date,
                period_start: classification.period_start,
                period_end: classification.period_end,
                filename,
                attachment_size: binaryData.length,
              });
            }

            continue; // Skip receipt processing for this attachment
          }
        }

        // ── Receipt flow (existing behavior) ──
        if (!anthropicKey) {
          console.log("Missing ANTHROPIC_API_KEY — receipt parsing skipped");
          continue;
        }

        const attachmentUrl = await storeAttachment(supabase, filename, binaryData, contentType);

        // Parse with Claude
        let parsed: any = {};
        try {
          parsed = await parseReceiptWithClaude(
            base64Data,
            contentType,
            email.subject || "",
            emailBody,
            anthropicKey
          );
        } catch (parseErr) {
          console.error("Receipt parsing failed:", parseErr);
          parsed = { confidence: 0, error: String(parseErr) };
        }

        // Use user-provided category if available, otherwise use AI
        const category = userCategory || parsed.category || null;

        // Insert receipt record
        const receiptRecord = {
          email_from: fromLine,
          email_subject: email.subject || null,
          email_date: email.created_at || new Date().toISOString(),
          email_id: emailId,
          attachment_url: attachmentUrl,
          attachment_filename: filename,
          attachment_content_type: contentType,
          parsed_vendor: parsed.vendor || null,
          parsed_amount: parsed.amount || null,
          parsed_date: parsed.date || null,
          parsed_category: category,
          parsed_line_items: parsed.line_items || null,
          parsed_tax: parsed.tax || null,
          parsed_payment_method: parsed.payment_method || null,
          ai_confidence: parsed.confidence || 0,
          ai_raw_response: parsed,
          user_category: userCategory,
          user_notes: null,
          status: parsed.confidence > 0 ? "parsed" : "error",
          error_message: parsed.error || null,
        };

        const { data: insertedReceipt, error: insertError } = await supabase
          .from("receipts")
          .insert(receiptRecord)
          .select("id")
          .single();

        if (insertError) {
          console.error("Failed to insert receipt:", insertError);
          continue;
        }

        const receiptId = insertedReceipt.id;

        // Try to match with a QB transaction
        let receiptMatched = false;
        if (parsed.amount && parsed.date) {
          const match = await tryMatchTransaction(
            supabase,
            parsed.amount,
            parsed.date,
            parsed.vendor
          );

          if (match) {
            receiptMatched = true;
            // Update receipt with match
            await supabase
              .from("receipts")
              .update({
                matched_qb_txn_id: match.qb_txn_id,
                match_confidence: match.confidence,
                match_method: match.confidence >= 0.8 ? "exact_amount" : "fuzzy",
                status: "matched",
              })
              .eq("id", receiptId);

            // Update QB transaction with receipt link
            await supabase
              .from("qb_transactions")
              .update({
                receipt_id: receiptId,
                our_category: category,
                category_confidence: parsed.confidence,
                category_source: userCategory ? "human" : "ai",
                review_status: match.confidence >= 0.8 ? "auto_categorized" : "needs_review",
              })
              .eq("id", match.qb_txn_id);

            await logActivity(supabase, "receipt_matched", "receipt", receiptId, "ai", {
              qb_txn_id: match.qb_txn_id,
              confidence: match.confidence,
              amount: parsed.amount,
              vendor: parsed.vendor,
            });
          }
        }

        await logActivity(supabase, "receipt_parsed", "receipt", receiptId, "ai", {
          vendor: parsed.vendor,
          amount: parsed.amount,
          confidence: parsed.confidence,
          category,
          from: fromLine,
        });

        processedReceipts.push({ id: receiptId, vendor: parsed.vendor, amount: parsed.amount, matched: receiptMatched });
      } catch (attachErr: any) {
        console.error("Error processing attachment:", attachErr);
        processedStatements.push({ error: String(attachErr), stack: attachErr?.stack?.slice(0, 500) });
      }
    }

    // Send summary email for receipts only — statements get their email after parsing in process-inbox.mjs
    if (processedReceipts.length > 0 || (processedStatements.length === 0 && processedReceipts.length === 0)) {
      try {
        await sendSummaryEmail(email, resendKey, [], processedReceipts);
      } catch (fwdErr) {
        console.error("Failed to send summary email:", fwdErr);
      }
    } else {
      console.log("Skipping summary email — statements will be emailed after parsing");
    }

    return new Response(
      JSON.stringify({
        success: true,
        receipts: processedReceipts.length,
        statements: processedStatements.length,
        receipt_details: processedReceipts,
        statement_details: processedStatements,
        errors: processedStatements.filter((s: any) => s.error).length + processedReceipts.filter((r: any) => r.error).length,
        _debug: {
          emailId,
          totalAttachments: (email.attachments || []).length,
          processableCount: processableAttachments.length,
          attachmentTypes: (email.attachments || []).map((a: any) => ({ ct: a.content_type || a.type, fn: a.filename, id: a.id })),
          hasGeminiKey: !!geminiKey,
          hasSupabase: !!supabase,
          classifications: _debugClassifications,
          hasAnthropicKey: !!Deno.env.get("ANTHROPIC_API_KEY"),
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
