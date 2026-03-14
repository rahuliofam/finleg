import { INTRANET_LOCALES } from "@/i18n/config";
import { ALL_TAB_SLUGS } from "@/types/intranet";
import { TabContent } from "@/components/intranet/tab-content";

export function generateStaticParams() {
  const params: { lang: string; tab: string }[] = [];
  for (const locale of INTRANET_LOCALES) {
    for (const tab of ALL_TAB_SLUGS.devices) {
      params.push({ lang: locale, tab });
    }
  }
  return params;
}

export default function DevicesTabPage() {
  return <TabContent section="devices" />;
}
