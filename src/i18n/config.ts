export const i18n = {
  defaultLocale: "en",
  // Add locales here during setup. All dictionaries in src/i18n/dictionaries/
  // must have a matching JSON file for each locale listed.
  locales: ["en", "es", "fr"],
} as const;

export type Locale = (typeof i18n)["locales"][number];

// Locales that support the intranet interface
export const INTRANET_LOCALES: Locale[] = ["en"];

export const localeNames: Record<Locale, string> = {
  en: "English",
  es: "Espa\u00f1ol",
  fr: "Fran\u00e7ais",
};

export const localeFlags: Record<Locale, string> = {
  en: "\u{1F1FA}\u{1F1F8}",
  es: "\u{1F1EA}\u{1F1F8}",
  fr: "\u{1F1EB}\u{1F1F7}",
};
