import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * Scheduled QB Sync — Cron wrapper for qb-sync edge function.
 *
 * Designed to be invoked by Supabase pg_cron or an external scheduler:
 * - Weekly full sync: Sunday 2AM UTC (fetches 35 days)
 * - Daily incremental: Mon-Sat 6AM UTC (fetches 3 days)
 *
 * Can also be called manually with custom parameters.
 *
 * Setup in Supabase SQL Editor:
 *   -- Weekly full sync (Sunday 2AM UTC)
 *   SELECT cron.schedule(
 *     'qb-weekly-sync',
 *     '0 2 * * 0',
 *     $$SELECT net.http_post(
 *       url := 'https://gjdvzzxsrzuorguwkaih.supabase.co/functions/v1/qb-sync-scheduled',
 *       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')),
 *       body := '{"schedule": "weekly"}'::jsonb
 *     )$$
 *   );
 *
 *   -- Daily incremental sync (Mon-Sat 6AM UTC)
 *   SELECT cron.schedule(
 *     'qb-daily-sync',
 *     '0 6 * * 1-6',
 *     $$SELECT net.http_post(
 *       url := 'https://gjdvzzxsrzuorguwkaih.supabase.co/functions/v1/qb-sync-scheduled',
 *       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')),
 *       body := '{"schedule": "daily"}'::jsonb
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

  // Calculate since date
  const daysBack = isWeekly ? 35 : 3;
  const sinceDate = new Date(Date.now() - daysBack * 86400000).toISOString().split("T")[0];

  console.log(`Scheduled ${schedule} sync — fetching since ${sinceDate}`);

  // Call the main qb-sync function internally
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://gjdvzzxsrzuorguwkaih.supabase.co";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!serviceKey) {
    return new Response(JSON.stringify({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const syncResponse = await fetch(`${supabaseUrl}/functions/v1/qb-sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        syncType: isWeekly ? "scheduled_weekly" : "scheduled_daily",
        triggeredBy: "cron",
        sinceDate,
      }),
    });

    const result = await syncResponse.json();

    if (!syncResponse.ok) {
      console.error("Sync failed:", result);
      return new Response(JSON.stringify({ error: "Sync failed", details: result }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`Scheduled ${schedule} sync completed:`, result);

    return new Response(
      JSON.stringify({ success: true, schedule, ...result }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Scheduled sync error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
