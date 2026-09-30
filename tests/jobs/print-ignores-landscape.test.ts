import { describe, it, expect } from "vitest";
import { printIgnoresLandscape } from "@/lib/print-with-title";

const UA = {
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  winEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
  winFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.0.0 Mobile/15E148 Safari/604.1",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
};

describe("printIgnoresLandscape", () => {
  it("is true for desktop Safari and any iPhone browser", () => {
    expect(printIgnoresLandscape(UA.macSafari, "MacIntel", 0)).toBe(true);
    expect(printIgnoresLandscape(UA.iphoneSafari, "iPhone", 5)).toBe(true);
    expect(printIgnoresLandscape(UA.iphoneChrome, "iPhone", 5)).toBe(true);
  });
  it("is true for an iPad reporting itself as a Mac", () => {
    expect(printIgnoresLandscape(UA.macSafari, "MacIntel", 5)).toBe(true);
  });
  it("is false for Chrome, Edge, Firefox and Android", () => {
    expect(printIgnoresLandscape(UA.macChrome, "MacIntel", 0)).toBe(false);
    expect(printIgnoresLandscape(UA.winEdge, "Win32", 0)).toBe(false);
    expect(printIgnoresLandscape(UA.winFirefox, "Win32", 0)).toBe(false);
    expect(printIgnoresLandscape(UA.androidChrome, "Linux armv8l", 5)).toBe(false);
  });
});
