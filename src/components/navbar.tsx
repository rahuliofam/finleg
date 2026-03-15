"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Dictionary } from "@/i18n/types";
import { type Locale, INTRANET_LOCALES } from "@/i18n/config";
import { useAuth } from "@/contexts/auth-context";
import versionData from "@/../version.json";

export function Navbar({ dict, lang }: { dict: Dictionary; lang: Locale }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();

  const intranetLang = INTRANET_LOCALES.includes(lang) ? lang : "en";

  // Hide public navbar on intranet pages (intranet has its own header)
  if (pathname.includes("/intranet")) {
    return null;
  }

  return (
    <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-6 flex items-center justify-between h-16">
        <Link href={`/${lang}`} className="flex items-center gap-2">
          <img src="/finleg-logo.png" alt="Finleg" className="h-12 w-auto mix-blend-multiply" />
          <img src="/finleg-wordmark.png" alt="Finleg" className="h-9 w-auto mix-blend-multiply" />
        </Link>

        <div className="flex items-center gap-4">
          <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
            {versionData.version}
          </span>
          <Link
            href={`/${lang}/about`}
            className={`text-sm font-medium transition-colors hover:text-[#1B6B3A] ${
              pathname.includes("/about") ? "text-[#1B6B3A]" : "text-slate-700"
            }`}
          >
            About
          </Link>
          {!loading && (
            user ? (
              <Link
                href={`/${intranetLang}/intranet`}
                className="text-sm font-medium px-5 py-2 bg-[#1B6B3A] hover:bg-[#145530] text-white rounded-full transition-colors"
              >
                {dict.nav.intranet}
              </Link>
            ) : (
              <Link
                href={`/${intranetLang}/signin`}
                className="text-sm font-medium px-5 py-2 bg-[#1B6B3A] hover:bg-[#145530] text-white rounded-full transition-colors"
              >
                {dict.nav.signIn}
              </Link>
            )
          )}
        </div>
      </div>
    </nav>
  );
}
