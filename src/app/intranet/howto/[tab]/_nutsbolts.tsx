"use client";

import { useState } from "react";

interface CronJob {
  name: string;
  schedule: string;
  scheduleHuman: string;
  target: string;
  description: string;
  runsOn: string;
  payload?: string;
}

interface BatchJob {
  name: string;
  script: string;
  runsOn: string;
  trigger: string;
  description: string;
  requires: string[];
}

interface InfraService {
  name: string;
  purpose: string;
  tier: string;
  cost: string;
  dashboard?: string;
}

const CRON_JOBS: CronJob[] = [
  {
    name: "Daily QB Sync",
    schedule: "0 6 * * 1-6",
    scheduleHuman: "Mon-Sat 6:00 AM UTC (1:00 AM ET)",
    target: "qb-sync-scheduled",
    description:
      "Fetches 3 days of QuickBooks transactions (Purchases, Deposits, Transfers, Journal Entries). Uses upsert to avoid duplicates. Applies category rules to new transactions automatically.",
    runsOn: "Supabase pg_cron → Edge Function",
    payload: '{"schedule": "daily"}',
  },
  {
    name: "Weekly Full QB Sync",
    schedule: "0 2 * * 0",
    scheduleHuman: "Sunday 2:00 AM UTC (Sat 9:00 PM ET)",
    target: "qb-sync-scheduled",
    description:
      "Deep sync: fetches 35 days of data to catch stragglers. Detects soft-deleted transactions (removed from QB but still in our system). Marks them with is_deleted flag.",
    runsOn: "Supabase pg_cron → Edge Function",
    payload: '{"schedule": "weekly"}',
  },
  {
    name: "Integrity Check",
    schedule: "0 4 * * 0",
    scheduleHuman: "Sunday 4:00 AM UTC (Sat 11:00 PM ET)",
    target: "qb-integrity-check",
    description:
      "Scans for data quality issues: transactions missing categories for 7+ days, purchases over $75 without receipts, potential duplicates (same amount + date + vendor), stale accounts (no activity 6+ months). Auto-generates todos and auto-resolves when fixed.",
    runsOn: "Supabase pg_cron → Edge Function",
  },
  {
    name: "Weekly Email Digest",
    schedule: "0 9 * * 0",
    scheduleHuman: "Sunday 9:00 AM UTC (4:00 AM ET)",
    target: "send-weekly-digest",
    description:
      "Sends a summary email via Resend with: sync stats, auto-categorization rate, pending review count, top uncategorized transactions, integrity alerts, and AI accuracy trends.",
    runsOn: "Supabase pg_cron → Edge Function → Resend API",
  },
];

const BATCH_JOBS: BatchJob[] = [
  {
    name: "AI Categorization Batch",
    script: "scripts/ai-categorize-batch.mjs",
    runsOn: "Hostinger VPS",
    trigger: "Manual (on demand)",
    description:
      "Categorizes pending transactions using Claude. Groups by vendor for efficiency, includes few-shot examples from recent human-approved categorizations.",
    requires: ["Node.js 22+", "Anthropic API key", "Supabase service role key"],
  },
  {
    name: "AI Metrics Computation",
    script: "scripts/compute-ai-metrics.mjs",
    runsOn: "Hostinger VPS",
    trigger: "Manual (weekly recommended)",
    description:
      "Calculates weekly AI accuracy: total categorized, human approved, human overridden, accuracy percentage, average confidence. Writes to ai_metrics table.",
    requires: ["Node.js 22+", "Supabase service role key"],
  },
  {
    name: "Statement PDF Ingestion",
    script: "scripts/ingest-statements.mjs",
    runsOn: "Hostinger VPS",
    trigger: "Manual (when new statements arrive)",
    description:
      "Parses bank/credit card/investment/loan statement PDFs using Claude. Extracts structured JSON (transactions, summaries, balances) and loads into Supabase tables.",
    requires: ["Node.js 22+", "Anthropic API key", "Supabase service role key"],
  },
  {
    name: "Document Metadata Extraction",
    script: "scripts/extract-doc-metadata.mjs",
    runsOn: "Hostinger VPS",
    trigger: "Manual (after R2 uploads)",
    description:
      "Uses Claude CLI headless mode (claude --print) to extract metadata from R2 documents. Enriches document_index table with AI-extracted fields.",
    requires: ["Claude CLI", "Supabase service role key"],
  },
  {
    name: "R2 File Index Upload",
    script: "scripts/upload-r2-index.mjs",
    runsOn: "Hostinger VPS",
    trigger: "Manual (after bulk uploads)",
    description:
      "Indexes all R2 files into the document_index table with parallel uploads. Creates FTS-searchable records for the File Vault.",
    requires: ["Node.js 22+", "Wrangler CLI", "R2 credentials"],
  },
  {
    name: "Investment Balance Bridge",
    script: "scripts/sync-investment-balances-to-qb.mjs",
    runsOn: "Hostinger VPS",
    trigger: "Manual (monthly)",
    description:
      "Pushes aggregate investment account balances to QuickBooks as journal entries to keep the balance sheet accurate.",
    requires: ["Node.js 22+", "QB OAuth tokens", "Supabase service role key"],
  },
];

