"use client";

import { useParams } from "next/navigation";
import LedgerNotesTab from "./_ledger-notes";
import StatementsTab from "./_statements";

export default function BookkeepingTabContent() {
  const params = useParams();
  const tab = params.tab as string;

  switch (tab) {
    case "ledger-notes":
      return <LedgerNotesTab />;
    case "statements":
      return <StatementsTab />;
    default:
      return (
        <div className="text-center py-12 text-slate-400">
          <p>Tab not found.</p>
        </div>
      );
  }
}
