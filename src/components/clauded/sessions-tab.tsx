"use client";

import dynamic from "next/dynamic";

const SessionsPage = dynamic(
  () => import("@/app/clauded/sessions/page"),
  { ssr: false }
);

export function SessionsTab() {
  return (
    <div className="-mx-6 -mb-6 bg-slate-900 min-h-[600px] clauded-embed">
      <SessionsPage />
    </div>
  );
}
