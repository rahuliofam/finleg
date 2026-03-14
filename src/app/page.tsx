"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { i18n } from "@/i18n/config";
import type { Locale } from "@/i18n/config";

function getPreferredLocale(): Locale {
  if (typeof navigator === "undefined") return i18n.defaultLocale;

  const languages = navigator.languages || [navigator.language];
  for (const lang of languages) {
    const code = lang.split("-")[0].toLowerCase();
    const match = i18n.locales.find((l) => l === code);
    if (match) return match;
  }

  return i18n.defaultLocale;
}

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    const locale = getPreferredLocale();
    router.replace(`/${locale}`);
  }, [router]);

  return null;
}
