"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import versionData from "@/../version.json";

export function Navbar() {
  const pathname = usePathname();
  const { user, loading } = useAuth();

  // Hide public navbar on intranet pages (intranet has its own header)
  if (pathname.includes("/intranet")) {
    return null;
  }

  return (
    <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-6 flex items-center justify-between h-16">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
            <img src="/finleg-logo-transparent.png" alt="Finleg" className="h-12 w-auto" />
            <img src="/finleg-wordmark-transparent.png" alt="Finleg" className="h-[6.75rem] w-auto" />
          </Link>
          <span className="text-lg text-slate-500 font-mono hidden sm:inline">
            {versionData.version}
          </span>
        </div>

        <div className="flex items-center gap-4">
          <Link
            href="/about"
            className={`text-sm font-medium transition-colors hover:text-[#1B6B3A] ${
              pathname.includes("/about") ? "text-[#1B6B3A]" : "text-slate-700"
            }`}
          >
            About
          </Link>
          {!loading && (
            user ? (
              <Link
                href="/intranet"
                className="text-sm font-medium px-5 py-2 bg-[#1B6B3A] hover:bg-[#145530] text-white rounded-full transition-colors"
              >
                Dashboard
              </Link>
            ) : (
              <Link
                href="/signin"
                className="text-sm font-medium px-5 py-2 bg-[#1B6B3A] hover:bg-[#145530] text-white rounded-full transition-colors"
              >
                Sign In
              </Link>
            )
          )}
        </div>
      </div>
    </nav>
  );
}
