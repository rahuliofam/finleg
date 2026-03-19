import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_URL = "https://api.resend.com";
const FORWARD_TO = "rahchak@gmail.com";
const FROM_ADDRESS = "agent@finleg.net";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta";
const HOSTINGER_TRIGGER_URL = "https://finleg-trigger.alpacapps.com";

const CLASSIFICATION_PROMPT = `Analyze this PDF document. Determine if it is:
1. A financial STATEMENT (bank statement, credit card statement, brokerage/investment statement, loan statement, HELOC statement, mortgage statement)
2. A TAX RETURN or tax-related document (Form 1040, 1041, 1065, 1120S, 706, 709, W-2, 1099, K-1, any IRS form or schedule, state tax return, 1040-V payment voucher, tax extension, or any document from a tax preparer containing tax forms)
3. A RECEIPT/INVOICE (a record of a single purchase or payment)

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

If it is a TAX RETURN or tax-related document, extract:
- return_type: the main IRS form number ("1040", "1041", "1065", "1120S", "706", "709", "1040V", or "other")
- tax_year: the tax year covered (e.g. 2023)
- entity_name: taxpayer name as shown on the return
- entity_type: "individual", "trust", "estate", "partnership", or "corporation"

Return: {"doc_type": "tax_return", "return_type": "1040", "tax_year": 2023, "entity_name": "John Smith", "entity_type": "individual", "confidence": 0.95}

If it is a RECEIPT/INVOICE or you cannot determine, return:
{"doc_type": "receipt", "confidence": 0.95}

If you truly cannot tell what this document is, return:
{"doc_type": "unknown", "confidence": 0.0}`;

/**
 * Fetch the full email content from Resend API.
 */
