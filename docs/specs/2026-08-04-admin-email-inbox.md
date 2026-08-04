# Spec — Admin email inbox (inbound only)

- **Date:** 2026-08-04
- **Status:** approved (mailbox arrangement corrected 2026-08-04: direct
  connection to `info@`, no forwarding mailbox)
- **Owner:** backend (Medusa) + admin extension

## Goal

Read `info@peptideeinkaufen.de` inside the Medusa admin, without taking the
mailbox away from the person who reads it in Hostinger's webmail.

The mail flow this is built for:

```
info@peptideeinkaufen.de          ← one mailbox, unchanged
  → Hostinger Webmail reads it as it always has
  → Medusa reads the same mailbox over IMAP, read-only
```

**There is one mailbox and Medusa signs into it directly.** No second account,
no forwarding rule, no copies — nothing about mail delivery changes.

That makes read-only the load-bearing guarantee of this design rather than a
detail: the mailbox is shared with a human, so Medusa opens it read-only, never
sets a flag, never moves and never deletes. A message unread in webmail is still
unread after Medusa has imported it, and marking a message read in the admin
does not touch webmail. If the IMAP import breaks, mail delivery and webmail are
unaffected — the worst case is a stale admin page.

## Scope

### Non-goals — explicitly out

- **No sending.** No reply, no forward, no compose, no draft. Version one is a
  reader. Anything that puts mail *out* of this server is a separate decision
  with its own deliverability, signature and legal questions.
- **No HTML rendering.** Plain text only, always. See "Email is hostile input".
- **No attachment download.** Metadata (filename, MIME type, size) is recorded;
  the bytes are never stored, served or previewed.
- **No mailbox changes.** No new mailbox, no alias, no forwarding rule, no
  filter. The only manual step is putting the existing mailbox's credentials in
  the production env; the runbook lists it and it is left to a human.
- **No writing to the mailbox.** Not a policy but a structural property: the
  IMAP session interface has no method that sets a flag, moves, copies, deletes
  or appends.
- **No storefront change.** Nothing in `storefront/` is touched. This is an
  admin-only feature.
- **No automatic deletion by default.** `INBOX_RETENTION_DAYS` unset means
  nothing is ever deleted; see "Privacy and retention".
- **No production access.** Nothing here is deployed, and no credential for a
  real mailbox is created, committed or used.

### Environment

All keys are backend-only and read at runtime. None reaches a browser bundle.

```dotenv
INBOX_ENABLED=false                 # unset or anything but `true` = off
INBOX_IMAP_HOST=imap.hostinger.com
INBOX_IMAP_PORT=993
INBOX_IMAP_SECURE=true
INBOX_IMAP_USER=info@peptideeinkaufen.de   # public address, not a secret
INBOX_IMAP_PASSWORD=                       # never committed, never logged
INBOX_IMAP_MAILBOX=INBOX
INBOX_POLL_INTERVAL_SECONDS=300
INBOX_IMPORT_EXISTING=false
INBOX_IMPORT_SINCE_DAYS=14
INBOX_RETENTION_DAYS=               # unset = never delete
INBOX_MAX_BODY_CHARS=100000
INBOX_MAX_MESSAGE_BYTES=5242880
```

`INBOX_ENABLED` is the off switch and follows the `ORDERS_ENABLED` convention
already in this repo: **unset means off, and only the exact string `true` turns
it on.** Credentials are validated only when it is on, so a backend with no
inbox configuration boots and runs exactly as it does today.

`INBOX_IMPORT_EXISTING=false` (the default) means the first successful
connection **records the mailbox position and imports nothing**. `info@` is a
real mailbox with real history, so the default must not be "swallow all of it":
copying years of existing correspondence into a second system as a side effect
of flipping a switch is neither undoable from the admin nor described by the
privacy policy as it stands. Only mail that arrives after activation is
imported — including, deliberately, *not* a test mail sent beforehand.

### Data model — a new `inbox` module

Three tables, one Medusa module (`src/modules/inbox`), one generated migration.

- **`inbox_thread`** — `id`, `subject` (display), `normalized_subject`,
  `last_message_at`, `message_count`, `unread_count`, `status`
  (`open` | `resolved` | `spam`), `last_sender_name`, `last_sender_email`,
  `search_text`, `created_at`, `updated_at`.
- **`inbox_message`** — `id`, `thread_id`, `mailbox`, `uid`, `message_id`,
  `in_reply_to`, `references`, `from_name`, `from_email`, `recipients` (json),
  `subject`, `received_at`, `body_text`, `body_truncated`, `size_bytes`,
  `attachments` (json: filename, content_type, size), `is_read`, `created_at`.
- **`inbox_sync_state`** — one row per mailbox: `mailbox` (unique),
  `uid_validity`, `last_uid`, `last_synced_at`, `last_success_at`,
  `last_status`, `initialized`.

`last_sender_*` and `search_text` are denormalised onto the thread deliberately:
the list view shows a sender per row and searches sender, address and subject
together, and a per-row join over messages to render a list is the wrong shape.

**Deduplication** is `mailbox + uid` (unique index) and `message_id` (index).
Either one matching an existing row means the message is already imported.

**Threading**, in order:

1. `In-Reply-To` → the thread of the message it answers.
2. `References` → the thread of any referenced message, newest first.
3. Normalised subject **only as a last resort**, and only when the sender is
   already a participant in that thread *and* the thread has been active within
   14 days. Two strangers writing "Anfrage" a month apart must not be merged.

