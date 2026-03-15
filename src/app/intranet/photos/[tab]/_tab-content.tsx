"use client";

import { useParams } from "next/navigation";
import PhotoSearchTab from "./_search";

export default function PhotosTabContent() {
  const params = useParams();
  const tab = params.tab as string;

  switch (tab) {
    case "search":
      return <PhotoSearchTab />;
    default:
      return (
        <div className="text-center py-12 text-slate-400">
          <p>Tab not found.</p>
        </div>
      );
  }
}
