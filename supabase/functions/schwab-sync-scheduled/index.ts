import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * Scheduled Schwab Sync — Cron wrapper for schwab-sync edge function.
 *
 * - Daily: Mon-Fri 7AM UTC (2AM ET, after market close) — positions + balances only
 * - Weekly: Sunday 3AM UTC — full sync including 30 days of transactions
 *
 * Setup in Supabase SQL Editor:
 *   -- Daily positions/balances sync (Mon-Fri 7AM UTC)
 *   SELECT cron.schedule(
 *     'schwab-daily-sync',
 *     '0 7 * * 1-5',
 *     $$SELECT net.http_post(
 *       url := 'https://gjdvzzxsrzuorguwkaih.supabase.co/functions/v1/schwab-sync-scheduled',
 *       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')),
 *       body := '{"schedule": "daily"}'::jsonb
 *     )$$
 *   );
 *
 *   -- Weekly full sync with transactions (Sunday 3AM UTC)
 *   SELECT cron.schedule(
 *     'schwab-weekly-sync',
 *     '0 3 * * 0',
 *     $$SELECT net.http_post(
 *       url := 'https://gjdvzzxsrzuorguwkaih.supabase.co/functions/v1/schwab-sync-scheduled',
 *       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')),
 *       body := '{"schedule": "weekly"}'::jsonb
 *     )$$
 *   );
 */

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let schedule = "daily";
  try {
    const body = await req.json();
    if (body.schedule) schedule = body.schedule;
  } catch {
    // Default to daily
  }

  const isWeekly = schedule === "weekly";

  console.log(`Scheduled Schwab ${schedule} sync starting...`);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://gjdvzzxsrzuorguwkaih.supabase.co";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!serviceKey) {
    return new Response(JSON.stringify({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const syncResponse = await fetch(`${supabaseUrl}/functions/v1/schwab-sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        syncType: isWeekly ? "scheduled_weekly" : "scheduled_daily",
        triggeredBy: "cron",
        includeTransactions: isWeekly,
        transactionDays: isWeekly ? 30 : 0,
      }),
    });

    const result = await syncResponse.json();

    if (!syncResponse.ok) {
      console.error("Schwab sync failed:", result);
      return new Response(JSON.stringify({ error: "Sync failed", details: result }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`Scheduled Schwab ${schedule} sync completed:`, result);

    return new Response(
      JSON.stringify({ success: true, schedule, ...result }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Scheduled Schwab sync error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
