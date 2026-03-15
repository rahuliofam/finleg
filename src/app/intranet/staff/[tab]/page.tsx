import { ALL_TAB_SLUGS } from "@/types/intranet";
import { TabContent } from "@/components/intranet/tab-content";

export function generateStaticParams() {
  return ALL_TAB_SLUGS.staff.map((tab) => ({ tab }));
}

export default function StaffTabPage() {
  return <TabContent section="staff" />;
}
