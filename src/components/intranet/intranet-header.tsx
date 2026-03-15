"use client";

import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import versionData from "@/../version.json";

export function IntranetHeader() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.replace("/");
  };

  return (
    <header className="bg-[#0d3d1f] text-white">
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-14">
        <div className="flex items-center gap-4">
          <img src="/finleg-logo-transparent.png" alt="Finleg" className="h-7 w-auto" />
          <img src="/finleg-wordmark-white.png" alt="Finleg" className="h-5 w-auto" />
          <span className="text-lg font-bold">Intranet</span>
          <span className="text-xs text-green-300/60 font-mono">
            {versionData.version}
          </span>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm text-green-100/70 hidden sm:block">
            {user?.email}
          </span>
          <button
            onClick={handleSignOut}
            className="text-sm text-green-200/60 hover:text-white transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    </header>
  );
}
