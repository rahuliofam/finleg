"use client";

import { useState } from "react";

// ============================================================
// Data model — visual documentation of the API data pipeline
// ============================================================

interface PipelineStage {
  id: string;
  label: string;
  icon: string;
  color: string;
  description: string;
}

interface DataFlow {
  from: string;
  to: string;
  label: string;
  description: string;
}

interface TableGroup {
  group: string;
  color: string;
  tables: {
    name: string;
    purpose: string;
    source: string;
    keyColumns: string[];
    relations?: string[];
  }[];
}

const PIPELINE_STAGES: PipelineStage[] = [
  {
    id: "sources",
    label: "Data Sources",
    icon: "🏦",
    color: "blue",
    description: "External financial APIs and file imports that feed data into the system.",
  },
  {
    id: "ingest",
    label: "Ingest Layer",
    icon: "⚡",
    color: "amber",
    description: "Workers and Edge Functions that handle OAuth, API calls, and data transformation.",
  },
  {
    id: "storage",
    label: "Storage Layer",
    icon: "🗄️",
    color: "green",
    description: "Supabase PostgreSQL tables organized by the PlaidPlus universal schema.",
  },
  {
    id: "presentation",
    label: "Presentation",
    icon: "📊",
    color: "purple",
    description: "Frontend tabs and dashboards that display the aggregated financial data.",
  },
];

const DATA_FLOWS: DataFlow[] = [
  {
    from: "Charles Schwab API",
    to: "schwab-oauth Worker",
    label: "OAuth 2.0",
    description: "User clicks 'Connect Schwab' → redirects to Schwab login → callback exchanges code for tokens → encrypted tokens stored in oauth_tokens table.",
  },
  {
    from: "schwab-oauth Worker",
    to: "oauth_tokens",
    label: "Encrypted Tokens",
    description: "AES-256-GCM encrypted access + refresh tokens. Access tokens expire in 30 min, refresh tokens in 7 days.",
  },
  {
    from: "schwab-sync Edge Function",
    to: "accounts / holdings / transactions",
    label: "API Sync",
    description: "Reads encrypted tokens → refreshes if needed → calls Schwab Trader API → upserts into PlaidPlus tables.",
  },
  {
    from: "QuickBooks API",
    to: "qb-sync Edge Function",
    label: "OAuth 2.0",
    description: "Similar pattern: OAuth tokens in qb_tokens → daily/weekly sync → upserts into qb_transactions.",
  },
  {
    from: "Statement PDFs (R2)",
    to: "Ingestion Scripts",
    label: "Claude AI Parse",
    description: "Bank/credit card/investment PDFs uploaded to R2 → parsed by Claude → structured data inserted into statement tables.",
  },
  {
    from: "pg_cron",
    to: "schwab-sync-scheduled",
    label: "Scheduled Sync",
    description: "Daily (Mon-Fri 7AM UTC): positions + balances only. Weekly (Sun 3AM UTC): full sync including 30 days of transactions.",
  },
];

