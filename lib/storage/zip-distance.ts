/**
 * Zip-centroid distance — powers the crew-roster export radius filter.
 *
 * Centroids come from the US Census 2023 ZCTA gazetteer (public domain),
 * committed as a static asset at public/data/zip-centroids.json in the
 * compact form {"43215":[39.9669,-83.0130], ...}. New zips appear a few
 * dozen times a year nationwide; a zip missing from the file is treated
 * as unknown location (fail closed — see distanceBetweenZips callers).
 */

let centroidsPromise: Promise<Record<string, [number, number]>> | null = null;

/** Fetch + cache the centroid table (only ever loaded on demand). */
export function loadZipCentroids(): Promise<Record<string, [number, number]>> {
  if (!centroidsPromise) {
    centroidsPromise = fetch("/data/zip-centroids.json").then((res) => {
      if (!res.ok) throw new Error(`zip centroid data failed to load (${res.status})`);
      return res.json();
    });
  }
  return centroidsPromise;
}

/** Normalize a zip-ish string to 5 digits ("43215-1234" → "43215"), else null. */
export function zip5(raw: string | null | undefined): string | null {
  const m = (raw ?? "").trim().match(/^(\d{5})(?:-\d{4})?$/);
  return m ? m[1] : null;
}

const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle (haversine) distance in miles between two [lat,lng] points. */
export function haversineMiles(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(s));
}

/** Distance in miles between two zips, or null if either is unknown. */
export function distanceBetweenZips(
  centroids: Record<string, [number, number]>,
  zipA: string | null | undefined,
  zipB: string | null | undefined,
): number | null {
  const a = zip5(zipA);
  const b = zip5(zipB);
  if (!a || !b) return null;
  const ca = centroids[a];
  const cb = centroids[b];
  if (!ca || !cb) return null;
  return haversineMiles(ca, cb);
}
