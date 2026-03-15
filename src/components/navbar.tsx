"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import versionData from "@/../version.json";

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleSignOut = async () => {
    setMenuOpen(false);
    await signOut();
    router.replace("/");
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <nav className="sticky top-0 z-50 bg-[#0f3d1e] text-white">
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-14">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
            <img src="/finleg-logo-transparent.png" alt="Finleg" className="h-9 w-auto" />
            <img src="/finleg-wordmark-white.png" alt="Finleg" className="h-10 w-auto" />
          </Link>
          <span className="text-sm text-green-300/60 font-mono hidden sm:inline">
            {versionData.version}
          </span>
        </div>

        <div className="flex items-center gap-4">
          {!loading && user && (
            <Link
              href="/intranet"
              className="text-sm font-medium px-4 py-1.5 bg-[#1B6B3A] hover:bg-[#145530] text-white rounded-full transition-colors"
            >
              Dashboard
            </Link>
          )}
          <Link
            href="/clauded"
            className={`text-sm font-medium transition-colors hover:text-white ${
              pathname.includes("/clauded") ? "text-white" : "text-green-100/70"
            }`}
          >
            Claude Dev
          </Link>
          <Link
            href="/about"
            className={`text-sm font-medium transition-colors hover:text-white ${
              pathname.includes("/about") ? "text-white" : "text-green-100/70"
            }`}
          >
            About
          </Link>
          {!loading && (
            user ? (
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="text-sm text-green-100/70 hover:text-white transition-colors hidden sm:inline"
                >
                  {user.email} ▾
                </button>
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="text-sm text-green-100/70 hover:text-white transition-colors sm:hidden"
                >
                  Account ▾
                </button>
                {menuOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50">
                    <div className="px-4 py-2 text-xs text-slate-400 border-b border-slate-100 sm:hidden">
                      {user.email}
                    </div>
                    <button
                      onClick={handleSignOut}
                      className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                href="/signin"
                className="text-sm font-medium px-4 py-1.5 bg-[#1B6B3A] hover:bg-[#145530] text-white rounded-full transition-colors"
              >
                Sign In
              </Link>
            )
          )}
        </div>
      </div>
    </nav>
  );
}
