"use client";

import { useParams } from "next/navigation";
import PhotosTab from "./_photos";
import GeneralFilesTab from "./_general";
import FinancialLegalTab from "./_financial-legal";

export default function FilesTabContent() {
  const params = useParams();
  const tab = params.tab as string;

  switch (tab) {
    case "photos":
      return <PhotosTab />;
    case "general":
      return <GeneralFilesTab />;
    case "financial-legal":
      return <FinancialLegalTab />;
    default:
      return (
        <div className="text-center py-12 text-slate-400">
          <p>Tab not found.</p>
        </div>
      );
  }
}
