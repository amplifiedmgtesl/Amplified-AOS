"use client";

import { usePathname } from "next/navigation";
import { helpUrl, openHelp } from "@/lib/help/sections";

/** Topbar "Help" — opens HELP.md at this page's section in its own tab. */
export function HelpButton() {
  const pathname = usePathname();
  return (
    <a
      href={helpUrl(pathname)}
      onClick={(e) => { e.preventDefault(); openHelp(pathname, window.location.search); }}
      className="help-btn hide-print"
      title="Instructions for this page"
    >
      ? Help
    </a>
  );
}
