"use client";

import dynamic from "next/dynamic";

const BackupsPage = dynamic(
  () => import("@/app/clauded/backups/page"),
  { ssr: false }
);

export function BackupsTab() {
  return (
    <div className="clauded-embed">
      <BackupsPage />
    </div>
  );
}
