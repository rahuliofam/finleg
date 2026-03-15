"use client";

import { useParams } from "next/navigation";
import LedgerNotesTab from "./_ledger-notes";

export default function BookkeepingTabContent() {
  const params = useParams();
  const tab = params.tab as string;

  switch (tab) {
    case "ledger-notes":
      return <LedgerNotesTab />;
    default:
      return (
        <div className="text-center py-12 text-slate-400">
          <p>Tab not found.</p>
        </div>
      );
  }
}