const TABLE_GROUPS: TableGroup[] = [
  {
    group: "PlaidPlus Core (Universal)",
    color: "emerald",
    tables: [
      {
        name: "institutions",
        purpose: "Banks, brokerages, credit unions",
        source: "Migration seed + API discovery",
        keyColumns: ["name", "institution_type"],
        relations: ["→ accounts.institution_id", "→ oauth_tokens.institution_id"],
      },
      {
        name: "accounts",
        purpose: "Every financial account across all institutions",
        source: "Schwab API sync / manual entry",
        keyColumns: ["institution_id", "account_type", "external_account_id", "total_value"],
        relations: ["→ holdings.account_id", "→ transactions.account_id", "→ account_balances.account_id"],
      },
      {
        name: "securities",
        purpose: "Normalized instrument reference (stocks, ETFs, bonds, etc.)",
        source: "Schwab API position data",
        keyColumns: ["ticker_symbol", "cusip", "security_type", "name"],
        relations: ["→ holdings.security_id", "→ transactions.security_id"],
      },
      {
        name: "holdings",
        purpose: "Current positions snapshot (updated each sync)",
        source: "Schwab API sync",
        keyColumns: ["account_id", "security_id", "quantity", "market_value", "unrealized_gain_loss"],
      },
      {
        name: "transactions",
        purpose: "Unified transaction history across all account types",
        source: "Schwab API / PDF parsing / manual",
        keyColumns: ["account_id", "transaction_type", "transaction_date", "amount", "external_id"],
      },
      {
        name: "account_balances",
        purpose: "Historical daily balance snapshots",
        source: "Schwab API sync (daily)",
        keyColumns: ["account_id", "snapshot_date", "total_value", "cash_balance"],
      },
      {
        name: "tax_lots",
        purpose: "Per-acquisition cost basis tracking for tax reporting",
        source: "Schwab API / manual entry",
        keyColumns: ["account_id", "security_id", "acquired_date", "cost_basis", "gain_loss"],
      },
      {
        name: "oauth_tokens",
        purpose: "Encrypted API credentials per institution",
        source: "OAuth callback (schwab-oauth Worker)",
        keyColumns: ["institution_id", "status", "access_token_expires_at", "refresh_token_expires_at"],
      },
    ],
  },
  {
    group: "QuickBooks (Bookkeeping)",
    color: "blue",
    tables: [
      {
        name: "qb_tokens",
        purpose: "QuickBooks OAuth tokens (single row)",
        source: "OAuth flow",
        keyColumns: ["realm_id", "access_token", "refresh_token", "expires_at"],
      },
      {
        name: "qb_transactions",
        purpose: "Purchases, deposits, transfers, journal entries from QB",
        source: "QB API sync",
        keyColumns: ["qb_id", "qb_type", "txn_date", "amount", "our_category", "review_status"],
      },
      {
        name: "category_rules",
        purpose: "Vendor → category mapping rules (learned + manual)",
        source: "AI learning + manual rules",
        keyColumns: ["match_pattern", "match_type", "category", "hit_count"],
      },
    ],
  },
  {
    group: "Sync & Operations",
    color: "slate",
    tables: [
      {
        name: "brokerage_sync_runs",
        purpose: "Execution log for brokerage API syncs",
        source: "schwab-sync edge function",
        keyColumns: ["institution_id", "sync_type", "status", "accounts_synced", "holdings_synced"],
      },
      {
        name: "sync_runs",
        purpose: "Execution log for QB syncs",
        source: "qb-sync edge function",
        keyColumns: ["sync_type", "status", "entities_fetched", "source"],
      },
      {
        name: "integrity_findings",
        purpose: "Data quality issues (auto-detected)",
        source: "qb-integrity-check",
        keyColumns: ["finding_type", "severity", "entity_type", "resolved_at"],
      },
    ],
  },
  {
    group: "Statement Ingestion (PDF)",
    color: "orange",
    tables: [
      {
        name: "document_index",
        purpose: "Master index of all R2-stored documents",
        source: "R2 upload scripts",
        keyColumns: ["r2_key", "institution", "category", "account_type"],
      },
      {
        name: "cc_statement_summaries / cc_transactions",
        purpose: "Credit card statement data parsed from PDFs",
        source: "Claude AI extraction",
        keyColumns: ["statement_date", "total_charges", "amount"],
      },
      {
        name: "checking_statement_summaries / checking_transactions",
        purpose: "Checking account statement data parsed from PDFs",
        source: "Claude AI extraction",
        keyColumns: ["statement_date", "ending_balance", "amount"],
      },
      {
        name: "investment_statement_summaries / investment_transactions",
        purpose: "Investment statement data parsed from PDFs",
        source: "Claude AI extraction",
        keyColumns: ["statement_date", "total_value", "symbol"],
      },
    ],
  },
];

