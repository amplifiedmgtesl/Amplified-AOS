// Browser print dialogs use document.title as the saved-PDF filename
// (and in the per-page header). This helper temporarily swaps the
// title to a meaningful name so each exported PDF has a useful
// filename instead of the generic "Amplified Operations Suite".

/**
 * Sanitize a string for use as a filename — strip characters that
 * browsers or operating systems dislike in saved-PDF names.
 */
function safeFileName(s: string): string {
  return (s || "")
    .replace(/[\\/:*?"<>|]+/g, " ") // disallowed on Windows / macOS
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Open the browser print dialog with a custom document title. The
 * title is restored on the `afterprint` event (or after 60s as a
 * fallback if the browser never fires it).
 *
 * Build the title from meaningful parts: pass them in order, empty
 * strings are dropped, and they're joined with " — ".
 */
export function printWithTitle(parts: Array<string | null | undefined>): void {
  if (typeof window === "undefined") return;
  const prev = document.title;
  const clean = parts.map((p) => safeFileName(p || "")).filter(Boolean).join(" — ");
  document.title = clean || prev;
  const restore = () => {
    document.title = prev;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  setTimeout(restore, 60_000);
  window.print();
}

/**
 * Round-3 re-test #24 / J6: Safari ignores `@page { size: landscape }`, so
 * landscape documents need a "choose Landscape" note — but only where it
 * applies. True for desktop Safari and for EVERY iPhone/iPad browser (Chrome,
 * Firefox, Edge on iOS all run on Safari's engine). iPadOS reports itself as a
 * Mac, so a "Mac" with a touch screen counts as an iPad.
 */
export function printIgnoresLandscape(ua: string, platform = "", maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  if (platform === "MacIntel" && maxTouchPoints > 1) return true;
  return /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|FxiOS|Android/.test(ua);
}
