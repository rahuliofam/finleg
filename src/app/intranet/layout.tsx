"use client";

import { AuthGuard } from "@/components/auth-guard";
import { SectionTabs } from "@/components/intranet/section-tabs";
import { SubTabs } from "@/components/intranet/sub-tabs";
import { UpdateBanner } from "@/components/intranet/update-banner";
import type { ReactNode } from "react";

export default function IntranetLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex flex-col min-h-screen bg-white">
        <SectionTabs />
        <SubTabs />
        <div className="flex-1 max-w-7xl mx-auto w-full px-6 py-6">
          <UpdateBanner />
          {children}
        </div>
      </div>
    </AuthGuard>
  );
}
