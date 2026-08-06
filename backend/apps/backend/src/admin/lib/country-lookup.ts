/**
 * Matching GA4's country names to the map's geometry.
 *
 * These are two different naming authorities and they disagree. GA4 reports
 * "United States", "Czechia", "Congo - Kinshasa"; Natural Earth calls the same
 * places "United States of America", "Czechia", "Dem. Rep. Congo". A map that
 * silently drops what it cannot match is worse than no map, because the total
 * on screen quietly stops being the total — so nothing is dropped here.
 * `resolveCountries` returns the unmatched rows too, and the map is required to
 * show them.
 *
 * Most of the disagreement is mechanical — Natural Earth abbreviates, GA4 does
 * not — so `normalize` expands the abbreviations and the explicit alias table
 * stays down to the genuinely different names.
 *
 * Two deliberate non-goals:
 *
 * - **No fuzzy matching.** Levenshtein distance over country names puts Niger
 *   next to Nigeria and Austria next to Australia. A wrong country on a map
 *   looks authoritative in a way a missing one does not, so a name either
 *   resolves exactly or it is reported as unmatched.
 * - **No translation.** The GA4 Data API returns English names regardless of
 *   the property's locale, so this handles English only.
 */

import { WORLD_COUNTRIES, project, type WorldCountry } from "./world-geo";

/**
 * Places Natural Earth 110m omits entirely — it is a *land* atlas at a scale
 * where a city-state is smaller than a rounding error. They are real traffic
 * for a German-language shop (Liechtenstein especially), so they are carried
 * as marker-only entries: a point, no outline.
 *
 * Coordinates are the conventional centre of each place, to one decimal.
 */
const MICRO_STATES: ReadonlyArray<{
  id: string;
  name: string;
  lon: number;
  lat: number;
}> = [
  { id: "020", name: "Andorra", lon: 1.5, lat: 42.5 },
  { id: "048", name: "Bahrain", lon: 50.6, lat: 26.0 },
  { id: "052", name: "Barbados", lon: -59.5, lat: 13.2 },
  { id: "132", name: "Cabo Verde", lon: -23.6, lat: 15.1 },
  { id: "234", name: "Faroe Islands", lon: -6.9, lat: 62.0 },
  { id: "292", name: "Gibraltar", lon: -5.4, lat: 36.1 },
  { id: "344", name: "Hong Kong", lon: 114.2, lat: 22.3 },
  { id: "831", name: "Jersey", lon: -2.1, lat: 49.2 },
  { id: "832", name: "Guernsey", lon: -2.6, lat: 49.5 },
  { id: "833", name: "Isle of Man", lon: -4.5, lat: 54.2 },
  { id: "438", name: "Liechtenstein", lon: 9.6, lat: 47.2 },
  { id: "446", name: "Macao", lon: 113.5, lat: 22.2 },
  { id: "462", name: "Maldives", lon: 73.5, lat: 3.2 },
  { id: "470", name: "Malta", lon: 14.4, lat: 35.9 },
  { id: "480", name: "Mauritius", lon: 57.6, lat: -20.3 },
  { id: "492", name: "Monaco", lon: 7.4, lat: 43.7 },
  { id: "674", name: "San Marino", lon: 12.5, lat: 43.9 },
  { id: "690", name: "Seychelles", lon: 55.5, lat: -4.7 },
  { id: "702", name: "Singapore", lon: 103.8, lat: 1.4 },
  { id: "336", name: "Vatican City", lon: 12.5, lat: 41.9 },
];

const MICRO_COUNTRIES: readonly WorldCountry[] = MICRO_STATES.map(
  ({ id, name, lon, lat }) => {
    const { x, y } = project(lon, lat);
    return { id, name, x: Math.round(x), y: Math.round(y), d: "" };
  },
);

/** Every place the map can draw or mark. */
export const MAPPABLE_COUNTRIES: readonly WorldCountry[] = [
  ...WORLD_COUNTRIES,
  ...MICRO_COUNTRIES,
];

/**
 * Natural Earth's abbreviations, expanded. This is what lets "Bosnia and
 * Herz.", "Dominican Rep." and "Solomon Is." meet GA4 halfway without twenty
 * more alias entries.
 */
const ABBREVIATIONS: Readonly<Record<string, string>> = {
  is: "islands",
  rep: "republic",
  dem: "democratic",
  herz: "herzegovina",
  eq: "equatorial",
  fr: "french",
  st: "saint",
  n: "north",
  s: "south",
  w: "western",
  e: "eastern",
};

/** Words that carry no distinguishing information in a country name. */
const NOISE = new Set(["and", "the", "of", "&"]);

