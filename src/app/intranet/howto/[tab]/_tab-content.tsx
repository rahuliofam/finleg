"use client";

import { useParams } from "next/navigation";
import ComponentsPage from "./_components";
import NutsBoltsPage from "./_nutsbolts";

export default function HowtoTabContent() {
  const params = useParams();
  const tab = params.tab as string;

  switch (tab) {
    case "components":
      return <ComponentsPage />;
    case "nutsbolts":
      return <NutsBoltsPage />;
    default:
      return (
        <div className="text-center py-12 text-slate-400">
          <p>Tab not found.</p>
        </div>
      );
  }
}
