import { getDictionary } from "@/i18n/get-dictionary";
import type { Locale } from "@/i18n/config";
import Image from "next/image";
import Link from "next/link";

export default async function HomePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang: rawLang } = await params;
  const lang = rawLang as Locale;
  const dict = await getDictionary(lang);

  const features = [
    {
      icon: (
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
        </svg>
      ),
      title: "AI-Powered Insights",
      description: "Leverage cutting-edge AI to navigate complex financial regulations and legal requirements with confidence.",
    },
    {
      icon: (
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v2.25A2.25 2.25 0 006 10.5zm0 9.75h2.25A2.25 2.25 0 0010.5 18v-2.25a2.25 2.25 0 00-2.25-2.25H6a2.25 2.25 0 00-2.25 2.25V18A2.25 2.25 0 006 20.25zm9.75-9.75H18a2.25 2.25 0 002.25-2.25V6A2.25 2.25 0 0018 3.75h-2.25A2.25 2.25 0 0013.5 6v2.25a2.25 2.25 0 002.25 2.25z" />
        </svg>
      ),
      title: "Unified Platform",
      description: "No more juggling between finance and legal tools. Everything you need, streamlined in one place.",
    },
    {
      icon: (
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>
      ),
      title: "Built for Speed",
      description: "What used to take days now takes minutes. Automate compliance checks, contract reviews, and financial analysis.",
    },
  ];

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#0f3d1e] via-[#1B6B3A] to-[#145530] animate-gradient text-white">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-white/5 blur-3xl" />
        </div>
        <div className="relative max-w-6xl mx-auto px-6 py-24 sm:py-32 lg:py-40">
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
            {/* Left: Text */}
            <div className="flex-1 text-center lg:text-left">
              <div className="mb-4 lg:mb-6">
                <Image
                  src="/finleg-wordmark.png"
                  alt="Finleg"
                  width={500}
                  height={150}
                  className="h-40 sm:h-52 lg:h-64 w-auto mx-auto lg:mx-0 -my-8 sm:-my-12 lg:-my-16 invert contrast-200 mix-blend-screen"
                  priority
                />
              </div>
              <p className="text-xl sm:text-2xl lg:text-3xl font-light text-white/90 leading-relaxed mb-8 max-w-xl mx-auto lg:mx-0">
                Financial and legal hassles — now united in a single AI platform.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
                <Link
                  href={`/${lang}/signin`}
                  className="inline-flex items-center gap-2 px-8 py-3.5 bg-white text-[#1B6B3A] rounded-full font-semibold text-lg hover:bg-white/90 transition-all hover:shadow-lg hover:shadow-white/20"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Sign in with Google
                </Link>
                <Link
                  href={`/${lang}/about`}
                  className="inline-flex items-center gap-2 px-8 py-3.5 border-2 border-white/30 text-white rounded-full font-medium text-lg hover:bg-white/10 transition-all"
                >
                  Learn More
                </Link>
              </div>
            </div>

            {/* Right: Visual */}
            <div className="flex-1 flex justify-center lg:justify-end">
              <div className="relative w-64 h-64 sm:w-80 sm:h-80 lg:w-96 lg:h-96">
                <div className="absolute inset-0 rounded-3xl bg-white/10 backdrop-blur-sm border border-white/20 rotate-6" />
                <div className="absolute inset-0 rounded-3xl bg-white/5 backdrop-blur-sm border border-white/10 -rotate-3" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Image
                    src="/finleg-logo.png"
                    alt="Finleg"
                    width={300}
                    height={200}
                    className="w-3/4 h-auto drop-shadow-2xl mix-blend-multiply"
                    priority
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Wave divider */}
        <svg className="absolute bottom-0 left-0 w-full" viewBox="0 0 1440 80" preserveAspectRatio="none">
          <path fill="white" d="M0,40 C360,80 720,0 1080,40 C1260,60 1380,50 1440,40 L1440,80 L0,80 Z" />
        </svg>
      </section>

      {/* Features */}
      <section className="py-20 sm:py-28 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              Why Finleg?
            </h2>
            <p className="text-lg text-slate-500 max-w-2xl mx-auto">
              One platform to handle the complexity where finance meets law.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, i) => (
              <div
                key={i}
                className="group p-8 rounded-2xl border border-slate-200 hover:border-[#1B6B3A]/30 bg-white hover:shadow-xl hover:shadow-[#1B6B3A]/5 transition-all duration-300"
              >
                <div className="w-14 h-14 rounded-xl bg-[#e8f5ec] text-[#1B6B3A] flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-semibold text-slate-900 mb-3">
                  {feature.title}
                </h3>
                <p className="text-slate-500 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mission / CTA */}
      <section className="py-20 sm:py-28 px-6 bg-slate-50">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-6">
            {dict.home.mission.title}
          </h2>
          <p className="text-lg sm:text-xl text-slate-600 leading-relaxed mb-10">
            {dict.home.mission.description}
          </p>
          <Link
            href={`/${lang}/signin`}
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-[#1B6B3A] hover:bg-[#145530] text-white rounded-full font-semibold text-lg transition-colors"
          >
            {dict.home.hero.cta}
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        </div>
      </section>
    </>
  );
}
