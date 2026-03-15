"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function BookkeepingPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/intranet/bookkeeping/ledger-notes");
  }, [router]);

  return null;
}