const EDGE_FUNCTIONS: { name: string; purpose: string; auth: string }[] = [
  { name: "qb-sync", purpose: "On-demand QB transaction sync (POST)", auth: "Service role key" },
  { name: "qb-sync-scheduled", purpose: "Cron-triggered QB sync wrapper", auth: "Service role key" },
  { name: "qb-integrity-check", purpose: "Data quality scan", auth: "Service role key" },
  { name: "qb-writeback", purpose: "Push approved changes to QB", auth: "Service role key" },
  { name: "send-weekly-digest", purpose: "Weekly email summary via Resend", auth: "Service role key" },
  { name: "resend-inbound-webhook", purpose: "Email receipt parsing (no JWT)", auth: "Webhook secret" },
  { name: "ai-categorize", purpose: "AI transaction categorization", auth: "Service role key" },
];

const INFRA_SERVICES: InfraService[] = [
  {
    name: "Supabase (PostgreSQL + Auth)",
    purpose: "Database, authentication, pg_cron scheduling, edge functions",
    tier: "Free tier",
    cost: "$0/mo (within limits)",
    dashboard: "https://supabase.com/dashboard/project/gjdvzzxsrzuorguwkaih",
  },
  {
    name: "GitHub Pages",
    purpose: "Static site hosting (Next.js export), auto-deploys on push to main",
    tier: "Free",
    cost: "$0/mo",
  },
  {
    name: "Cloudflare R2",
    purpose: "Document storage (financial statements, bookkeeping docs, legal docs)",
    tier: "Free tier (10 GB, 10M reads, 1M writes, zero egress)",
    cost: "$0/mo (within limits)",
  },
  {
    name: "Hostinger VPS",
    purpose: "Batch job execution (AI categorization, PDF parsing, document indexing)",
    tier: "KVM 1",
    cost: "~$12/mo",
  },
  {
    name: "Resend",
    purpose: "Outbound email (weekly digest) + inbound email (receipt parsing)",
    tier: "Free tier (3,000 emails/mo)",
    cost: "$0/mo",
  },
  {
    name: "QuickBooks Online (Intuit)",
    purpose: "General ledger, transaction source of truth, OAuth API",
    tier: "Production",
    cost: "Subscription (existing)",
  },
];

