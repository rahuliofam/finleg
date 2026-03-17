"use client";

import dynamic from "next/dynamic";

const ContextPage = dynamic(
  () => import("@/app/clauded/context/page"),
  { ssr: false }
);

export function ContextTab() {
  return (
    <div className="-mx-6 -mb-6 bg-slate-900 min-h-[400px] clauded-embed">
      <ContextPage />
    </div>
  );
}
