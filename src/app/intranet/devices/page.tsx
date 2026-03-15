"use client";

import { usePageDisplayConfig } from "@/hooks/use-page-display-config";

export default function DevicesPage() {
  const { getVisibleTabs, loading } = usePageDisplayConfig();

  if (loading) return null;

  const visibleTabs = getVisibleTabs("devices");
  if (visibleTabs.length > 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900 mb-4">Devices</h1>
        <p className="text-slate-600">
          Select a tab above to manage devices.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-4">Devices</h1>
      <p className="text-slate-600">No tabs are currently enabled for this section.</p>
    </div>
  );
}
