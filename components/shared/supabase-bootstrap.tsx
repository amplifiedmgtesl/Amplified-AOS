"use client";

import { useEffect } from "react";
import { initializeCloudSync } from "@/lib/store/cloud-sync";

export function SupabaseBootstrap() {
  useEffect(() => {
    initializeCloudSync();
  }, []);

  return null;
}