const ARCHITECTURE_DIAGRAM = `
┌─────────────────────────────────────────────────────────────────────┐
│                         DATA SOURCES                                │
│                                                                     │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────────┐   │
│   │  Schwab   │   │QuickBooks│   │   R2     │   │   Manual     │   │
│   │  API      │   │  API     │   │  PDFs    │   │   Entry      │   │
│   └────┬─────┘   └────┬─────┘   └────┬─────┘   └──────┬───────┘   │
└────────┼──────────────┼──────────────┼─────────────────┼───────────┘
         │              │              │                 │
         ▼              ▼              ▼                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        INGEST LAYER                                 │
│                                                                     │
│   ┌──────────────┐  ┌─────────────┐  ┌───────────────────────┐    │
│   │ schwab-oauth │  │  qb-sync    │  │ ingest-statements.mjs │    │
│   │ CF Worker    │  │  Edge Fn    │  │ (Hostinger VPS)       │    │
│   │              │  │             │  │                       │    │
│   │ /schwab/auth │  │ Token mgmt  │  │ Claude AI parsing     │    │
│   │ /schwab/     │  │ API fetch   │  │ JSON extraction       │    │
│   │   callback   │  │ Upsert      │  │ Table insertion       │    │
│   └──────┬───────┘  └──────┬──────┘  └───────────┬───────────┘    │
│          │                 │                     │                 │
│   ┌──────┴───────┐  ┌─────┴──────────┐  ┌──────┴────────────┐    │
│   │ schwab-sync  │  │ qb-sync-       │  │ extract-doc-       │    │
│   │ Edge Fn      │  │ scheduled      │  │ metadata.mjs       │    │
│   │              │  │ Edge Fn        │  │ (Hostinger VPS)    │    │
│   └──────┬───────┘  └────────────────┘  └────────────────────┘    │
└──────────┼────────────────────────────────────────────────────────-┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    SUPABASE POSTGRESQL                               │
│                                                                     │
│  ┌─ PlaidPlus Core ─────────────────────────────────────────────┐  │
│  │ institutions → accounts → holdings    (← securities)         │  │
│  │                        → transactions (← securities)         │  │
│  │                        → account_balances                    │  │
│  │              → oauth_tokens                                  │  │
│  │                        → tax_lots                            │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ QuickBooks ─────────────┐  ┌─ Statement PDFs ───────────────┐  │
│  │ qb_tokens                │  │ document_index                 │  │
│  │ qb_transactions          │  │ cc_statement_summaries         │  │
│  │ category_rules           │  │ checking_statement_summaries   │  │
│  │ sync_runs                │  │ investment_statement_summaries │  │
│  └──────────────────────────┘  └────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      FRONTEND (Next.js)                             │
│                                                                     │
│   Bookkeeping/Dashboard  │  Bookkeeping/Brokerage  │  File Vault   │
│   Bookkeeping/Categorize │  Bookkeeping/Statements │  How It Works │
└─────────────────────────────────────────────────────────────────────┘
`.trim();

