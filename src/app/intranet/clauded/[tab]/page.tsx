import { ALL_TAB_SLUGS } from "@/types/intranet";
import { TabContent } from "@/components/intranet/tab-content";

export function generateStaticParams() {
  return ALL_TAB_SLUGS.clauded.map((tab) => ({ tab }));
}

export default function ClaudedTabPage() {
  return <TabContent section="clauded" />;
}
