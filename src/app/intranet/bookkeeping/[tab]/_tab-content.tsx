"use client";

import { useParams } from "next/navigation";
import LedgerNotesTab from "./_ledger-notes";
import StatementsTab from "./_statements";
import CategorizeTab from "./_categorize";
import ReceiptsTab from "./_receipts";
import BookkeeperTab from "./_bookkeeper";
import ActivityTab from "./_activity";

export default function BookkeepingTabContent() {
  const params = useParams();
  const tab = params.tab as string;

  switch (tab) {
    case "ledger-notes":
      return <LedgerNotesTab />;
    case "statements":
      return <StatementsTab />;
    case "categorize":
      return <CategorizeTab />;
    case "receipts":
      return <ReceiptsTab />;
    case "bookkeeper":
      return <BookkeeperTab />;
    case "activity":
      return <ActivityTab />;
    default:
      return (
        <div className="text-center py-12 text-slate-400">
          <p>Tab not found.</p>
        </div>
      );
  }
}
