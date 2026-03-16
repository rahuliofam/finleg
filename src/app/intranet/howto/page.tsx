"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function HowtoPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/intranet/howto/components");
  }, [router]);

  return null;
}
