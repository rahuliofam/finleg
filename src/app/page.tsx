import Image from "next/image";
import Link from "next/link";

export default function HomePage() {
  return (
    <>
      {/* Hero — full viewport */}
      <section className="relative min-h-[calc(100vh-4rem)] flex items-center overflow-hidden bg-gradient-to-br from-[#0f3d1e] via-[#1B6B3A] to-[#145530] animate-gradient text-white">
        {/* Ambient glow */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-white/5 blur-3xl" />
        </div>

        <div className="relative max-w-6xl mx-auto px-6 py-20 sm:py-24 lg:py-28 w-full">
          <div className="flex flex-col lg:flex-row items-center gap-6 lg:gap-8">
            {/* Left: Wordmark + Text + Buttons */}
            <div className="flex-1 flex flex-col items-center lg:items-start">
              <Image
                src="/finleg-wordmark-white.png"
                alt="Finleg"
                width={654}
                height={301}
                className="w-full max-w-[16rem] sm:max-w-xs lg:max-w-sm mb-6"
                priority
              />
              <p className="text-lg sm:text-xl lg:text-2xl font-light text-white/90 leading-relaxed max-w-lg text-center lg:text-left mb-6">
                Financial and legal hassles — now united in a single AI platform.
              </p>
              <div className="flex flex-col sm:flex-row items-center lg:items-start gap-4">
                <Link
                  href="/signin"
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
                  href="/about"
                  className="inline-flex items-center gap-2 px-8 py-3.5 border-2 border-white/30 text-white rounded-full font-medium text-lg hover:bg-white/10 transition-all"
                >
                  Learn More
                </Link>
              </div>
            </div>

            {/* Right: Logo card */}
            <div className="shrink-0 flex justify-center lg:justify-end">
              <div className="relative w-56 h-56 sm:w-72 sm:h-72 lg:w-80 lg:h-80">
                <div className="absolute inset-0 rounded-3xl bg-white/15 backdrop-blur-md border border-white/25 rotate-6" />
                <div className="absolute inset-0 rounded-3xl bg-white/10 backdrop-blur-sm border border-white/15 -rotate-3" />
                <div className="absolute inset-4 rounded-2xl bg-white/90 flex items-center justify-center shadow-2xl">
                  <Image
                    src="/finleg-logo-transparent.png"
                    alt="Finleg Logo"
                    width={1092}
                    height={598}
                    className="w-[80%] h-auto drop-shadow-lg"
                    priority
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
