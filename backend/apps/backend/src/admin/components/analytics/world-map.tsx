/**
 * The Live tab's world map.
 *
 * Drawn as inline SVG from committed path data (`lib/world-geo.ts`), for the
 * same reason the charts next to it are hand-drawn: the admin has no mapping
 * library and this panel is not worth adding one. A projection library, a
 * topology asset and a canvas renderer would cost several hundred kilobytes to
 * colour twenty countries in a picture that never changes shape.
 *
 * What it shows is *active users by country* from GA4 realtime — a
 * consent-dependent activity signal covering roughly the last thirty minutes,
 * never sales and never revenue. The caller supplies the wording.
 *
 * Three properties this panel has to keep:
 *
 * - **The total on the map equals the total in the data.** Countries the
 *   geometry cannot place are listed under the map rather than dropped, so the
 *   figures cannot quietly disagree with the ranked list beside them.
 * - **A country with visitors is always visible.** Fill alone fails for small
 *   countries, so every active country also gets a marker sized by its value.
 *   Liechtenstein and Germany are both findable.
 * - **The numbers are readable without the picture.** `role="img"` with a
 *   generated description, and a visually hidden table underneath — the same
 *   contract as `charts.tsx`.
 */

import { useId, useMemo, useState } from "react";
import {
  resolveCountries,
  type LocatedCountry,
} from "../../lib/country-lookup";
import {
  WORLD_COUNTRIES,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../../lib/world-geo";

export type WorldMapRow = { name: string; value: number };

type Props = {
  rows: readonly WorldMapRow[];
  /**
   * Plural noun for the measured quantity, lower case, e.g. "active users".
   * It appears mid-sentence in the generated description as often as it does
   * at the start of a heading, so the component capitalizes rather than the
   * caller.
   */
  unit: string;
  formatValue: (value: number) => string;
  /**
   * Shown over the basemap when there is nothing to plot.
   *
   * The map deliberately does **not** collapse to an empty state. An empty
   * ranked list is nothing to look at, but an empty map is still a map — and
   * for this shop "nobody is active" is the normal reading, not an error. The
   * panel should look the same at 3am as it does at noon, minus the markers.
   */
  emptyTitle?: string;
  emptyDescription?: string;
};

const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

/** Marker radius in viewBox units. Small enough for Europe, big enough to hit. */
const MARKER_MIN = 3.2;
const MARKER_MAX = 9;

/**
 * Fill strength for a country, on a deliberately shallow scale.
 *
 * A linear ramp from zero would render every country but the leader as almost
 * invisible whenever one market dominates — which is this shop's normal state,
 * Germany against everywhere else. Starting at 0.35 keeps the smallest
 * participant legible while the leader is still clearly the leader. The square
 * root does the rest.
 */
function intensity(value: number, max: number): number {
  if (max <= 0) return 0;
  return 0.35 + 0.65 * Math.sqrt(Math.min(1, value / max));
}

function markerRadius(value: number, max: number): number {
  if (max <= 0) return MARKER_MIN;
  // Area-proportional, so a value twice as large looks twice as big rather
  // than four times.
  return MARKER_MIN + (MARKER_MAX - MARKER_MIN) * Math.sqrt(Math.min(1, value / max));
}

export function WorldMap({
  rows,
  unit,
  formatValue,
  emptyTitle,
  emptyDescription,
}: Props) {
  const titleId = useId();
  const [hovered, setHovered] = useState<string | null>(null);

  const { located, unlocated, max, total } = useMemo(
    () => resolveCountries(rows),
    [rows],
  );

  /** id -> entry, so the geometry pass can colour in one lookup. */
  const activeById = useMemo(() => {
    const map = new Map<string, LocatedCountry>();
    for (const entry of located) map.set(entry.country.id, entry);
    return map;
  }, [located]);

  const leader = located[0];
  const places = located.length + unlocated.length;
  // "N in total" rather than "N active users": the unit is a fixed plural, and
  // a single visitor would otherwise be announced as "1 active users".
  const description = leader
    ? `${formatValue(total)} in total across ${places} ${
        places === 1 ? "country" : "countries"
      }, led by ${leader.label} with ${formatValue(leader.value)}.`
    : `No ${unit} to show.`;

  const active = hovered ? activeById.get(hovered) : null;
  const nothingToPlot = located.length === 0 && unlocated.length === 0;

  return (
    <div className="pa-worldmap">
      <div className="pa-worldmap__frame">
        <svg
          className="pa-worldmap__svg"
          viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`}
          role="img"
          aria-labelledby={titleId}
          onMouseLeave={() => setHovered(null)}
        >
          <title id={titleId}>
            {`${capitalize(unit)} by country. ${description}`}
          </title>

          {/*
            Every country is drawn, including the quiet ones: a choropleth
            without its basemap is a scatter of shapes nobody can orient in.
          */}
          <g className="pa-worldmap__land">
            {WORLD_COUNTRIES.map((country) => {
              if (!country.d) return null;
              const entry = activeById.get(country.id);

              return (
                <path
                  key={country.id}
                  d={country.d}
                  className={
                    entry
                      ? "pa-worldmap__country pa-worldmap__country--active"
                      : "pa-worldmap__country"
                  }
                  fillOpacity={entry ? intensity(entry.value, max) : undefined}
                  onMouseEnter={entry ? () => setHovered(country.id) : undefined}
                />
              );
            })}
          </g>

          {/*
            Markers last so they sit above the fills. They are what makes a
            city-state findable, so they are drawn for every active country
            rather than only the ones with no outline.
          */}
          <g>
            {located.map((entry) => {
              const radius = markerRadius(entry.value, max);
              return (
                <g
                  key={entry.country.id}
                  className={
                    hovered === entry.country.id
                      ? "pa-worldmap__marker pa-worldmap__marker--hover"
                      : "pa-worldmap__marker"
                  }
                  onMouseEnter={() => setHovered(entry.country.id)}
                >
                  <circle
                    className="pa-worldmap__pulse"
                    cx={entry.country.x}
                    cy={entry.country.y}
                    r={radius}
                  />
                  <circle
                    className="pa-worldmap__dot"
                    cx={entry.country.x}
                    cy={entry.country.y}
                    r={radius}
                  />
                  {/* Native tooltip, for touch and for anyone not using the panel below. */}
                  <title>{`${entry.label}: ${formatValue(entry.value)}`}</title>
                </g>
              );
            })}
          </g>
        </svg>

        {nothingToPlot && (emptyTitle || emptyDescription) && (
          <div className="pa-worldmap__empty">
            {emptyTitle && (
              <p className="pa-worldmap__empty-title">{emptyTitle}</p>
            )}
            {emptyDescription && (
              <p className="pa-worldmap__empty-text">{emptyDescription}</p>
            )}
          </div>
        )}

        {active && (
          <div
            className="pa-worldmap__tip"
            style={{
              left: `${(active.country.x / WORLD_WIDTH) * 100}%`,
              top: `${(active.country.y / WORLD_HEIGHT) * 100}%`,
            }}
          >
            <span className="pa-worldmap__tip-name">{active.label}</span>
            <span className="pa-worldmap__tip-value">
              {formatValue(active.value)}
            </span>
          </div>
        )}
      </div>

      <div className="pa-worldmap__foot">
        {/* A scale with nothing on it explains nothing, so it waits for data. */}
        {!nothingToPlot && (
          <div className="pa-worldmap__legend" aria-hidden="true">
            <span className="pa-worldmap__legend-label">1</span>
            <span className="pa-worldmap__ramp" />
            <span className="pa-worldmap__legend-label">
              {formatValue(Math.max(1, max))}
            </span>
          </div>
        )}

        {/*
          Unplaceable rows are stated, not hidden. Natural Earth 110m has no
          geometry for some territories, and GA4 reports "(not set)" for
          visitors it cannot locate — both would otherwise make the map's total
          silently smaller than the list's.
        */}
        {unlocated.length > 0 && (
          <p className="pa-worldmap__note">
            {`Not on the map: ${unlocated
              .map((row) => `${row.label} (${formatValue(row.value)})`)
              .join(", ")}`}
          </p>
        )}
      </div>

      {/*
        Deliberately worded "per country" rather than repeating the card's own
        "by country" heading: a screen reader would otherwise announce the same
        phrase twice in a row, once for the panel and once for its table.
      */}
      <table className="pa-sr">
        <caption>{`${capitalize(unit)} per country`}</caption>
        <thead>
          <tr>
            <th scope="col">Country</th>
            <th scope="col">{capitalize(unit)}</th>
          </tr>
        </thead>
        <tbody>
          {[
            ...located.map((entry) => ({
              label: entry.label,
              value: entry.value,
            })),
            ...unlocated,
          ].map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{formatValue(row.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