Subject normalisation strips German and English reply/forward prefixes
(`Re:`, `AW:`, `Fwd:`, `WG:`, …) repeatedly, collapses whitespace and lowercases.

### Email is hostile input

Every message is treated as attacker-controlled, because it is: anyone can send
mail to `info@`.

- **Plain text only.** `text/plain` is used when present. An HTML-only message is
  reduced to text server-side — `<script>` and `<style>` *contents* dropped,
  comments dropped, tags stripped, entities decoded, whitespace collapsed. The
  HTML itself is never stored, never sent to the browser and never rendered.
- No remote images, no tracking pixels, no link following, no `dangerouslySet…`
  anywhere in the feature. React escapes every sender name, address, subject and
  body by construction, and a test asserts the absence of the escape hatch.
- Raw MIME is never persisted or exposed.
- Attachment *contents* are ignored. Only filename (sanitised), MIME type and
  size are recorded, capped at 25 entries.
- Bodies are truncated at `INBOX_MAX_BODY_CHARS`, headers at fixed per-header
  limits, and messages larger than `INBOX_MAX_MESSAGE_BYTES` are recorded from
  their envelope with a placeholder body rather than downloaded.
- Control characters and bidi overrides are stripped from every stored header —
  a right-to-left override in a display name is a spoofing tool, not content.
- **Nothing containing message content or personal data is logged** in normal
  operation. Sync logs carry counts, a UID and a duration.

### IMAP synchronisation

A scheduled job (`src/jobs/inbox-sync.ts`) every five minutes, plus a manual
admin-only trigger.

- TLS verification always on. `rejectUnauthorized` is not configurable, and
  `INBOX_IMAP_SECURE=false` still requires STARTTLS rather than sending
  credentials in the clear.
- Mailbox opened **read-only**. No flag changes, no deletes, no moves — the
  mailbox is left exactly as webmail shows it, unread messages included.
- Two passes per run: fetch envelopes for UIDs above the cursor, then download
  the source of each message under the size cap individually, in UID order. One
  malformed or oversized message is counted and skipped; the run continues.
- The cursor (`last_uid`) is persisted after **each** message, so a restart
  resumes rather than re-importing, and dedupe catches the overlap either way.
- A changed `UIDVALIDITY` resets the cursor to the current mailbox position and
  logs a warning; history is not re-imported.
- Transient connection failures are retried with bounded backoff (3 attempts),
  then the run gives up and the next scheduled run tries again. A mailbox that
  is down is a log line, never an unhandled rejection.
- **Overlapping runs are prevented with Medusa's Locking module**, not an
  in-process boolean, so moving to a second Medusa instance is a provider
  change in `medusa-config.ts` rather than a code change.
- The manual endpoint shares that lock and additionally refuses to run more than
  once every 30 seconds.

### Admin API

All under `/admin`, which is where the authentication is: Medusa's `ApiLoader`
applies `authenticate("user", …)` to the whole prefix. No store route exists.

| Route | Purpose |
| --- | --- |
| `GET /admin/inbox/threads` | paginated list; `q`, `status`, `unread_only`, `limit`, `offset` |
| `GET /admin/inbox/threads/:id` | thread plus its messages, oldest first |
| `GET /admin/inbox/counts` | unread and per-status totals for the badge |
| `PATCH /admin/inbox/threads/:id` | `status`, `read` (mark every message read/unread) |
| `PATCH /admin/inbox/messages/:id/read` | one message read/unread |
| `POST /admin/inbox/sync` | manual sync, lock- and rate-limited |

Threads are ordered by `last_message_at` descending. No response ever contains
a host, user, password, or IMAP error string.

### Admin UI

One route at `/app/inbox`, styled to match the Analytics dashboard: scoped CSS
under `.pi`, the same token palette, dark mode included.

Sidebar item "Inbox" with an **unread badge**. `defineRouteConfig` accepts a
string label and a component icon, so the badge is rendered by the icon
component — it polls `/admin/inbox/counts` with plain `fetch` state, no
react-query dependency, and renders the bare icon on any failure. A sidebar that
throws would take the whole admin with it.

The page: unread count, status filter (open/resolved/spam), search, paginated
thread list (sender, subject, latest time, unread dot, message count), and a
detail pane with messages oldest-first in plain text, plus mark read/unread,
resolve, reopen and mark spam. Selected thread, filter, query and page live in
the URL. No reply, forward, download or compose control exists.

### Privacy and retention

`INBOX_RETENTION_DAYS` is **unset by default and nothing is deleted**. This
spec deliberately does not invent a retention period: choosing one is a legal
decision about business correspondence, and enabling it also requires the
Datenschutz page to say so. Both are recorded as prerequisites in the runbook.

When it is set, a successful sync deletes messages older than the window and the
threads left empty.

## Verification

```bash
cd backend
npm run lint
npm run build
npm run test          # unit + admin
```

Focused: `npm run test:unit -- inbox` and `npm run test:admin -- inbox` in
`backend/apps/backend`.

Migration: `npx medusa db:generate inbox` produces no new file (schema and
migration agree), and `npx medusa db:migrate` applies cleanly to a local
database.

Manual, all with `INBOX_ENABLED` unset:

- backend boots with no inbox variables and logs no inbox error;
- `/app/inbox` loads and shows an empty state, sidebar shows no badge;
- no IMAP connection is attempted (no network egress from the job);
- `POST /admin/inbox/sync` answers `disabled` rather than failing;
- unauthenticated `GET /admin/inbox/threads` is rejected by Medusa's admin auth;
- `grep -ri "INBOX_IMAP" backend/apps/backend/.medusa/admin` finds nothing.
