"use client";

import { useParams } from "next/navigation";
import { TabNotFound } from "@/components/tabs";
import OverviewTab from "./_overview";
import ReportsTab from "./_reports";

export default function ZeniTabContent() {
  const params = useParams();
  const tab = params.tab as string;

  switch (tab) {
    case "overview":
      return <OverviewTab />;
    case "reports":
      return <ReportsTab />;
    default:
      return <TabNotFound />;
  }
}
