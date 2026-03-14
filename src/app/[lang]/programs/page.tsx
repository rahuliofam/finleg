import { getDictionary } from "@/i18n/get-dictionary";
import type { Locale } from "@/i18n/config";

export default async function ProgramsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang: rawLang } = await params;
  const lang = rawLang as Locale;
  const dict = await getDictionary(lang);

  return (
    <div className="py-20 px-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-4">{dict.programs.title}</h1>
        <p className="text-lg text-slate-600 mb-12">
          {dict.programs.description}
        </p>

        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {dict.programs.list.map((program, i) => (
            <div
              key={i}
              className="rounded-xl border border-slate-200 p-6 hover:shadow-lg transition-shadow"
            >
              <h3 className="text-xl font-semibold mb-3">{program.title}</h3>
              <p className="text-slate-600">{program.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
