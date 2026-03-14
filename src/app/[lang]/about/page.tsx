import { getDictionary } from "@/i18n/get-dictionary";
import type { Locale } from "@/i18n/config";

export default async function AboutPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang: rawLang } = await params;
  const lang = rawLang as Locale;
  const dict = await getDictionary(lang);

  return (
    <div className="py-20 px-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-4xl font-bold mb-4">{dict.about.title}</h1>
        <p className="text-lg text-slate-600 mb-12">{dict.about.description}</p>

        <section>
          <h2 className="text-2xl font-semibold mb-4">
            {dict.about.history.title}
          </h2>
          <p className="text-slate-600 leading-relaxed">
            {dict.about.history.content}
          </p>
        </section>
      </div>
    </div>
  );
}
