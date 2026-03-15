import { getDictionary } from "@/i18n/get-dictionary";
import type { Locale } from "@/i18n/config";
import Image from "next/image";

export default async function AboutPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang: rawLang } = await params;
  const lang = rawLang as Locale;
  const dict = await getDictionary(lang);

  return (
    <>
      {/* Hero banner */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#0f3d1e] via-[#1B6B3A] to-[#145530] text-white">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-white/5 blur-3xl" />
        </div>
        <div className="relative max-w-4xl mx-auto px-6 py-20 sm:py-28 text-center">
          <Image
            src="/finleg-wordmark-white.png"
            alt="Finleg"
            width={400}
            height={120}
            className="w-48 sm:w-64 mx-auto mb-8"
          />
          <h1 className="text-4xl sm:text-5xl font-bold mb-4">
            {dict.about.title}
          </h1>
          <p className="text-xl sm:text-2xl font-light text-white/85 max-w-2xl mx-auto">
            {dict.about.description}
          </p>
        </div>
        <svg className="absolute bottom-0 left-0 w-full" viewBox="0 0 1440 60" preserveAspectRatio="none">
          <path fill="white" d="M0,30 C360,60 720,0 1080,30 C1260,45 1380,38 1440,30 L1440,60 L0,60 Z" />
        </svg>
      </section>

      {/* Content */}
      <section className="py-16 sm:py-24 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-start gap-8 mb-16">
            <div className="hidden sm:block flex-shrink-0">
              <Image
                src="/finleg-logo-transparent.png"
                alt="Finleg logo"
                width={120}
                height={80}
                className="w-28"
              />
            </div>
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">
                {dict.about.history.title}
              </h2>
              <p className="text-lg text-slate-600 leading-relaxed">
                {dict.about.history.content}
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
