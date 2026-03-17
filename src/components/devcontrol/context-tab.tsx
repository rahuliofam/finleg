"use client";

import dynamic from "next/dynamic";

const ContextPage = dynamic(
  () => import("@/app/devcontrol/context/page"),
  { ssr: false }
);

export function ContextTab() {
  return (
    <div className="-mx-6 -mb-6 bg-slate-900 min-h-[400px] devcontrol-embed">
      <ContextPage />
    </div>
  );
}