const DB_TABLES: { table: string; source: string; rows?: string }[] = [
  { table: "qb_tokens", source: "OAuth flow" },
  { table: "qb_transactions", source: "QB API sync" },
  { table: "qb_general_ledger", source: "CSV import" },
  { table: "category_rules", source: "Learning system" },
  { table: "receipts", source: "Resend webhook" },
  { table: "sync_runs", source: "QB sync logs" },
  { table: "integrity_findings", source: "Integrity checker" },
  { table: "todos", source: "Auto-generated + manual" },
  { table: "qb_writeback_queue", source: "Writeback proposals" },
  { table: "ai_metrics", source: "Weekly computation" },
  { table: "bookkeeping_activity_log", source: "All actions" },
  { table: "cc_statement_summaries", source: "PDF parsing" },
  { table: "cc_transactions", source: "PDF parsing" },
  { table: "checking_statement_summaries", source: "PDF parsing" },
  { table: "checking_transactions", source: "PDF parsing" },
  { table: "investment_statement_summaries", source: "PDF parsing" },
  { table: "investment_transactions", source: "PDF parsing" },
  { table: "loan_statement_summaries", source: "PDF parsing" },
  { table: "document_index", source: "R2 indexing" },
];

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mb-8 border border-slate-200 rounded-lg overflow-hidden">
      <div className="bg-slate-800 px-5 py-3 flex items-center justify-between">
        <h2 className="text-base font-bold text-white">{title}</h2>
        {subtitle && <span className="text-xs text-slate-400">{subtitle}</span>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export default function NutsBoltsPage() {
  const [expandedCron, setExpandedCron] = useState<Set<number>>(new Set());

  const toggleCron = (i: number) => {
    setExpandedCron((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Nuts &amp; Bolts</h1>
        <p className="mt-2 text-slate-600">
          Infrastructure, scheduling, and operational details &mdash; where everything runs,
          how often, and what it costs.
        </p>
      </div>

      {/* Infrastructure Services */}
      <SectionCard title="Infrastructure" subtitle="Services & hosting">
        <div className="space-y-3">
          {INFRA_SERVICES.map((svc) => (
            <div key={svc.name} className="flex items-start gap-4 p-3 bg-slate-50 rounded-lg">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-slate-900">{svc.name}</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">
                    {svc.tier}
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-0.5">{svc.purpose}</p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold text-slate-700">{svc.cost}</div>
                {svc.dashboard && (
                  <a
                    href={svc.dashboard}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-blue-600 hover:underline"
                  >
                    Dashboard
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 p-3 bg-blue-50 rounded-lg">
          <div className="text-xs font-semibold text-blue-700 mb-1">Architecture Summary</div>
          <p className="text-xs text-blue-800">
            Browser &rarr; GitHub Pages (static Next.js) &rarr; Supabase (PostgreSQL + Edge Functions + Auth) &rarr; R2 (documents).
            No server-side rendering. All API calls happen directly from the browser to Supabase.
            Batch jobs run on Hostinger VPS via SSH.
          </p>
        </div>
      </SectionCard>

      {/* Scheduled Jobs (pg_cron) */}
      <SectionCard title="Scheduled Jobs (pg_cron)" subtitle="Runs inside Supabase PostgreSQL">
        <div className="mb-3 p-3 bg-amber-50 rounded-lg">
          <p className="text-xs text-amber-800">
            <strong>Where:</strong> These run inside the Supabase PostgreSQL instance using the <code className="bg-amber-100 px-1 rounded">pg_cron</code> extension.
            Each job calls an Edge Function via <code className="bg-amber-100 px-1 rounded">pg_net</code> HTTP POST.
            Defined in <code className="bg-amber-100 px-1 rounded">supabase/migrations/017_setup_pg_cron_schedules.sql</code>.
          </p>
        </div>
        <div className="space-y-2">
          {CRON_JOBS.map((job, i) => (
            <div key={job.name} className="border border-slate-200 rounded-lg overflow-hidden">
              <button
                onClick={() => toggleCron(i)}
                className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <code className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-600">
                    {job.schedule}
                  </code>
                  <span className="font-semibold text-sm text-slate-900">{job.name}</span>
                </div>
                <span className="text-xs text-slate-400">{expandedCron.has(i) ? "\u2212" : "+"}</span>
              </button>
              {expandedCron.has(i) && (
                <div className="px-4 pb-4 border-t border-slate-100">
                  <p className="mt-2 text-sm text-slate-600">{job.description}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="font-semibold text-slate-500">Human schedule:</span>{" "}
                      <span className="text-slate-700">{job.scheduleHuman}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-slate-500">Runs on:</span>{" "}
                      <span className="text-slate-700">{job.runsOn}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-slate-500">Edge Function:</span>{" "}
                      <code className="bg-slate-100 px-1 rounded text-slate-700">{job.target}</code>
                    </div>
                    {job.payload && (
                      <div>
                        <span className="font-semibold text-slate-500">Payload:</span>{" "}
                        <code className="bg-slate-100 px-1 rounded text-slate-700">{job.payload}</code>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 text-xs text-slate-500">
          All times are UTC. pg_cron runs inside the Supabase Postgres instance &mdash; no external cron server needed.
          To view or modify schedules, use the Supabase SQL editor: <code className="bg-slate-100 px-1 rounded">SELECT * FROM cron.job;</code>
        </div>
      </SectionCard>

      {/* Batch Jobs (Hostinger VPS) */}
      <SectionCard title="Batch Jobs (Hostinger VPS)" subtitle="Manual triggers via SSH">
        <div className="mb-3 p-3 bg-amber-50 rounded-lg">
          <p className="text-xs text-amber-800">
            <strong>Where:</strong> Hostinger VPS at <code className="bg-amber-100 px-1 rounded">93.188.164.224</code>.
            SSH via <code className="bg-amber-100 px-1 rounded">sshpass -f ~/.ssh/alpacapps-hostinger.pass ssh root@93.188.164.224</code>.
            Requires Node.js 22+, Claude CLI, and Wrangler installed on the VPS.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-slate-200">
                <th className="pb-2 font-semibold text-slate-500 text-xs">Job</th>
                <th className="pb-2 font-semibold text-slate-500 text-xs">Script</th>
                <th className="pb-2 font-semibold text-slate-500 text-xs">Trigger</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {BATCH_JOBS.map((job) => (
                <tr key={job.name} className="group">
                  <td className="py-3 pr-3">
                    <div className="font-medium text-slate-900">{job.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{job.description}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-700 whitespace-nowrap">
                      {job.script}
                    </code>
                  </td>
                  <td className="py-3">
                    <span className="text-xs text-slate-600">{job.trigger}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Edge Functions */}
      <SectionCard title="Edge Functions" subtitle="Supabase Deno runtime">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-slate-200">
                <th className="pb-2 font-semibold text-slate-500 text-xs">Function</th>
                <th className="pb-2 font-semibold text-slate-500 text-xs">Purpose</th>
                <th className="pb-2 font-semibold text-slate-500 text-xs">Auth</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {EDGE_FUNCTIONS.map((fn) => (
                <tr key={fn.name}>
                  <td className="py-2.5 pr-3">
                    <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">{fn.name}</code>
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-slate-600">{fn.purpose}</td>
                  <td className="py-2.5 text-xs text-slate-500">{fn.auth}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-xs text-slate-500">
          Base URL: <code className="bg-slate-100 px-1 rounded">https://gjdvzzxsrzuorguwkaih.supabase.co/functions/v1/</code>.
          Deploy with: <code className="bg-slate-100 px-1 rounded">npx supabase functions deploy &lt;name&gt;</code>.
        </div>
      </SectionCard>

      {/* Database Tables */}
      <SectionCard title="Database Tables" subtitle="Supabase PostgreSQL">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-slate-200">
                <th className="pb-2 font-semibold text-slate-500 text-xs">Table</th>
                <th className="pb-2 font-semibold text-slate-500 text-xs">Data Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {DB_TABLES.map((t) => (
                <tr key={t.table}>
                  <td className="py-2 pr-3">
                    <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">{t.table}</code>
                  </td>
                  <td className="py-2 text-xs text-slate-600">{t.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-xs text-slate-500">
          All tables use UUID PKs, RLS enabled, <code className="bg-slate-100 px-1 rounded">created_at</code> / <code className="bg-slate-100 px-1 rounded">updated_at</code> timestamps.
          Migrations in <code className="bg-slate-100 px-1 rounded">supabase/migrations/</code>.
        </div>
      </SectionCard>

      {/* Credentials & Secrets */}
      <SectionCard title="Credentials & Secrets" subtitle="Where secrets live">
        <div className="space-y-3">
          <div className="p-3 bg-slate-50 rounded-lg">
            <div className="font-semibold text-sm text-slate-900 mb-1">Bitwarden</div>
            <p className="text-xs text-slate-600">
              QB Client ID/Secret, financial institution passwords, and service API keys.
              Folder: &ldquo;Family Tax&rdquo;
            </p>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg">
            <div className="font-semibold text-sm text-slate-900 mb-1">local.env / .env (gitignored)</div>
            <p className="text-xs text-slate-600">
              Supabase service role key, QB refresh token (auto-rotated), R2 credentials, DB password.
              Never committed to git.
            </p>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg">
            <div className="font-semibold text-sm text-slate-900 mb-1">Supabase Edge Function Secrets</div>
            <p className="text-xs text-slate-600">
              Set via <code className="bg-slate-100 px-1 rounded">npx supabase secrets set KEY=VALUE</code>.
              Includes: SUPABASE_SERVICE_ROLE_KEY, QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, QUICKBOOKS_ENVIRONMENT, RESEND_API_KEY.
            </p>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg">
            <div className="font-semibold text-sm text-slate-900 mb-1">QB OAuth Token Rotation</div>
            <p className="text-xs text-slate-600">
              Refresh tokens rotate on each use (saved to <code className="bg-slate-100 px-1 rounded">qb_tokens</code> table and local.env).
              Refresh tokens expire after 100 days unused &mdash; re-auth via OAuth Playground if expired.
            </p>
          </div>
        </div>
      </SectionCard>

      {/* Statement Retrieval (Planned) */}
      <SectionCard title="Automated Statement Retrieval" subtitle="Planned">
        <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-200 text-purple-800">Coming Soon</span>
            <span className="font-semibold text-sm text-purple-900">Browser Agent Statement Fetcher</span>
          </div>
          <p className="text-xs text-purple-800 mb-3">
            Automated browser agents will log in to each financial institution using Bitwarden credentials
            and download the latest statements on a customized schedule per institution.
          </p>
          <div className="space-y-2 text-xs text-purple-700">
            <div className="flex items-start gap-2">
              <span className="text-purple-400 mt-0.5">1.</span>
              <span>Credentials pulled from Bitwarden vault at runtime (never stored on disk)</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-purple-400 mt-0.5">2.</span>
              <span>Headless browser (Playwright) navigates to institution login, authenticates, downloads statement PDF</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-purple-400 mt-0.5">3.</span>
              <span>PDF uploaded to R2 and piped through statement ingestion pipeline</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-purple-400 mt-0.5">4.</span>
              <span>Custom schedule per institution (e.g., Chase: 3rd of month, Fidelity: 1st of month)</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-purple-400 mt-0.5">5.</span>
              <span>Runs on Hostinger VPS via cron</span>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Quick Reference */}
      <div className="p-5 bg-slate-50 border border-slate-200 rounded-lg">
        <h2 className="text-lg font-bold text-slate-900 mb-3">Quick Reference</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div>
            <span className="font-semibold text-slate-500">Supabase Project:</span>{" "}
            <code className="bg-slate-100 px-1 rounded text-slate-700">gjdvzzxsrzuorguwkaih</code>
          </div>
          <div>
            <span className="font-semibold text-slate-500">Hostinger IP:</span>{" "}
            <code className="bg-slate-100 px-1 rounded text-slate-700">93.188.164.224</code>
          </div>
          <div>
            <span className="font-semibold text-slate-500">QB Realm ID:</span>{" "}
            <code className="bg-slate-100 px-1 rounded text-slate-700">123146509258379</code>
          </div>
          <div>
            <span className="font-semibold text-slate-500">R2 Account:</span>{" "}
            <code className="bg-slate-100 px-1 rounded text-slate-700">1417f040cdffb8ba923a28be80d095b6</code>
          </div>
          <div>
            <span className="font-semibold text-slate-500">QB App:</span>{" "}
            <span className="text-slate-700">&ldquo;ClaudeCoded&rdquo; under &ldquo;ClaudeQuick&rdquo;</span>
          </div>
          <div>
            <span className="font-semibold text-slate-500">DB Pooler:</span>{" "}
            <code className="bg-slate-100 px-1 rounded text-slate-700">aws-1-us-east-2.pooler.supabase.com:6543</code>
          </div>
        </div>
      </div>
    </div>
  );
}
