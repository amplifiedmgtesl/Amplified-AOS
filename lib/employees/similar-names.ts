// Close matches for a typed name (2026-10-20).
//
// The employee search only finds what's typed, so a typo ("Shelby Bowmen",
// or just "bowmen"), a nickname ("Mike" for Michael) or first/last swapped
// finds nothing and "+ Create employee" makes a duplicate. When the search
// comes up empty, the picker shows these instead, using the same name rules
// as the Onboarding duplicate check (nicknames folded, a letter or two apart).

import { levenshtein, nameKey } from "@/lib/paychex/sync-plan";
import { similarName } from "@/lib/onboarding/plan";

const words = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z\s'-]/g, " ").replace(/['-]/g, "").split(/\s+/).filter(Boolean);

/** One typed word against one word of a name: same nickname-folded start,
 *  or a typo apart (same first letter; 1 letter, 2 for words of 7+). */
function wordClose(typed: string, word: string): boolean {
  if (word.startsWith(typed)) return true;
  if (typed.length < 3 || typed[0] !== word[0]) return false;
  if (nameKey(`${typed} x`) === nameKey(`${word} x`)) return true;   // Mike / Michael
  const allowed = Math.min(typed.length, word.length) >= 7 ? 2 : 1;
  // Whole word, or the start of it when they stopped typing early.
  return levenshtein(typed, word) <= allowed
    || (typed.length >= 4 && levenshtein(typed, word.slice(0, typed.length)) <= allowed);
}

/** Does this typed name look like this person? Every typed word has to be
 *  close to a different word of their name, in any order. */
export function looksLike(typed: string, fullName: string): boolean {
  const t = words(typed), n = words(fullName);
  if (!t.length || !n.length || t.length > n.length) return false;
  if (t.join("").length < 4) return false;          // too little to go on
  if (t.length >= 2 && similarName(typed, fullName)) return true;
  const used = new Set<number>();
  return t.every((w) => {
    const i = n.findIndex((x, j) => !used.has(j) && wordClose(w, x));
    if (i < 0) return false;
    used.add(i);
    return true;
  });
}

/** People whose name looks like what was typed, at most `cap`. */
export function similarNames<T extends { fullName: string }>(typed: string, people: T[], cap = 5): T[] {
  return people.filter((p) => looksLike(typed, p.fullName)).slice(0, cap);
}
