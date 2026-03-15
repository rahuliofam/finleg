import { getVersion } from "@/lib/version";

export function Footer() {
  const version = getVersion();
  return (
    <footer className="border-t border-slate-200 py-8 px-6">
      <div className="max-w-6xl mx-auto text-center text-sm text-slate-500">
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
