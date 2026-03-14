"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { i18n, localeNames, localeFlags, type Locale } from "@/i18n/config";

export function LanguageSwitcher({ lang }: { lang: Locale }) {
  const pathname = usePathname();

  function getLocalePath(locale: Locale) {
    const segments = pathname.split("/");
    segments[1] = locale;
    return segments.join("/");
  }

  return (
    <div className="flex items-center gap-1">
      {i18n.locales.map((locale) => (
        <Link
          key={locale}
          href={getLocalePath(locale)}
          title={localeNames[locale]}
          className={`text-xl leading-none p-1 rounded transition-opacity ${
            locale === lang ? "opacity-100" : "opacity-50 hover:opacity-100"
          }`}
        >
          {localeFlags[locale]}
        </Link>
      ))}
    </div>
  );
}
