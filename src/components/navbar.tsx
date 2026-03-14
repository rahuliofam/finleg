"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Dictionary } from "@/i18n/types";
import { type Locale, INTRANET_LOCALES } from "@/i18n/config";
import { LanguageSwitcher } from "./language-switcher";
import { useAuth } from "@/contexts/auth-context";
import { useState } from "react";

export function Navbar({ dict, lang }: { dict: Dictionary; lang: Locale }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, loading } = useAuth();

  // Intranet only supports EN and BO - fall back to EN for other locales
  const intranetLang = INTRANET_LOCALES.includes(lang) ? lang : "en";

  // Hide public navbar on intranet pages (intranet has its own header)
  if (pathname.includes("/intranet")) {
    return null;
  }

  const links = [
    { href: `/${lang}`, label: dict.nav.home },
    { href: `/${lang}/about`, label: dict.nav.about },
    { href: `/${lang}/programs`, label: dict.nav.programs },
    { href: `/${lang}/contact`, label: dict.nav.contact },
  ];

  return (
    <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-6 flex items-center justify-between h-16">
        <Link href={`/${lang}`} className="text-xl font-bold">
          {dict.metadata.title}
        </Link>

        {/* Desktop nav */}
        <div className="hidden sm:flex items-center gap-6">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm font-medium transition-colors hover:text-amber-600 ${
                pathname === link.href ? "text-amber-600" : "text-slate-700"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <LanguageSwitcher lang={lang} />
          {!loading && (
            user ? (
              <Link
                href={`/${intranetLang}/intranet`}
                className="text-sm font-medium px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors"
              >
                {dict.nav.intranet}
              </Link>
            ) : (
              <Link
                href={`/${intranetLang}/signin`}
                className="text-sm font-medium px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors"
              >
                {dict.nav.signIn}
              </Link>
            )
          )}
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="sm:hidden p-2 text-slate-700"
          aria-label="Toggle menu"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {menuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="sm:hidden border-t border-slate-200 bg-white px-6 py-4 space-y-3">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className={`block text-sm font-medium ${
                pathname === link.href ? "text-amber-600" : "text-slate-700"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <div className="pt-2">
            <LanguageSwitcher lang={lang} />
          </div>
          {!loading && (
            <div className="pt-2">
              {user ? (
                <Link
                  href={`/${intranetLang}/intranet`}
                  onClick={() => setMenuOpen(false)}
                  className="block text-sm font-medium text-amber-600"
                >
                  {dict.nav.intranet}
                </Link>
              ) : (
                <Link
                  href={`/${intranetLang}/signin`}
                  onClick={() => setMenuOpen(false)}
                  className="block text-sm font-medium text-amber-600"
                >
                  {dict.nav.signIn}
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
