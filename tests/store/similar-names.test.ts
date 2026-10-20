import { describe, it, expect } from "vitest";
import { looksLike, similarNames, soundex } from "@/lib/employees/similar-names";

describe("soundex", () => {
  it("gives the standard codes", () => {
    expect(soundex("Robert")).toBe("R163");
    expect(soundex("Rupert")).toBe("R163");
    expect(soundex("Ashcraft")).toBe("A261");
    expect(soundex("Tymczak")).toBe("T522");
    expect(soundex("Pfister")).toBe("P236");
    expect(soundex("Bowman")).toBe("B550");
    expect(soundex("bowmen")).toBe("B550");
    expect(soundex("Bower")).toBe("B600");
  });
});

describe("looksLike", () => {
  it("catches misspellings that sound the same, nicknames and swapped names", () => {
    expect(looksLike("Shelby Bowmen", "Shelby Bowman")).toBe(true);
    expect(looksLike("bowmen", "Shelby Bowman")).toBe(true);
    expect(looksLike("shelbey", "Shelby Bowman")).toBe(true);
    expect(looksLike("Mike Jones", "Michael Jones")).toBe(true);
    expect(looksLike("mike", "Michael Jones")).toBe(true);
    expect(looksLike("dow", "Sally Doe")).toBe(true);
    expect(looksLike("Bowman Shelby", "Shelby Bowman")).toBe(true);
    expect(looksLike("Chris Smith", "Christopher Smith")).toBe(true);
  });
  it("leaves out names that only look alike", () => {
    expect(looksLike("bowmen", "Bryan M Bower")).toBe(false);
    expect(looksLike("bowmen", "John Bowser")).toBe(false);
    expect(looksLike("bowmen", "Michael Bowles")).toBe(false);
    expect(looksLike("Aaron Smith", "Falon Smith")).toBe(false);
    expect(looksLike("Shelby Bowman", "Shane Bowman")).toBe(false);
    expect(looksLike("ab", "Abby Bowman")).toBe(false);
  });
});

describe("similarNames", () => {
  const people = [
    { fullName: "Bryan M Bower" }, { fullName: "Daniel J Bowman" }, { fullName: "Shelby Bowman" },
    { fullName: "Michael Jones" }, { fullName: "Pat Rivera" },
  ];
  it("returns only close matches, closest first", () => {
    expect(similarNames("bowmen", people)).toEqual([{ fullName: "Daniel J Bowman" }, { fullName: "Shelby Bowman" }]);
    expect(similarNames("Shelby Bowmen", people)).toEqual([{ fullName: "Shelby Bowman" }]);
    expect(similarNames("Mike Jones", people)).toEqual([{ fullName: "Michael Jones" }]);
    expect(similarNames("Totally New", people)).toEqual([]);
  });
  it("keeps whole groups of equally close names, up to 20", () => {
    const brandons = Array.from({ length: 8 }, (_, i) => ({ fullName: `Brandon Person${String.fromCharCode(65 + i)}` }));
    expect(similarNames("branden", brandons)).toHaveLength(8);
    const mixed = [
      ...Array.from({ length: 3 }, (_, i) => ({ fullName: `Brandon A${i}x` })),        // sounds same, 1 off
      ...Array.from({ length: 4 }, (_, i) => ({ fullName: `Brandin B${i}x` })),        // sounds same, 1 off too
      { fullName: "Brandeen Cx" },                                                     // 2 off
    ];
    expect(similarNames("branden", mixed).length).toBeGreaterThanOrEqual(5);
    const many = Array.from({ length: 30 }, (_, i) => ({ fullName: `Brandon Q${i}x` }));
    expect(similarNames("branden", many)).toHaveLength(20);
  });
});
