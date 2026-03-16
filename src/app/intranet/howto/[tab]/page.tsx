import { ALL_TAB_SLUGS } from "@/types/intranet";
import HowtoTabContent from "./_tab-content";

export function generateStaticParams() {
  return ALL_TAB_SLUGS.howto.map((tab) => ({ tab }));
}

export default function HowtoTabPage() {
  return <HowtoTabContent />;
}
