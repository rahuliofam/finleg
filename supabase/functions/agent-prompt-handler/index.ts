import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Agent Prompt Handler — receives inbound emails with "prompt:" prefix,
 * validates the sender is authorized, queues a Claude Code job, and
 * sends an immediate acknowledgment reply.
 *
 * Called from resend-inbound-webhook when it detects a prompt email,
 * or directly via Resend webhook.
 */

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_EMAIL = "Finleg Agent <agent@finleg.net>";

// Authorized senders (lowercase for matching)
const AUTHORIZED_SENDERS: Record<string, string> = {
  "hannah@finleg.net": "Hannah",
  "hannahsonnad@gmail.com": "Hannah",
  "emina@finleg.net": "Emina",
  "eminachaulk@gmail.com": "Emina",
  "haydn@finleg.net": "Haydn",
  "haydnsonnad@gmail.com": "Haydn",
  "rahul@finleg.net": "Rahul",
  "rahulioson@gmail.com": "Rahul",
  "jackie@finleg.net": "Jackie",
  "jackiesonnad@gmail.com": "Jackie",
  "kathy@finleg.net": "Kathy",
  "kathychaulk@gmail.com": "Kathy",
};

/**
 * Extract the prompt from the email body.
 * Looks for "prompt:" (case-insensitive) and takes everything after it.
 */
function extractPrompt(text: string): string | null {
  // Try to find "prompt:" in the body
  const match = text.match(/prompt:\s*([\s\S]+)/i);
  if (match) {
    return match[1].trim();
  }
  return null;
}

/**
 * Send an email via Resend API.
 */
async function sendEmail(
  apiKey: string,
  to: string,
  subject: string,
  html: string,
  text: string
): Promise<void> {
  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      reply_to: "agent@finleg.net",
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Failed to send email:", err);
  }
}

/**
 * Build the acknowledgment email HTML.
 */
function buildAckEmail(senderName: string, prompt: string) {
  const truncatedPrompt = prompt.length > 500 ? prompt.slice(0, 500) + "..." : prompt;

  const html = `
    <div style="max-width:600px;margin:0 auto;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
      <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#334155 100%);padding:32px;text-align:center;">
        <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">🤖 Agent Received</h1>
        <p style="margin:8px 0 0;color:#94a3b8;font-size:14px;">Finleg Code Agent</p>
      </div>
      <div style="padding:24px 32px;">
        <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${senderName},</p>
        <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 16px;">I received your request and I'm working on it now. Here's what I understood:</p>
        <div style="background:#f1f5f9;border-left:4px solid #2563eb;padding:16px;border-radius:0 8px 8px 0;margin:16px 0;">
          <code style="color:#1e293b;font-size:14px;white-space:pre-wrap;">${truncatedPrompt.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code>
        </div>
        <p style="color:#64748b;font-size:14px;line-height:1.6;margin:16px 0 0;">I'll email you back when the change is complete with a summary of what was done.</p>
      </div>
      <div style="background:#f8fafc;padding:16px 32px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="margin:0;color:#94a3b8;font-size:12px;">Finleg Agent &bull; Automated Code Changes</p>
      </div>
    </div>`;

  const text = `Hi ${senderName},

I received your request and I'm working on it now. Here's what I understood:

> ${truncatedPrompt}

I'll email you back when the change is complete with a summary of what was done.

— Finleg Agent`;

  return { html, text };
}

/**
 * Build the completion email HTML.
 */