export default function DataPipelinePage() {
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [showDiagram, setShowDiagram] = useState(true);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Data Pipeline</h1>
        <p className="text-sm text-slate-500 mt-1">
          How financial data flows from external APIs into the database and onto the screen.
        </p>
      </div>

      {/* Architecture Diagram */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden mb-6">
        <button
          onClick={() => setShowDiagram(!showDiagram)}
          className="w-full px-4 py-3 border-b border-slate-100 flex items-center justify-between hover:bg-slate-50"
        >
          <h3 className="text-sm font-semibold text-slate-900">Architecture Overview</h3>
          <span className="text-xs text-slate-400">{showDiagram ? "Hide" : "Show"}</span>
        </button>
        {showDiagram && (
          <pre className="px-4 py-4 text-xs font-mono text-slate-700 overflow-x-auto bg-slate-50 leading-relaxed">
            {ARCHITECTURE_DIAGRAM}
          </pre>
        )}
      </div>

      {/* Pipeline Stages */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6">
        {PIPELINE_STAGES.map((stage) => (
          <div key={stage.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-2xl mb-2">{stage.icon}</div>
            <div className="text-sm font-semibold text-slate-900 mb-1">{stage.label}</div>
            <div className="text-xs text-slate-500">{stage.description}</div>
          </div>
        ))}
      </div>

      {/* Data Flows */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">Data Flows</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {DATA_FLOWS.map((flow, i) => (
            <div key={i} className="px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{flow.from}</span>
                <span className="text-slate-400 text-xs">→</span>
                <span className="text-xs font-mono bg-green-50 text-green-700 px-1.5 py-0.5 rounded">{flow.to}</span>
                <span className="text-xs font-medium text-amber-600 ml-auto">{flow.label}</span>
              </div>
              <p className="text-xs text-slate-500">{flow.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Table Groups */}
      <div className="mb-4">
        <h2 className="text-lg font-bold text-slate-900 mb-3">Database Tables</h2>
        <div className="flex gap-2 mb-4 flex-wrap">
          <button
            onClick={() => setActiveGroup(null)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              !activeGroup ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            All
          </button>
          {TABLE_GROUPS.map((g) => (
            <button
              key={g.group}
              onClick={() => setActiveGroup(activeGroup === g.group ? null : g.group)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                activeGroup === g.group ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {g.group}
            </button>
          ))}
        </div>
      </div>

      {TABLE_GROUPS
        .filter((g) => !activeGroup || g.group === activeGroup)
        .map((group) => (
          <div key={group.group} className="rounded-xl border border-slate-200 bg-white overflow-hidden mb-4">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900">{group.group}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="px-4 py-2 font-medium">Table</th>
                    <th className="px-4 py-2 font-medium">Purpose</th>
                    <th className="px-4 py-2 font-medium">Source</th>
                    <th className="px-4 py-2 font-medium">Key Columns</th>
                  </tr>
                </thead>
                <tbody>
                  {group.tables.map((t) => (
                    <tr key={t.name} className="border-b border-slate-50 hover:bg-slate-25">
                      <td className="px-4 py-2.5 font-mono text-xs font-medium text-slate-900 whitespace-nowrap">
                        {t.name}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 text-xs">{t.purpose}</td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">{t.source}</td>
                      <td className="px-4 py-2.5 text-xs">
                        <div className="flex flex-wrap gap-1">
                          {t.keyColumns.map((col) => (
                            <span key={col} className="font-mono bg-slate-100 text-slate-600 px-1 py-0.5 rounded text-[10px]">
                              {col}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {group.tables.some((t) => t.relations) && (
              <div className="px-4 py-2 border-t border-slate-100 bg-slate-50">
                <div className="text-[10px] font-mono text-slate-500">
                  {group.tables
                    .filter((t) => t.relations)
                    .flatMap((t) => t.relations!.map((r) => `${t.name} ${r}`))
                    .join("  ·  ")}
                </div>
              </div>
            )}
          </div>
        ))}

      {/* OAuth Flow Detail */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">Schwab OAuth Flow (Detail)</h3>
        </div>
        <div className="px-4 py-4">
          <div className="space-y-3">
            {[
              { step: "1", label: "User clicks 'Connect Schwab'", detail: "Browser navigates to schwab-oauth.finleg.workers.dev/schwab/auth" },
              { step: "2", label: "Worker redirects to Schwab login", detail: "Schwab OAuth authorize URL with client_id and callback URL" },
              { step: "3", label: "User authenticates at Schwab", detail: "Schwab returns authorization code to callback URL" },
              { step: "4", label: "Worker exchanges code for tokens", detail: "POST to Schwab token endpoint with Basic auth (appKey:appSecret)" },
              { step: "5", label: "Tokens encrypted and stored", detail: "AES-256-GCM encryption → upsert into oauth_tokens (keyed by institution_id)" },
              { step: "6", label: "Redirect back to intranet", detail: "Browser returns to /intranet/bookkeeping/brokerage?schwab=connected" },
              { step: "7", label: "schwab-sync pulls data", detail: "Reads encrypted tokens → calls Schwab Trader API → upserts accounts, holdings, transactions" },
              { step: "8", label: "Daily/weekly cron maintains sync", detail: "pg_cron → schwab-sync-scheduled → schwab-sync (positions daily, transactions weekly)" },
            ].map((s) => (
              <div key={s.step} className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center">
                  {s.step}
                </div>
                <div>
                  <div className="text-sm font-medium text-slate-900">{s.label}</div>
                  <div className="text-xs text-slate-500">{s.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
