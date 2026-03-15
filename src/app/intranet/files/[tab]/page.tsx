import { ALL_TAB_SLUGS } from "@/types/intranet";
import FilesTabContent from "./_tab-content";

export function generateStaticParams() {
  return ALL_TAB_SLUGS.files.map((tab) => ({ tab }));
}

export default function FilesTabPage() {
  return <FilesTabContent />;
}
