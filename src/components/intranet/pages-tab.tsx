"use client";

interface PageEntry {
  title: string;
  summary: string;
  date: string;
  url: string;
  category: string;
}

const PAGES: PageEntry[] = [
  {
    title: "Hannah & Jackie — Financial Snapshot",
    summary:
      "Combined assets, income (3-year history), and supporting documents for Hannah Sonnad & Jackie Giroux. Includes all Schwab account balances, 2025 earned income breakdown, K-1 trust distributions, and links to statements.",
    date: "2026-04-11",
    url: "/tax/hjfinshot.html",
    category: "Financial",
  },
  {
    title: "2025 Retirement Plan Analysis",
    summary:
      "Comprehensive retirement contribution strategy for all family members. Covers Roth IRA eligibility, Solo 401(k) capacity based on SE income, inherited IRA distribution schedules, and contribution deadlines.",
    date: "2026-04-09",
    url: "/tax/retirement-plan-2025.html",
    category: "Tax & Retirement",
  },
  {
    title: "SubTrust IRA Distribution Worksheet — 2025",
    summary:
      "Tracks inherited IRA distributions from the Revocable Trust of Subhash Sonnad to beneficiaries. Includes RMD calculations, in-kind transfers (GLDM shares), and 10-year rule compliance.",
    date: "2026-04-01",
    url: "/tax/subtrust-ira-2025.html",
    category: "Tax & Retirement",
  },
  {
    title: "2025 Tax Bill Disbursements",
    summary:
      "Property tax payment schedule and disbursement tracking for Snohomish County (WA) and Bastrop County (TX) properties. Shows payment dates, amounts, and trust vs. personal allocations.",
    date: "2026-03-15",
    url: "/tax/taxbills2025disbursements.html",
    category: "Tax",
  },
  {
    title: "K-1 Worksheet — Hannah N. Sonnad (2025)",
    summary:
      "Schedule K-1 (Form 1041) beneficiary worksheet. $230,420.88 total distribution including 1,980 GLDM shares in-kind transfer and $53,013 cash from SubTrust Traditional IRA.",
    date: "2026-04-09",
    url: "/tax/k1-2025-hannah-sonnad.html",
    category: "Tax",
  },
  {
    title: "K-1 Worksheet — Haydn Sonnad (2025)",
    summary:
      "Schedule K-1 (Form 1041) beneficiary worksheet for Haydn Sonnad. Trust distribution details from the Revocable Trust of Subhash Sonnad.",
    date: "2026-04-09",
    url: "/tax/k1-2025-haydn-sonnad.html",
    category: "Tax",
  },
  {
    title: "K-1 Worksheet — Emina Sonnad (2025)",
    summary:
      "Schedule K-1 (Form 1041) beneficiary worksheet for Emina Sonnad. Trust distribution details from the Revocable Trust of Subhash Sonnad.",
    date: "2026-04-09",
    url: "/tax/k1-2025-emina-sonnad.html",
    category: "Tax",
  },
  {
    title: "K-1 Worksheet — Jon Sheppard (2025)",
    summary:
      "Schedule K-1 (Form 1041) beneficiary worksheet for Jon Sheppard. Trust distribution details from the Revocable Trust of Subhash Sonnad.",
    date: "2026-04-09",
    url: "/tax/k1-2025-jon-sheppard.html",
    category: "Tax",
  },
];

// Sort reverse chronological, then alphabetical within same date
const SORTED_PAGES = [...PAGES].sort((a, b) => {
  const dateCompare = b.date.localeCompare(a.date);
  if (dateCompare !== 0) return dateCompare;
  return a.title.localeCompare(b.title);
});

const CATEGORY_COLORS: Record<string, string> = {
  Financial: "bg-blue-100 text-blue-700",
  Tax: "bg-amber-100 text-amber-700",
  "Tax & Retirement": "bg-purple-100 text-purple-700",
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function PagesTab() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Pages</h1>
      <p className="text-sm text-slate-500 mb-6">
        Standalone pages created for tax worksheets, financial snapshots, and
        other documents.
      </p>

      <div className="space-y-3">
        {SORTED_PAGES.map((page) => (
          <a
            key={page.url}
            href={page.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm transition-all"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-slate-900 text-sm">
                    {page.title}
                  </h3>
                  <span
                    className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${CATEGORY_COLORS[page.category] || "bg-slate-100 text-slate-600"}`}
                  >
                    {page.category}
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {page.summary}
                </p>
              </div>
              <div className="text-xs text-slate-400 whitespace-nowrap pt-0.5">
                {formatDate(page.date)}
              </div>
            </div>
          </a>
        ))}
      </div>

      <div className="mt-6 text-xs text-slate-400 text-center">
        {SORTED_PAGES.length} pages
      </div>
    </div>
  );
}
