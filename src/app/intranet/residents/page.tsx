"use client";

import { usePageDisplayConfig } from "@/hooks/use-page-display-config";

export default function ResidentsPage() {
  const { getVisibleTabs, loading } = usePageDisplayConfig();

  if (loading) return null;

  const visibleTabs = getVisibleTabs("residents");

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-4">Residents</h1>
      <p className="text-slate-600">
        {visibleTabs.length > 0
          ? "Select a tab above to manage residents."
          : "No tabs are currently enabled for this section."}
      </p>
    </div>
  );
}
