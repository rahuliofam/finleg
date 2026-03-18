"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ZeniPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/intranet/zeni/overview");
  }, [router]);

  return null;
}
