import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_URL = "https://api.resend.com";
const FORWARD_TO = "rahchak@gmail.com";
const FROM_ADDRESS = "agent@finleg.net";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

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
 * Forward the email to the configured address via Resend send API.
 */
async function forwardEmail(original: any, apiKey: string): Promise<void> {
  const subject = `Fwd: ${original.subject || "(no subject)"}`;
  const htmlBody = original.html || `<pre>${original.text || "(empty)"}</pre>`;

  const fromLine = typeof original.from === "string"
    ? original.from
    : original.from?.[0]?.address || original.from?.[0] || "unknown sender";

  const toLine = Array.isArray(original.to)
    ? original.to.map((t: any) => (typeof t === "string" ? t : t.address)).join(", ")
    : original.to || "?";

  const forwardHtml = `
    <p><strong>Forwarded email to @finleg.net</strong></p>
    <p><strong>From:</strong> ${fromLine}<br>
    <strong>To:</strong> ${toLine}<br>
    <strong>Date:</strong> ${original.created_at || "?"}</p>
    <hr>
    ${htmlBody}
  `;

  const res = await fetch(`${RESEND_API_URL}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [FORWARD_TO],
      subject,
      html: forwardHtml,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to forward email: ${res.status} ${text}`);
  }

  const result = await res.json();
  console.log(`Forwarded to ${FORWARD_TO}, Resend ID: ${result.id}`);
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

    // Always forward to Gmail
    await forwardEmail(email, resendKey);

    // Check if this email has receipt-like attachments
    const attachments = email.attachments || [];
    const receiptAttachments = attachments.filter((a: any) => {
      const type = a.content_type || a.type || "";
      return (
        type.startsWith("image/") ||
        type === "application/pdf" ||
        type.includes("jpeg") ||
        type.includes("png")
      );
    });

    if (receiptAttachments.length === 0) {
      console.log("No receipt attachments found, skipping receipt processing");
      return new Response(JSON.stringify({ success: true, receipts: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!supabase || !anthropicKey) {
      console.log("Missing SUPABASE_SERVICE_ROLE_KEY or ANTHROPIC_API_KEY — receipt processing skipped");
      return new Response(JSON.stringify({ success: true, receipts: 0, reason: "missing_keys" }), {
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

    const processedReceipts = [];

    for (const attachment of receiptAttachments) {
      try {
        const contentType = attachment.content_type || attachment.type || "application/octet-stream";
        const filename = attachment.filename || `receipt_${Date.now()}`;
        const base64Data = attachment.content || attachment.data || "";

        // Store attachment
        const binaryData = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
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
        if (parsed.amount && parsed.date) {
          const match = await tryMatchTransaction(
            supabase,
            parsed.amount,
            parsed.date,
            parsed.vendor
          );

          if (match) {
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

        processedReceipts.push({ id: receiptId, vendor: parsed.vendor, amount: parsed.amount });
      } catch (attachErr) {
        console.error("Error processing attachment:", attachErr);
      }
    }

    return new Response(
      JSON.stringify({ success: true, receipts: processedReceipts.length, details: processedReceipts }),
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
