"use client";

import { useParams } from "next/navigation";
import { DEFAULT_TABS, type IntranetSection } from "@/types/intranet";

export function TabContent({ section }: { section: IntranetSection }) {
  const params = useParams();
  const tab = params.tab as string;

  const tabDef = DEFAULT_TABS[section]?.find((t) => t.key === tab);
  const label = tabDef?.label || tab;

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-4">{label}</h1>
      <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
        <p>{label} content will be displayed here.</p>
      </div>
    </div>
  );
}
