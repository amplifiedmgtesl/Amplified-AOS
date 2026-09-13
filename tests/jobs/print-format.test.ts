import { describe, it, expect } from "vitest";
import {
  nextDayFlags,
  plannedRanges,
  actualRanges,
  dayRanges,
  printRangeText,
  anyOverride,
  formatPhone,
  sortForPrint,
  splitFullName,
  parsePrintSort,
  type SortKey,
} from "@/lib/jobs/print-format";

const twoBlockDay = { startTime: "08:00", endTime: "13:00", startTime2: "20:00", endTime2: "02:00" };

describe("nextDayFlags", () => {
  it("marks nothing on a same-day shift", () => {
    expect(nextDayFlags("08:00", "13:00", "14:00", "19:00")).toEqual([false, false, false, false]);
  });
  it("marks pair 2's out when pair 2 crosses midnight", () => {
    expect(nextDayFlags("08:00", "13:00", "20:00", "02:00")).toEqual([false, false, false, true]);
  });
  it("marks everything after pair 1's out when pair 1 crosses midnight (matches inferPairDates)", () => {
    expect(nextDayFlags("22:00", "03:00", "04:00", "06:00")).toEqual([false, true, true, true]);
  });
  it("does not treat an equal in/out as crossing midnight", () => {
    expect(nextDayFlags("14:50", "14:50")).toEqual([false, false, false, false]);
  });
  it("ignores missing times", () => {
    expect(nextDayFlags("20:00", undefined, undefined, "02:00")).toEqual([false, false, false, false]);
  });
});

describe("plannedRanges", () => {
  it("rides the day window with no markers except (+1)", () => {
    const r = plannedRanges({}, twoBlockDay);
    expect(r.map(printRangeText)).toEqual(["8:00 AM – 1:00 PM", "8:00 PM – 2:00 AM (+1)"]);
    expect(anyOverride(r)).toBe(false);
  });
  it("stars only the individual times, falling back per side", () => {
    const r = plannedRanges({ plannedIn1: "07:30" }, twoBlockDay);
    expect(r.map(printRangeText)).toEqual(["7:30 AM* – 1:00 PM", "8:00 PM – 2:00 AM (+1)"]);
    expect(anyOverride(r)).toBe(true);
  });
  it("combines star and (+1) on an overridden next-day end", () => {
    const r = plannedRanges({ plannedIn1: "07:00", plannedOut1: "13:00", plannedIn2: "21:00", plannedOut2: "03:00" }, twoBlockDay);
    expect(r.map(printRangeText)).toEqual(["7:00 AM* – 1:00 PM*", "9:00 PM* – 3:00 AM* (+1)"]);
  });
  it("drops an empty second block on a single-block day", () => {
    expect(plannedRanges({}, { startTime: "09:00", endTime: "17:00" }).map(printRangeText)).toEqual(["9:00 AM – 5:00 PM"]);
  });
  it("returns nothing when neither the assignment nor the day has a time", () => {
    expect(plannedRanges({}, {})).toEqual([]);
    expect(plannedRanges({}, null)).toEqual([]);
  });
  it("shows a half-set block honestly", () => {
    expect(plannedRanges({ plannedIn2: "18:00" }, { startTime: "09:00", endTime: "17:00" }).map(printRangeText))
      .toEqual(["9:00 AM – 5:00 PM", "6:00 PM* – ?"]);
  });
});

describe("dayRanges / actualRanges", () => {
  it("formats the day window", () => {
    expect(dayRanges(twoBlockDay).map(printRangeText)).toEqual(["8:00 AM – 1:00 PM", "8:00 PM – 2:00 AM (+1)"]);
  });
  it("formats recorded times without override stars", () => {
    const r = actualRanges({ timeIn1: "10:00", timeOut1: "13:00", timeIn2: "20:00", timeOut2: "02:00" });
    expect(r.map(printRangeText)).toEqual(["10:00 AM – 1:00 PM", "8:00 PM – 2:00 AM (+1)"]);
    expect(anyOverride(r)).toBe(false);
  });
  it("shows an open punch", () => {
    expect(actualRanges({ timeIn1: "15:10", timeOut1: "" }).map(printRangeText)).toEqual(["3:10 PM – ?"]);
  });
});

describe("formatPhone", () => {
  it("normalizes US numbers in any common shape", () => {
    expect(formatPhone("7348331268")).toBe("(734) 833-1268");
    expect(formatPhone("734-833-1268")).toBe("(734) 833-1268");
    expect(formatPhone("(734) 833-1268")).toBe("(734) 833-1268");
    expect(formatPhone("+1 734.833.1268")).toBe("(734) 833-1268");
  });
  it("leaves anything else alone", () => {
    expect(formatPhone("ext 22")).toBe("ext 22");
    expect(formatPhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(formatPhone("")).toBe("");
    expect(formatPhone(null)).toBe("");
  });
});

describe("sortForPrint", () => {
  const k = (firstName: string, lastName: string, position = "", specialty = ""): SortKey =>
    ({ firstName, lastName, position, specialty });
  const rows = [
    k("Aaron", "Smith", "Rigger", "Up"),
    k("", ""),                                  // unfilled slot
    k("Abigail", "Davis", "Audio Technician", "A1"),
    k("Aaron", "Dickens", "Head Rigger", "Head Rigger"),
    k("Joe", "Scroggs", "Stagehand", "Labor"),
    k("Aaron", "Freeman", "Stagehand", "Labor"),
  ];
  const names = (rs: SortKey[]) => rs.map((r) => `${r.firstName} ${r.lastName}`.trim() || "(blank)");

  it("sorts by last name, blanks last", () => {
    expect(names(sortForPrint(rows, "last", (r) => r))).toEqual(
      ["Abigail Davis", "Aaron Dickens", "Aaron Freeman", "Joe Scroggs", "Aaron Smith", "(blank)"]);
  });
  it("sorts by first name, then last", () => {
    expect(names(sortForPrint(rows, "first", (r) => r))).toEqual(
      ["Aaron Dickens", "Aaron Freeman", "Aaron Smith", "Abigail Davis", "Joe Scroggs", "(blank)"]);
  });
  it("groups by position then specialty, names within", () => {
    expect(names(sortForPrint(rows, "position", (r) => r))).toEqual(
      ["Abigail Davis", "Aaron Dickens", "Aaron Smith", "Aaron Freeman", "Joe Scroggs", "(blank)"]);
  });
  it("does not mutate its input", () => {
    const copy = [...rows];
    sortForPrint(rows, "last", (r) => r);
    expect(rows).toEqual(copy);
  });
});

describe("splitFullName / parsePrintSort", () => {
  it("takes the last word as the last name", () => {
    expect(splitFullName("Aaron J Smith")).toEqual({ firstName: "Aaron J", lastName: "Smith" });
    expect(splitFullName("Cher")).toEqual({ firstName: "Cher", lastName: "" });
    expect(splitFullName("  ")).toEqual({ firstName: "", lastName: "" });
  });
  it("defaults to last name", () => {
    expect(parsePrintSort(null)).toBe("last");
    expect(parsePrintSort("bogus")).toBe("last");
    expect(parsePrintSort("position")).toBe("position");
  });
});
