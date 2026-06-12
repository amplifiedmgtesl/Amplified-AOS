"use client";

import { useEffect, useState } from "react";

// SHA of the deployment this bundle was built from; null in local dev.
const BUILD_SHA = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? null;

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function UpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!BUILD_SHA) return;
    let stale = false;

    async function check() {
      if (stale) return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { sha } = await res.json();
        if (sha && sha !== BUILD_SHA) {
          stale = true;
          setUpdateAvailable(true);
        }
      } catch {
        // offline or transient failure; try again next cycle
      }
    }

    const interval = setInterval(check, CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 9999,
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        background: "#1d4ed8",
        color: "white",
        fontWeight: 600,
        fontSize: 13,
        letterSpacing: 0.3,
        padding: "4px 12px",
        borderBottom: "1px solid #1e40af",
      }}
    >
      A new version of the app is available.
      <button
        onClick={() => window.location.reload()}
        style={{
          background: "white",
          color: "#1d4ed8",
          border: "none",
          borderRadius: 4,
          fontWeight: 700,
          fontSize: 12,
          padding: "2px 10px",
          cursor: "pointer",
        }}
      >
        Refresh
      </button>
    </div>
  );
}
