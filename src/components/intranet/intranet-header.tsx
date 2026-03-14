"use client";

import { useAuth } from "@/contexts/auth-context";
import { useParams, useRouter } from "next/navigation";

export function IntranetHeader() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const params = useParams();
  const lang = (params.lang as string) || "en";

  const handleSignOut = async () => {
    await signOut();
    router.replace(`/${lang}`);
  };

  return (
    <header className="bg-slate-900 text-white">
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-14">
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold">Intranet</span>
          <span className="text-xs text-slate-400">v0.1.0</span>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-300 hidden sm:block">
            {user?.email}
          </span>
          <button
            onClick={handleSignOut}
            className="text-sm text-slate-400 hover:text-white transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    </header>
  );
}
