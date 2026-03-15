"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function PhotosPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/intranet/photos/search");
  }, [router]);

  return null;
}
