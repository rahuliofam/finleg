"use client";

import { usePageDisplayConfig } from "@/hooks/use-page-display-config";

export default function AssociatesPage() {
  const { getVisibleTabs, loading } = usePageDisplayConfig();

  if (loading) return null;

  const visibleTabs = getVisibleTabs("associates");

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-4">Associates</h1>
      <p className="text-slate-600">
        {visibleTabs.length > 0
          ? "Select a tab above to manage associates."
          : "No tabs are currently enabled for this section."}
      </p>
    </div>
  );
}
