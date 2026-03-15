import { ALL_TAB_SLUGS } from "@/types/intranet";
import BookkeepingTabContent from "./_tab-content";

export function generateStaticParams() {
  return ALL_TAB_SLUGS.bookkeeping.map((tab) => ({ tab }));
}

export default function BookkeepingTabPage() {
  return <BookkeepingTabContent />;
}
