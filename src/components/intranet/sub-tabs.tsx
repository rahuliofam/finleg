"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { SECTIONS, type TabConfig } from "@/types/intranet";
import { usePageDisplayConfig } from "@/hooks/use-page-display-config";

export function SubTabs() {
  const pathname = usePathname();
  const params = useParams();
  const lang = (params.lang as string) || "en";
  const { getVisibleTabs, loading } = usePageDisplayConfig();

  const getActiveSection = () => {
    for (const section of SECTIONS) {
      if (pathname.includes(`/intranet/${section.key}`)) {
        return section.key;
      }
    }
    return null;
  };

  const activeSection = getActiveSection();
  if (!activeSection) return null;

  const visibleTabs: TabConfig[] = getVisibleTabs(activeSection);

  // For admin section, always append "Page Display" as the last tab
  const isPageDisplayActive = pathname.includes("/admin/page-display");

  const getActiveTab = () => {
    const tabParam = params.tab as string | undefined;
    if (tabParam) return tabParam;
    if (isPageDisplayActive) return "page-display";
    return null;
  };

  const activeTab = getActiveTab();

  if (loading) {
    return (
      <div className="bg-slate-100 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 h-10" />
      </div>
    );
  }

  return (
    <div className="bg-slate-100 border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center gap-1 overflow-x-auto">
          {visibleTabs.map((tab) => (
            <Link
              key={tab.tab_key}
              href={`/${lang}/intranet/${activeSection}/${tab.tab_key}`}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.tab_key
                  ? "text-amber-700 border-b-2 border-amber-600"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.tab_label}
            </Link>
          ))}
          {activeSection === "admin" && (
            <Link
              href={`/${lang}/intranet/admin/page-display`}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                isPageDisplayActive
                  ? "text-amber-700 border-b-2 border-amber-600"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Page Display
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
