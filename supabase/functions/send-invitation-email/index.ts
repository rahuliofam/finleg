import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * Send Invitation Email — fires when an admin invites a user.
 *
 * Called from the frontend after inserting into user_invitations.
 * Uses Resend API to deliver a branded invitation email.
 */

const RESEND_API_URL = "https://api.resend.com/emails";
const APP_URL = "https://finleg.net";
const FROM_EMAIL = "Finleg <agent@finleg.net>";
const REPLY_TO = "rahul@finleg.net";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InviteRequest {
  email: string;
  role: string;
  invited_by_email?: string;
}

function buildInvitationEmail(data: InviteRequest) {
  const roleLabels: Record<string, string> = {
    oracle: "an oracle",
    admin: "an admin",
    staff: "a staff member",
    resident: "a resident",
    associate: "an associate",
    demo: "a demo user",
    public: "a user",
    prospect: "a prospect",
  };

  const roleDescriptions: Record<string, string> = {
    oracle: "full oracle access to all financial data, reports, and system settings",
    admin: "admin access to financial data, reports, and user management",
    staff: "staff access to view financial data and reports",
    resident: "resident access to view shared household information",
    associate: "associate access to view shared information",
    demo: "demo access to explore the platform with sample data",
    public: "public access to the platform",
    prospect: "prospect access to view available information",
  };

  const roleLabel = roleLabels[data.role] ?? "a user";
  const roleDescription = roleDescriptions[data.role] ?? "access to the platform";
  const loginUrl = `${APP_URL}/signin`;
  const inviterNote = data.invited_by_email
    ? `<p style="color:#334155;font-size:16px;line-height:1.6;margin:0 0 16px;">Invited by <strong>${data.invited_by_email}</strong></p>`
    : "";

  const html = `
    <div style="max-width:600px;margin:0 auto;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
      <!-- Header with gradient -->
      <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#334155 100%);padding:40px 32px 24px;text-align:center;">
        <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">Welcome to Finleg</h1>
        <p style="margin:8px 0 0;color:#94a3b8;font-size:15px;font-weight:400;">Financial Intelligence Platform</p>
      </div>

      <!-- Body -->
      <div style="padding:32px;">
        <p style="color:#334155;font-size:16px;line-height:1.6;margin:0 0 16px;">Hi there,</p>
        <p style="color:#334155;font-size:16px;line-height:1.6;margin:0 0 16px;">You've been invited to join <strong style="color:#1e293b;">Finleg</strong> as ${roleLabel}. You'll have ${roleDescription}.</p>
        ${inviterNote}
        <p style="color:#334155;font-size:16px;line-height:1.6;margin:0 0 24px;">Your access is <strong>pre-approved</strong> — just sign in and you're in.</p>

        <!-- CTA Button -->
        <div style="text-align:center;margin:32px 0;">
          <a href="${loginUrl}" style="background:linear-gradient(135deg,#2563eb 0%,#3b82f6 100%);color:#ffffff;padding:16px 40px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:700;font-size:16px;letter-spacing:0.3px;box-shadow:0 4px 12px rgba(37,99,235,0.3);">Sign in to Finleg</a>
        </div>

        <!-- Getting started card -->
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px 24px;margin:24px 0;">
          <p style="color:#64748b;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 12px;">Getting Started</p>
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:6px 12px 6px 0;vertical-align:top;color:#2563eb;font-weight:700;font-size:14px;width:24px;">1.</td>
              <td style="padding:6px 0;color:#475569;font-size:14px;line-height:1.5;">Click the button above to go to the sign-in page</td>
            </tr>
            <tr>
              <td style="padding:6px 12px 6px 0;vertical-align:top;color:#2563eb;font-weight:700;font-size:14px;">2.</td>
              <td style="padding:6px 0;color:#475569;font-size:14px;line-height:1.5;">Sign in with <strong>${data.email}</strong> using <strong>Continue with Google</strong> (one tap) or create a password</td>
            </tr>
            <tr>
              <td style="padding:6px 12px 6px 0;vertical-align:top;color:#2563eb;font-weight:700;font-size:14px;">3.</td>
              <td style="padding:6px 0;color:#475569;font-size:14px;line-height:1.5;">That's it — you'll have immediate access</td>
            </tr>
          </table>
        </div>

        <p style="color:#94a3b8;font-size:13px;text-align:center;margin:24px 0 0;">Questions? Just reply to this email.</p>
      </div>

      <!-- Footer -->
      <div style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="margin:0;color:#94a3b8;font-size:12px;">Finleg &bull; Financial Intelligence Platform</p>
      </div>
    </div>
  `;

  const text = `Welcome to Finleg!

Hi there,

You've been invited to join Finleg as ${roleLabel}. You'll have ${roleDescription}.
${data.invited_by_email ? `\nInvited by ${data.invited_by_email}\n` : ""}
Your access is pre-approved — just sign in and you're in.

Getting Started:
1. Go to: ${loginUrl}
2. Sign in with ${data.email} — use "Continue with Google" (one tap) or create a password
3. That's it — you'll have immediate access

Questions? Just reply to this email.

— Finleg`;

  return {
    subject: "You're Invited to Finleg",
    html,
    text,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const body: InviteRequest = await req.json();
    const { email, role } = body;

    if (!email || !role) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: email, role" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const template = buildInvitationEmail(body);

    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email],
        reply_to: REPLY_TO,
        subject: template.subject,
        html: template.html,
        text: template.text,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("Resend API error:", result);
      return new Response(
        JSON.stringify({ error: "Failed to send invitation email", details: result }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Invitation email sent:", { email, role, id: result.id });

    return new Response(
      JSON.stringify({ success: true, id: result.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Send invitation email error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
