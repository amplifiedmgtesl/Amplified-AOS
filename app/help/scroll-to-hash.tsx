"use client";

import { useEffect } from "react";

// The guide only renders after the app's sign-in check, so the browser's own
// jump to #section fires before the heading exists and lands at the top.
// Jump again once mounted, and whenever the Help tab is reused with a new #.
export function ScrollToHash() {
  useEffect(() => {
    const jump = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id) document.getElementById(id)?.scrollIntoView();
    };
    jump();
    window.addEventListener("hashchange", jump);
    return () => window.removeEventListener("hashchange", jump);
  }, []);
  return null;
}
