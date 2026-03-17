"use client";

import { useParams } from "next/navigation";
import { DEFAULT_TABS, type IntranetSection } from "@/types/intranet";
import { UsersTab } from "@/components/intranet/admin/users-tab";
import { BrandTab } from "@/components/intranet/admin/brand-tab";
import { UploadsTab } from "@/components/intranet/admin/uploads-tab";
import { ReleasesTab } from "@/components/intranet/admin/releases-tab";
import { SessionsTab } from "@/components/clauded/sessions-tab";
import { TokensTab } from "@/components/clauded/tokens-tab";
import { ContextTab } from "@/components/clauded/context-tab";
import { BackupsTab } from "@/components/clauded/backups-tab";
import { TodoTab } from "@/components/clauded/todo-tab";

const TAB_COMPONENTS: Record<string, Record<string, React.ComponentType>> = {
  admin: {
    uploads: UploadsTab,
    users: UsersTab,
    brand: BrandTab,
  },
  clauded: {
    releases: ReleasesTab,
    sessions: SessionsTab,
    tokens: TokensTab,
    context: ContextTab,
    backups: BackupsTab,
    todo: TodoTab,
  },
};

export function TabContent({ section }: { section: IntranetSection }) {
  const params = useParams();
  const tab = params.tab as string;

  const tabDef = DEFAULT_TABS[section]?.find((t) => t.key === tab);
  const label = tabDef?.label || tab;

  const Component = TAB_COMPONENTS[section]?.[tab];

  if (Component) {
    return <Component />;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-4">{label}</h1>
      <div className="rounded-xl border border-slate-200 p-8 text-center text-slate-500">
        <p>{label} content will be displayed here.</p>
      </div>
    </div>
  );
}
