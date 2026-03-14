"use client";

import { usePageDisplayConfig } from "@/hooks/use-page-display-config";

export default function AdminPage() {
  const { getVisibleTabs, loading } = usePageDisplayConfig();

  if (loading) return null;

  const visibleTabs = getVisibleTabs("admin");

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-4">Admin</h1>
      <p className="text-slate-600">
        {visibleTabs.length > 0
          ? "Select a tab above to manage admin settings."
          : "Use the Page Display tab to configure which tabs are shown."}
      </p>
    </div>
  );
}
