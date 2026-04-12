"use client";

import { useEffect, useState, type ReactNode } from "react";
import { initStore } from "../../lib/store/db";

/**
 * StoreProvider
 *
 * Initializes the Supabase-backed in-memory cache once on mount.
 * Renders a full-page loading screen until the store is ready so components
 * never read from an empty cache.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initStore()
      .then(() => setReady(true))
      .catch((err) => {
        console.error("[StoreProvider] init failed:", err);
        setError("Failed to connect to the database. Please check your Supabase configuration.");
        setReady(true); // Unblock the app even on error
      });
  }, []);

  if (!ready) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          gap: 16,
          fontFamily: "sans-serif",
          color: "#555",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            border: "3px solid #e0e0e0",
            borderTopColor: "#555",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <span style={{ fontSize: 14 }}>Loading Amplified Operations Suite…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          gap: 12,
          fontFamily: "sans-serif",
          color: "#c0392b",
          padding: 24,
          textAlign: "center",
        }}
      >
        <strong>Database connection error</strong>
        <span style={{ fontSize: 14, color: "#555" }}>{error}</span>
      </div>
    );
  }

  return <>{children}</>;
}
