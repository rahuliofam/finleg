import { getDictionary } from "@/i18n/get-dictionary";
import type { Locale } from "@/i18n/config";
import Link from "next/link";

export default async function HomePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang: rawLang } = await params;
  const lang = rawLang as Locale;
  const dict = await getDictionary(lang);

  return (
    <>
      <section className="relative py-24 px-6 text-center bg-gradient-to-b from-slate-900 to-slate-800 text-white">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-bold mb-6">
            {dict.home.hero.title}
          </h1>
          <p className="text-lg sm:text-xl text-slate-300 mb-8">
            {dict.home.hero.subtitle}
          </p>
          <Link
            href={`/${lang}/about`}
            className="inline-block px-8 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-colors"
          >
            {dict.home.hero.cta}
          </Link>
        </div>
      </section>

      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-6">{dict.home.mission.title}</h2>
          <p className="text-lg text-slate-600 leading-relaxed">
            {dict.home.mission.description}
          </p>
        </div>
      </section>
    </>
  );
}
