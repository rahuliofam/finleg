"use client";

import dynamic from "next/dynamic";

const TokensPage = dynamic(
  () => import("@/app/clauded/tokens/page"),
  { ssr: false }
);

export function TokensTab() {
  return (
    <div className="-mx-6 -mb-6 bg-slate-900 min-h-[400px] clauded-embed">
      <TokensPage />
    </div>
  );
}