/**
 * A comparable key for a country name.
 *
 * Diacritics are stripped so "Côte d'Ivoire" matches whichever way it arrives,
 * punctuation is dropped, Natural Earth's abbreviations are expanded, and the
 * connective words go — leaving "bosnia herzegovina" from both
 * "Bosnia and Herz." and "Bosnia & Herzegovina".
 */
export function normalizeCountryName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s.]/g, " ")
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((word) => ABBREVIATIONS[word] ?? word)
    .filter((word) => !NOISE.has(word))
    .join(" ");
}

/**
 * The names abbreviation-expansion cannot reconcile, GA4's spelling on the
 * left. Keys are already normalized; values are the ISO 3166-1 numeric id, so
 * a Natural Earth rename does not silently break the entry.
 *
 * Kept to names GA4 actually emits, plus the handful of former names still in
 * circulation. Speculative entries ("usa", "uk") would make the table look
 * more thorough while testing nothing.
 */
const ALIASES: Readonly<Record<string, string>> = {
  "united states": "840",
  "czech republic": "203",
  "ivory coast": "384",
  "congo kinshasa": "180",
  "democratic republic congo": "180",
  "congo brazzaville": "178",
  "republic congo": "178",
  "myanmar burma": "104",
  burma: "104",
  turkiye: "792",
  "north macedonia": "807",
  swaziland: "748",
  "east timor": "626",
  "palestinian territories": "275",
  "holy see": "336",
  vatican: "336",
  "french southern territories": "260",
  "falkland islands islas malvinas": "238",
  "russian federation": "643",
  "cape verde": "132",
  macau: "446",
};

/** Normalized name -> country, built once. */
const BY_NAME = new Map<string, WorldCountry>();
/** ISO numeric -> country, built once. */
const BY_ID = new Map<string, WorldCountry>();

for (const country of MAPPABLE_COUNTRIES) {
  BY_ID.set(country.id, country);
  const key = normalizeCountryName(country.name);
  // First writer wins: `WORLD_COUNTRIES` comes first, so a real outline is
  // never shadowed by a micro-state marker.
  if (!BY_NAME.has(key)) BY_NAME.set(key, country);
}

/**
 * A GA4 country name to the country the map can draw, or `null` if this
 * dataset does not know the place.
 *
 * Also accepts an ISO 3166-1 numeric or the country's own name, so the day the
 * realtime report starts carrying `countryId` this needs no second lookup.
 */
export function resolveCountry(name: string): WorldCountry | null {
  const raw = name.trim();
  if (!raw || raw === "(not set)") return null;

  if (/^\d{1,3}$/.test(raw)) {
    return BY_ID.get(raw.padStart(3, "0")) ?? null;
  }

  const key = normalizeCountryName(raw);
  if (!key) return null;

  const aliased = ALIASES[key];
  if (aliased) return BY_ID.get(aliased) ?? null;

  return BY_NAME.get(key) ?? null;
}

export type LocatedCountry = {
  country: WorldCountry;
  /** GA4's spelling, which is what the reader recognises. */
  label: string;
  value: number;
};

export type UnlocatedCountry = { label: string; value: number };

export type ResolvedCountries = {
  located: LocatedCountry[];
  /** Rows the geometry has no place for. Shown, never silently dropped. */
  unlocated: UnlocatedCountry[];
  /** Largest single value, for scaling the choropleth and the markers. */
  max: number;
  total: number;
};

/**
 * Resolve a GA4 country breakdown against the map, keeping the total intact.
 *
 * Rows are summed per country rather than assumed unique: GA4 will not
 * normally return the same country twice, but two aliases of one place folding
 * into a single entry would otherwise overwrite instead of add.
 */
export function resolveCountries(
  rows: ReadonlyArray<{ name: string; value: number }>,
): ResolvedCountries {
  const byCountry = new Map<string, LocatedCountry>();
  const unlocated: UnlocatedCountry[] = [];
  let total = 0;

  for (const row of rows) {
    const value = Number(row.value);
    if (!Number.isFinite(value) || value <= 0) continue;
    total += value;

    const country = resolveCountry(row.name);
    if (!country) {
      unlocated.push({ label: row.name || "(not set)", value });
      continue;
    }

    const existing = byCountry.get(country.id);
    if (existing) {
      existing.value += value;
    } else {
      byCountry.set(country.id, { country, label: row.name, value });
    }
  }

  const located = [...byCountry.values()].sort((a, b) => b.value - a.value);
  unlocated.sort((a, b) => b.value - a.value);

  return {
    located,
    unlocated,
    max: Math.max(0, ...located.map((entry) => entry.value)),
    total,
  };
}
