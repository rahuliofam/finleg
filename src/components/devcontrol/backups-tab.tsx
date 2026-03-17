"use client";

import dynamic from "next/dynamic";

const BackupsPage = dynamic(
  () => import("@/app/devcontrol/backups/page"),
  { ssr: false }
);

export function BackupsTab() {
  return (
    <div className="devcontrol-embed">
      <BackupsPage />
    </div>
  );
}
