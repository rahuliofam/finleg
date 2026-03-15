"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function IntranetPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/intranet/files");
  }, [router]);

  return null;
}
