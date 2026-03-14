// Email service — sends via Supabase Edge Function → Resend
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';

/**
 * Send an email via the send-email edge function.
 * @param {Object} opts
 * @param {string|string[]} opts.to - Recipient(s)
 * @param {string} opts.subject - Email subject
 * @param {string} opts.html - HTML body
 * @param {string} [opts.from] - Sender (defaults to onboarding@resend.dev)
 * @returns {Promise<{id: string}>} Resend message ID
 */
async function sendEmail({ to, subject, html, from }) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || SUPABASE_ANON_KEY;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to, subject, html, from }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || `Email send failed: ${res.status}`);
  }

  return res.json();
}

export { sendEmail };
