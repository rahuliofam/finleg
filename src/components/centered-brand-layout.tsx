import Image from "next/image";

interface CenteredBrandLayoutProps {
  children: React.ReactNode;
}

export default function CenteredBrandLayout({ children }: CenteredBrandLayoutProps) {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-start justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-6 pt-[12vh]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="flex flex-col items-center gap-4 mb-8">
            <Image
              src="/finleg-logo-transparent.png"
              alt="Finleg"
              width={400}
              height={400}
              className="w-96 h-auto"
              priority
            />
            <Image
              src="/finleg-wordmark-transparent.png"
              alt="Finleg"
              width={400}
              height={120}
              className="w-96 h-auto"
              priority
            />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