function buildCompletionEmail(senderName: string, prompt: string, result: string, success: boolean) {
  const statusIcon = success ? "✅" : "❌";
  const statusText = success ? "Completed Successfully" : "Failed";
  const statusColor = success ? "#16a34a" : "#dc2626";
  const truncatedPrompt = prompt.length > 300 ? prompt.slice(0, 300) + "..." : prompt;

  const html = `
    <div style="max-width:600px;margin:0 auto;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
      <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#334155 100%);padding:32px;text-align:center;">
        <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">${statusIcon} Agent ${statusText}</h1>
        <p style="margin:8px 0 0;color:#94a3b8;font-size:14px;">Finleg Code Agent</p>
      </div>
      <div style="padding:24px 32px;">
        <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${senderName},</p>
        <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 8px;"><strong>Your request:</strong></p>
        <div style="background:#f1f5f9;border-left:4px solid #94a3b8;padding:12px;border-radius:0 8px 8px 0;margin:0 0 16px;">
          <code style="color:#475569;font-size:13px;white-space:pre-wrap;">${truncatedPrompt.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code>
        </div>
        <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 8px;"><strong>Result:</strong></p>
        <div style="background:${success ? "#f0fdf4" : "#fef2f2"};border-left:4px solid ${statusColor};padding:12px;border-radius:0 8px 8px 0;margin:0 0 16px;">
          <pre style="color:#1e293b;font-size:13px;white-space:pre-wrap;margin:0;font-family:'Courier New',monospace;">${result.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
        </div>
      </div>
      <div style="background:#f8fafc;padding:16px 32px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="margin:0;color:#94a3b8;font-size:12px;">Finleg Agent &bull; Automated Code Changes</p>
      </div>
    </div>`;

  const text = `Hi ${senderName},

Your request: ${truncatedPrompt}

Result:
${result}

— Finleg Agent`;

  return { html, text };
}

serve(async (req: Request) => {
  // Handle both direct Resend webhook calls and internal forwarding
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://gjdvzzxsrzuorguwkaih.supabase.co";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");

  if (!supabaseKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  if (!resendKey) throw new Error("RESEND_API_KEY not set");

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();

    // Support two call modes:
    // 1. Direct from Resend webhook: { data: { email_id: "..." } }
    // 2. Forwarded from resend-inbound-webhook: { email: { from, subject, text, ... } }
    let email: any;

    if (body.email) {
      // Forwarded — email object already fetched
      email = body.email;
    } else if (body.data?.email_id) {
      // Direct Resend webhook — fetch the email
      const emailId = body.data.email_id;
      const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
        headers: { Authorization: `Bearer ${resendKey}` },
      });
      if (!res.ok) throw new Error(`Failed to fetch email ${emailId}: ${res.status}`);
      email = await res.json();
    } else {
      return new Response("Invalid payload", { status: 400 });
    }

    // Extract sender
    const senderAddress = (
      typeof email.from === "string"
        ? email.from
        : email.from?.[0]?.address || email.from?.[0] || ""
    ).toLowerCase().trim();

    const senderName = AUTHORIZED_SENDERS[senderAddress];

    console.log(`Agent prompt handler: from=${senderAddress}, authorized=${!!senderName}`);

    // Validate sender
    if (!senderName) {
      console.log(`Unauthorized sender: ${senderAddress}`);
      return new Response(JSON.stringify({ error: "Unauthorized sender" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Extract prompt from body
    const emailBody = email.text || email.html?.replace(/<[^>]+>/g, "") || "";
    const prompt = extractPrompt(emailBody);

    if (!prompt) {
      console.log("No prompt found in email body");
      await sendEmail(
        resendKey,
        senderAddress,
        "Re: " + (email.subject || "Agent Request"),
        `<p>I couldn't find a prompt in your email. Please include <code>prompt:</code> followed by your request.</p>
         <p>Example: <code>prompt: Add a new page for quarterly reports</code></p>`,
        `I couldn't find a prompt in your email. Please include "prompt:" followed by your request.\n\nExample: prompt: Add a new page for quarterly reports`
      );
      return new Response(JSON.stringify({ error: "No prompt found" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`Prompt from ${senderName}: ${prompt.slice(0, 200)}`);

    // Insert job into agent_jobs table
    const { data: job, error: insertError } = await supabase
      .from("agent_jobs")
      .insert({
        sender_email: senderAddress,
        sender_name: senderName,
        subject: email.subject || null,
        prompt,
        status: "pending",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Failed to insert job:", insertError);
      throw new Error(`DB insert failed: ${insertError.message}`);
    }

    console.log(`Job created: ${job.id}`);

    // Send acknowledgment email
    const ack = buildAckEmail(senderName, prompt);
    await sendEmail(
      resendKey,
      senderAddress,
      "Re: " + (email.subject || "Agent Request") + " — Working on it",
      ack.html,
      ack.text
    );

    return new Response(JSON.stringify({ success: true, job_id: job.id }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Agent prompt handler error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// Export email builders for use by the runner's completion notification
export { buildCompletionEmail };
