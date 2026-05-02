"use client";

import { useParams } from "next/navigation";
import { TabNotFound } from "@/components/tabs";
import ComponentsPage from "./_components";
import NutsBoltsPage from "./_nutsbolts";
import AutoActionsPage from "./_autoactions";
import SecurityPage from "./_security";
import DataPipelinePage from "./_data-pipeline";

export default function HowtoTabContent() {
  const params = useParams();
  const tab = params.tab as string;

  switch (tab) {
    case "components":
      return <ComponentsPage />;
    case "nutsbolts":
      return <NutsBoltsPage />;
    case "autoactions":
      return <AutoActionsPage />;
    case "security":
      return <SecurityPage />;
    case "data-pipeline":
      return <DataPipelinePage />;
    default:
      return <TabNotFound />;
  }
}
