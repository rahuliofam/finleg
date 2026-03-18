import { ALL_TAB_SLUGS } from "@/types/intranet";
import ZeniTabContent from "./_tab-content";

export function generateStaticParams() {
  return ALL_TAB_SLUGS.zeni.map((tab) => ({ tab }));
}

export default function ZeniTabPage() {
  return <ZeniTabContent />;
}
