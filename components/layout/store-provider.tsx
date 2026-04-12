"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { initStore } from "../../lib/store/db";

export function StoreProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";

  const [status, setStatus] = useState<"checking" | "ready" | "error" | "unauthenticated">("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Login page needs no auth check or store init
    if (isLoginPage) {
      setStatus("ready");
      return;
    }

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setStatus("unauthenticated");
        return;
      }

      try {
        await initStore();
        setStatus("ready");
      } catch (err) {
        console.error("[StoreProvider] init failed:", err);
        setError("Failed to connect to the database. Please check your Supabase configuration.");
        setStatus("error");
      }
    }

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        window.location.href = "/login";
      }
    });

    return () => subscription.unsubscribe();
  }, [isLoginPage]);

  // Always render the login page immediately — no redirect loop
  if (isLoginPage) return <>{children}</>;

  if (status === "unauthenticated") {
    if (typeof window !== "undefined") window.location.href = "/login";
    return null;
  }

  if (status === "checking") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 16, fontFamily: "sans-serif", color: "#555" }}>
        <div style={{ width: 40, height: 40, border: "3px solid #e0e0e0", borderTopColor: "#555", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <span style={{ fontSize: 14 }}>Loading Amplified Operations Suite…</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 12, fontFamily: "sans-serif", color: "#c0392b", padding: 24, textAlign: "center" }}>
        <strong>Database connection error</strong>
        <span style={{ fontSize: 14, color: "#555" }}>{error}</span>
      </div>
    );
  }

  return <>{children}</>;
}
