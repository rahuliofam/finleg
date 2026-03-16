"use client";

import { ReleasesTab } from "@/components/intranet/admin/releases-tab";
import Link from "next/link";

export default function ReleasesPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-4">
        <Link
          href="/clauded"
          className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
        >
          ← Clauded
        </Link>
      </div>
      <ReleasesTab />
    </div>
  );
}
