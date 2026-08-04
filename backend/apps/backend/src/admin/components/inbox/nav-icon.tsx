/**
 * The sidebar icon, with the unread badge on it.
 *
 * `defineRouteConfig` takes a **string** label and a component icon, so the
 * badge has to live on the icon — that is the only part of the sidebar item an
 * extension can render. It works out well: a count sitting on the envelope is
 * what a mail client looks like anyway.
 *
 * This component renders inside the admin's own navigation, on every page of
 * the application, which dictates three unusual choices:
 *
 *  - **No react-query.** `useQuery` throws when no `QueryClientProvider` is
 *    above it, and a throw here would take the whole sidebar — and with it the
 *    admin — down. Plain `useState`/`useEffect` and the fetch cannot do that.
 *  - **Failure is silent.** Any error renders the bare envelope. An admin
 *    signed out, an inbox module unreachable, a 500: none of them is worth
 *    breaking navigation over, and the page itself explains what is wrong.
 *  - **Polling stops.** Once a minute while the tab is visible, and not at all
 *    after three consecutive failures — an admin left open overnight on a
 *    broken deploy must not spend the night retrying.
 *
 * Styling is inline rather than from `inbox.css`, because the sidebar renders
 * before the Inbox route's chunk (and its stylesheet) has been loaded.
 */

import { Envelope } from "@medusajs/icons";
import { useEffect, useState } from "react";

const POLL_MS = 60_000;
const MAX_FAILURES = 3;

/** Above this the badge stops counting and starts saying "a lot". */
const BADGE_CAP = 99;

type CountsResponse = { unread_messages?: unknown };

export function InboxNavIcon() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const schedule = () => {
      if (cancelled || failures >= MAX_FAILURES) return;
      timer = setTimeout(load, POLL_MS);
    };

    async function load() {
      if (cancelled) return;

      // A hidden tab costs nothing and learns nothing; check again later.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        schedule();
        return;
      }

      try {
        const response = await fetch("/admin/inbox/counts", {
          credentials: "include",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });

        if (!response.ok) throw new Error(String(response.status));

        const payload = (await response.json()) as CountsResponse;
        const value = Number(payload?.unread_messages ?? 0);

        if (!cancelled) {
          failures = 0;
          setUnread(Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
        }
      } catch {
        failures += 1;
        // No badge rather than a stale one: a number that stopped updating is
        // worse than no number.
        if (!cancelled && failures >= MAX_FAILURES) setUnread(0);
      } finally {
        schedule();
      }
    }

    void load();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <span
      style={{ position: "relative", display: "inline-flex", lineHeight: 0 }}
    >
      <Envelope />
      {unread > 0 && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: -5,
            right: -7,
            minWidth: 15,
            height: 15,
            padding: "0 3px",
            borderRadius: 999,
            background: "#1f5136",
            color: "#ffffff",
            fontSize: 9,
            fontWeight: 700,
            lineHeight: "15px",
            textAlign: "center",
          }}
        >
          {unread > BADGE_CAP ? `${BADGE_CAP}+` : unread}
        </span>
      )}
      {/* The badge is decorative; this is the part a screen reader gets. */}
      {unread > 0 && (
        <span
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            overflow: "hidden",
            clip: "rect(0, 0, 0, 0)",
            whiteSpace: "nowrap",
          }}
        >
          {unread} unread messages
        </span>
      )}
    </span>
  );
}

export default InboxNavIcon;
