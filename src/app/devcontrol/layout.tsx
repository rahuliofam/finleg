"use client";

import { AuthGuard } from "@/components/auth-guard";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const TABS = [
  { href: "/devcontrol", label: "TOC", exact: true },
  { href: "/devcontrol/releases", label: "Releases" },
  { href: "/devcontrol/sessions", label: "Sessions" },
  { href: "/devcontrol/tokens", label: "Tokens & Cost" },
  { href: "/devcontrol/context", label: "Context Window" },
  { href: "/devcontrol/backups", label: "Backups" },
  { href: "/devcontrol/planlist", label: "Planlist" },
];

export default function DevControlLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <AuthGuard>
      <nav className="border-b border-zinc-700 bg-zinc-900">
        <div className="max-w-6xl mx-auto px-6 flex gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const isActive = tab.exact
              ? pathname === tab.href
              : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  isActive
                    ? "border-emerald-400 text-emerald-400"
                    : "border-transparent text-zinc-400 hover:text-white hover:border-zinc-500"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
      {children}
    </AuthGuard>
  );
}
