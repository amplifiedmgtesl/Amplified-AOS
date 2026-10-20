import { describe, it, expect } from "vitest";
import { looksLike, similarNames } from "@/lib/employees/similar-names";

describe("looksLike", () => {
  it("catches typos, nicknames and swapped names", () => {
    expect(looksLike("Shelby Bowmen", "Shelby Bowman")).toBe(true);
    expect(looksLike("Mike Jones", "Michael Jones")).toBe(true);
    expect(looksLike("Bowman Shelby", "Shelby Bowman")).toBe(true);
    expect(looksLike("Chris Smith", "Christopher Smith")).toBe(true);
  });
  it("works on one word too", () => {
    expect(looksLike("bowmen", "Shelby Bowman")).toBe(true);
    expect(looksLike("shelbey", "Shelby Bowman")).toBe(true);
    expect(looksLike("mike", "Michael Jones")).toBe(true);
  });
  it("doesn't match different people", () => {
    expect(looksLike("Aaron Smith", "Falon Smith")).toBe(false);
    expect(looksLike("Shelby Bowman", "Shane Bowman")).toBe(false);
    expect(looksLike("bowmen", "Shelby Brown")).toBe(false);
    expect(looksLike("jonas", "Mary Smith")).toBe(false);
    expect(looksLike("ab", "Abby Bowman")).toBe(false);
  });
});

describe("similarNames", () => {
  const people = [{ fullName: "Shelby Bowman" }, { fullName: "Michael Jones" }, { fullName: "Pat Rivera" }];
  it("returns the close matches only", () => {
    expect(similarNames("Shelby Bowmen", people)).toEqual([{ fullName: "Shelby Bowman" }]);
    expect(similarNames("Mike Jones", people)).toEqual([{ fullName: "Michael Jones" }]);
    expect(similarNames("Totally New", people)).toEqual([]);
    expect(similarNames("Shel", people)).toEqual([{ fullName: "Shelby Bowman" }]);
  });
});
