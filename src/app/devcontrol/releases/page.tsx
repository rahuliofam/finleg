"use client";

import { ReleasesTab } from "@/components/intranet/admin/releases-tab";
import Link from "next/link";

export default function ReleasesPage() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="mb-6">
        <Link
          href="/devcontrol"
          className="text-base text-zinc-400 hover:text-white transition-colors"
        >
          ← DevControl
        </Link>
      </div>
      <ReleasesTab />
    </div>
  );
}
