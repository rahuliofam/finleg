"use client";

import { useParams } from "next/navigation";
import LedgerNotesTab from "./_ledger-notes";
import StatementsTab from "./_statements";
import CategorizeTab from "./_categorize";
import ReceiptsTab from "./_receipts";
import BookkeeperTab from "./_bookkeeper";
import ActivityTab from "./_activity";
import TasksTab from "./_tasks";
import DashboardTab from "./_dashboard";
import TaxReportTab from "./_tax-report";
import BrokerageTab from "./_brokerage";

export default function BookkeepingTabContent() {
  const params = useParams();
  const tab = params.tab as string;

  switch (tab) {
    case "dashboard":
      return <DashboardTab />;
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
    case "tasks":
      return <TasksTab />;
    case "activity":
      return <ActivityTab />;
    case "tax-report":
      return <TaxReportTab />;
    case "brokerage":
      return <BrokerageTab />;
    default:
      return (
        <div className="text-center py-12 text-slate-400">
          <p>Tab not found.</p>
        </div>
      );
  }
}
