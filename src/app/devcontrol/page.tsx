"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DevControlRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/intranet/devcontrol/sessions"); }, [router]);
  return null;
}
