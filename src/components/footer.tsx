import Link from "next/link";
import { getVersion } from "@/lib/version";

export function Footer() {
  const version = getVersion();
  return (
    <footer className="border-t border-slate-200 py-8 px-6">
      <div className="max-w-6xl mx-auto text-center text-sm text-slate-500">
        <div className="flex items-center justify-center gap-4 mb-2">
          <Link href="/legal/terms" className="hover:text-slate-700">Terms</Link>
          <span className="text-slate-300">|</span>
          <Link href="/legal/privacy" className="hover:text-slate-700">Privacy</Link>
        </div>
        <div>&copy; {new Date().getFullYear()} Finleg. All rights reserved.</div>
        {version !== "dev" && (
          <div className="mt-2 text-xs text-slate-400" data-site-version>
            {version}
          </div>
        )}
      </div>
    </footer>
  );
}
