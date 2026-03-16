import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_URL = "https://api.resend.com";
const FORWARD_TO = "rahchak@gmail.com";
const FROM_ADDRESS = "agent@finleg.net";

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

    if (!supabase) {
      console.log("Missing SUPABASE_SERVICE_ROLE_KEY — receipt processing skipped");
      return new Response(JSON.stringify({ success: true, receipts: 0, reason: "missing_keys" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Extract category hint from subject
    const userCategory = extractCategoryFromSubject(email.subject);
    const fromLine = typeof email.from === "string"
      ? email.from
      : email.from?.[0]?.address || email.from?.[0] || "";

    const processedReceipts: Array<{ id: string; filename: string }> = [];

    for (const attachment of receiptAttachments) {
      try {
        const contentType = attachment.content_type || attachment.type || "application/octet-stream";
        const filename = attachment.filename || `receipt_${Date.now()}`;
        const base64Data = attachment.content || attachment.data || "";

        // Store attachment in Supabase Storage
        const binaryData = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
        const attachmentUrl = await storeAttachment(supabase, filename, binaryData, contentType);

        // Insert receipt as "pending" — AI parsing happens on Hostinger via claude --print
        const receiptRecord = {
          email_from: fromLine,
          email_subject: email.subject || null,
          email_date: email.created_at || new Date().toISOString(),
          email_id: emailId,
          attachment_url: attachmentUrl,
          attachment_filename: filename,
          attachment_content_type: contentType,
          user_category: userCategory,
          status: "pending",
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

        await logActivity(supabase, "receipt_ingested", "receipt", insertedReceipt.id, "system", {
          filename,
          from: fromLine,
          user_category: userCategory,
        });

        processedReceipts.push({ id: insertedReceipt.id, filename });
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
