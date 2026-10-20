// Close matches for a typed name (2026-10-20).
//
// The employee search only finds what's typed, so a typo ("bowmen" for
// Bowman), a nickname ("Mike" for Michael) or first/last swapped finds
// nothing and "+ Create employee" makes a duplicate. When the exact search
// comes up empty, the picker shows these instead, best first.
//
// A typed word is close to a word of the name when it starts it, is the
// same nickname, or SOUNDS the same (Soundex) and is at most 2 letters off.
// Sound has to agree, so "bowmen" finds Bowman but not Bower or Bowles.

import { fullFirstName, levenshtein } from "@/lib/paychex/sync-plan";

const words = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z\s'-]/g, " ").replace(/['-]/g, "").split(/\s+/).filter(Boolean);

const CODES: Record<string, string> = {
  b: "1", f: "1", p: "1", v: "1",
  c: "2", g: "2", j: "2", k: "2", q: "2", s: "2", x: "2", z: "2",
  d: "3", t: "3", l: "4", m: "5", n: "5", r: "6",
};

/** American Soundex: first letter + 3 digits ("Bowman" → B550). */
export function soundex(word: string): string {
  const w = (word ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return "";
  let out = w[0].toUpperCase();
  let last = CODES[w[0]] ?? "";
  for (let i = 1; i < w.length && out.length < 4; i++) {
    const c = w[i];
    const code = CODES[c] ?? "";
    if (code && code !== last) out += code;
    if (c !== "h" && c !== "w") last = code;   // h/w don't separate equal codes
  }
  return out.padEnd(4, "0");
}

/** How close a typed word is to one word of a name: 0 = starts it,
 *  1 = same nickname, 2+ = sounds the same (plus letters off), null = no. */
function wordScore(typed: string, word: string): number | null {
  if (word.startsWith(typed)) return 0;
  if (typed.length < 3) return null;
  if (fullFirstName(typed) === fullFirstName(word)) return 1;     // Mike / Michael
  if (soundex(typed) !== soundex(word)) return null;
  const off = levenshtein(typed, word);
  return off <= 2 ? 2 + off : null;
}

/** Score for this person (lower = closer), or null. Every typed word has to
 *  match a different word of their name, in any order. */
export function closeness(typed: string, fullName: string): number | null {
  const t = words(typed), n = words(fullName);
  if (!t.length || !n.length || t.length > n.length) return null;
  if (t.join("").length < 4) return null;          // too little to go on
  const used = new Set<number>();
  let total = 0;
  for (const w of t) {
    let best: { j: number; s: number } | null = null;
    n.forEach((x, j) => {
      if (used.has(j)) return;
      const s = wordScore(w, x);
      if (s != null && (!best || s < best.s)) best = { j, s };
    });
    if (!best) return null;
    used.add((best as { j: number }).j);
    total += (best as { s: number }).s;
  }
  return total;
}

export const looksLike = (typed: string, fullName: string) => closeness(typed, fullName) != null;

/** People whose name looks like what was typed, closest first, at most `cap`. */
export function similarNames<T extends { fullName: string }>(typed: string, people: T[], cap = 5): T[] {
  const scored: { p: T; s: number }[] = [];
  for (const p of people) {
    const s = closeness(typed, p.fullName);
    if (s != null) scored.push({ p, s });
  }
  return scored.sort((a, b) => a.s - b.s || a.p.fullName.localeCompare(b.p.fullName)).slice(0, cap).map((x) => x.p);
}
