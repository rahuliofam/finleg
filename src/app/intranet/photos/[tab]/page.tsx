import { ALL_TAB_SLUGS } from "@/types/intranet";
import PhotosTabContent from "./_tab-content";

export function generateStaticParams() {
  return ALL_TAB_SLUGS.photos.map((tab) => ({ tab }));
}

export default function PhotosTabPage() {
  return <PhotosTabContent />;
}
