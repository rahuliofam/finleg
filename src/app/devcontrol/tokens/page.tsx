"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Redirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/intranet/devcontrol/tokens"); }, [router]);
  return null;
}
