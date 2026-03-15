import { ALL_TAB_SLUGS } from "@/types/intranet";
import { TabContent } from "@/components/intranet/tab-content";

export function generateStaticParams() {
  return ALL_TAB_SLUGS.devices.map((tab) => ({ tab }));
}

export default function DevicesTabPage() {
  return <TabContent section="devices" />;
}
