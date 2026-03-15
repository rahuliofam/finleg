import { ALL_TAB_SLUGS } from "@/types/intranet";
import { TabContent } from "@/components/intranet/tab-content";

export function generateStaticParams() {
  return ALL_TAB_SLUGS.admin.map((tab) => ({ tab }));
}

export default function AdminTabPage() {
  return <TabContent section="admin" />;
}