async function fetchEmailContent(emailId: string, apiKey: string, attempt = 1): Promise<any> {
  const maxAttempts = 3;
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

  return res.json();
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
 * Try to match a receipt to an existing QB transaction.
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

/**
 * Fire-and-forget trigger to Hostinger to start processing immediately.
 * Falls back silently — the cron is still there as a safety net.
 */
async function triggerHostinger(endpoint: string, triggerSecret: string) {
  try {
    const res = await fetch(`${HOSTINGER_TRIGGER_URL}${endpoint}`, {
      method: "POST",
      headers: { "x-trigger-secret": triggerSecret, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    console.log(`Hostinger trigger ${endpoint}: ${res.status}`);
  } catch (err: any) {
    console.warn(`Hostinger trigger ${endpoint} failed (cron will pick up):`, err.message);
  }
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
  const triggerSecret = Deno.env.get("HOSTINGER_TRIGGER_SECRET") || "";

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

    // Fetch full email content
    const email = await fetchEmailContent(emailId, resendKey);
    console.log(`Email from: ${email.from}, subject: ${email.subject}`);

    // Check if this email has processable attachments (images or PDFs)
    const attachments = email.attachments || [];
    const processableAttachments = attachments.filter((a: any) => {
      const type = a.content_type || a.type || "";
      return (
        type.startsWith("image/") ||
        type === "application/pdf" ||
        type.includes("jpeg") ||
        type.includes("png")
      );
    });

    if (processableAttachments.length === 0) {
      console.log("No processable attachments found, sending summary");
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

        // ── Compute SHA-256 content hash for duplicate detection ──
        const hashBuffer = await crypto.subtle.digest("SHA-256", binaryData);
        const contentHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

        // Check if this exact file was already ingested
        const { data: existingDup } = await supabase
          .from("statement_inbox")
          .select("id, doc_type, status, attachment_filename, attachment_url, created_at")
          .eq("content_hash", contentHash)
          .limit(1)
          .maybeSingle();

        if (existingDup) {
          console.log(`DUPLICATE: "${filename}" matches existing inbox item ${existingDup.id} (${existingDup.attachment_filename}, status: ${existingDup.status}) — skipping`);

          // Send duplicate notification email back to sender with link to existing file
          const dupDate = existingDup.created_at ? new Date(existingDup.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "unknown date";
          const docLabel = existingDup.doc_type === "tax_return" ? "tax return" : existingDup.doc_type || "document";
          const viewUrl = existingDup.doc_type === "tax_return"
            ? "https://finleg.net/intranet/bookkeeping/tax-returns"
            : "https://finleg.net/intranet/bookkeeping/statements";
          const fileUrl = existingDup.attachment_url || viewUrl;

          const dupHtml = `<div style="font-family: -apple-system, sans-serif; max-width: 560px; padding: 20px;">
            <h2 style="color: #b45309; margin-bottom: 8px;">Duplicate File Detected</h2>
            <p><strong>"${filename}"</strong> has already been processed as a ${docLabel} on <strong>${dupDate}</strong>.</p>
            <p>Original file: <strong>${existingDup.attachment_filename}</strong> (status: ${existingDup.status})</p>
            <p style="margin-top: 16px;">
              <a href="${fileUrl}" style="background: #2563eb; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; display: inline-block;">View Existing File →</a>
            </p>
            <p style="margin-top: 20px; font-size: 13px; color: #999;">No extraction was performed. If this is a corrected version, reply with "Reprocess" in the subject line.</p>
          </div>`;

          try {
            await fetch(`${RESEND_API_URL}/emails`, {
              method: "POST",
              headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                from: FROM_ADDRESS,
                to: [fromLine],
                bcc: [FORWARD_TO],
                subject: `Duplicate: ${filename}`,
                html: dupHtml,
              }),
            });
            console.log(`Duplicate notification sent to ${fromLine} for ${filename}`);
          } catch (emailErr: any) {
            console.error(`Failed to send duplicate notification:`, emailErr);
          }

          continue;
        }

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
              content_hash: contentHash,
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

              // Trigger Hostinger to process immediately (fire-and-forget)
              triggerHostinger("/process-statement", triggerSecret);
            }

            continue; // Skip receipt processing for this attachment
          }

          // ── Tax return flow ──
          if (classification.doc_type === "tax_return" && classification.confidence >= 0.5) {
            console.log(`Processing as tax return: ${classification.return_type} for ${classification.entity_name} (${classification.tax_year})`);

            // Store PDF in statements bucket (tax-returns subfolder)
            const attachmentUrl = await storeStatementAttachment(supabase, `tax-returns/${filename}`, binaryData, contentType);

            // Insert into statement_inbox with doc_type = 'tax_return' for the batch processor to pick up
            const inboxRow = {
              email_id: emailId,
              from_address: fromLine,
              subject: email.subject || null,
              received_at: email.created_at || new Date().toISOString(),
              attachment_filename: filename,
              attachment_url: attachmentUrl,
              attachment_size: binaryData.length,
              doc_type: "tax_return",
              institution: "irs",
              content_hash: contentHash,
              account_type: classification.return_type || "1040",
              account_name: classification.entity_name || null,
              account_holder: classification.entity_name || null,
              statement_date: classification.tax_year ? `${classification.tax_year}-12-31` : null,
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
              console.error("Failed to insert tax return to statement_inbox:", insertError);
            } else {
              await logActivity(supabase, "tax_return_received", "statement_inbox", inserted.id, "gemini", {
                return_type: classification.return_type,
                tax_year: classification.tax_year,
                entity_name: classification.entity_name,
                confidence: classification.confidence,
                filename,
                from: fromLine,
              });

              processedStatements.push({
                id: inserted.id,
                institution: "IRS",
                account_type: `Form ${classification.return_type}`,
                account_name: classification.entity_name,
                account_holder: classification.entity_name,
                statement_date: classification.tax_year ? `${classification.tax_year}-12-31` : null,
                filename,
                attachment_size: binaryData.length,
              });

              // Trigger Hostinger to process immediately (fire-and-forget)
              triggerHostinger("/process-tax-return", triggerSecret);
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
