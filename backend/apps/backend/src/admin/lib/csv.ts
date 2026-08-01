/**
 * CSV export of what is currently on screen.
 *
 * Scope is deliberately the *visible summary* — the KPIs, the daily trend, the
 * channel and page tables, the funnel. Not the order list, not customers, not
 * anything with a name or an address attached. An export is a file that leaves
 * the admin and lands in a downloads folder, gets mailed around and outlives
 * the session; the smallest thing that answers "how did the shop do" is the
 * right thing to put in it.
 *
 * Column headings are stable machine-readable keys (`sales_volume`), values are
 * localized for reading (`1.234,50 €`, `31.07.2026`). That combination is what
 * makes a file both openable in a German Excel and diffable between weeks.
 */

export type CsvSection = {
  title: string;
  headers: string[];
  rows: Array<Array<string | number>>;
};

/**
 * Quote a cell.
 *
 * Everything is quoted, not just cells that need it. Selective quoting means
 * the escaping rule has to be right in two places instead of one, and the file
 * is a few bytes larger for it.
 *
 * Values beginning with `=`, `+`, `-` or `@` are prefixed with a tab: a
 * spreadsheet treats those as formulas, and a product title starting with `=`
 * would otherwise execute on open. Nothing in this export is attacker-supplied
 * today — but product titles are merchant-supplied and this is a two-character
 * defence.
 */
export function csvCell(value: string | number): string {
  const text = typeof value === "number" ? String(value) : value ?? "";
  const guarded = /^[=+\-@\t\r]/.test(text) ? `\t${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/**
 * Sections joined into one file.
 *
 * A blank line and a title row separate sections. Not a normalized CSV shape,
 * and intentionally so — this is a report someone opens, not a table someone
 * imports, and one file beats seven downloads.
 */
export function buildCsv(sections: readonly CsvSection[]): string {
  const lines: string[] = [];

  for (const section of sections) {
    if (lines.length) lines.push("");
    lines.push(csvCell(section.title));
    lines.push(section.headers.map(csvCell).join(","));
    for (const row of section.rows) {
      lines.push(row.map(csvCell).join(","));
    }
  }

  // CRLF: Excel on Windows is the most likely destination, and it is the one
  // that cares.
  return lines.join("\r\n");
}

/**
 * Hand a built CSV to the browser as a download.
 *
 * A BOM is prepended because Excel reads a UTF-8 file without one as Latin-1,
 * which turns "Packgröße" into "PackgrÃ¶ÃŸe" in the one market this shop sells
 * to.
 */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([`﻿${content}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Revoked on the next tick rather than immediately: Safari has historically
  // cancelled the download if the object URL disappears in the same frame.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** `analytics-overview-7d-2026-08-01.csv` */
export function csvFilename(tab: string, period: string, now = new Date()): string {
  return `analytics-${tab}-${period}-${now.toISOString().slice(0, 10)}.csv`;
}
