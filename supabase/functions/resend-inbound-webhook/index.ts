import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_URL = "https://api.resend.com";
const FORWARD_TO = "rahchak@gmail.com";
const FROM_ADDRESS = "agent@finleg.net";

/**
 * Fetch the full email content from Resend API.
 * The webhook payload doesn't include the body — must fetch separately.
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
async function forwardEmail(
  original: any,
  apiKey: string
): Promise<void> {
  const subject = `Fwd: ${original.subject || "(no subject)"}`;
  const htmlBody = original.html || `<pre>${original.text || "(empty)"}</pre>`;

  // Resend returns `from` as a plain string and `to` as a string array
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

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const payload = await req.json();
    const emailId = payload?.data?.email_id;

    if (!emailId) {
      console.error("No email_id in webhook payload:", JSON.stringify(payload));
      return new Response("Missing email_id", { status: 400 });
    }

    console.log(`Received inbound email webhook, email_id: ${emailId}`);

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) {
      throw new Error("RESEND_API_KEY not set");
    }

    // Fetch full email content
    const email = await fetchEmailContent(emailId, apiKey);
    console.log(
      `Email from: ${email.from}, to: ${email.to}, subject: ${email.subject}`
    );

    // Forward to destination
    await forwardEmail(email, apiKey);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
