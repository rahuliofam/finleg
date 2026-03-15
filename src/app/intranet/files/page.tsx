"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function FilesPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/intranet/files/photos");
  }, [router]);

  return null;
}
