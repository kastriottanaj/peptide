# Admin email inbox — runbook

`info@peptideeinkaufen.de`, readable inside the Medusa admin at **`/app/inbox`**.

Spec: [specs/2026-08-04-admin-email-inbox.md](specs/2026-08-04-admin-email-inbox.md).
Status as of 2026-08-04: **implemented, switched off, never connected to a real
mailbox.** No credential exists yet, and the activation steps below have not
been done.

## The mail flow

```
someone → info@peptideeinkaufen.de     ← the one real mailbox, unchanged
            │
            ├─ Hostinger Webmail reads it as it always has
            └─ Medusa reads the same mailbox over IMAP, READ-ONLY, every 5 min
```

There is **one mailbox**. Medusa signs in to `info@peptideeinkaufen.de` itself —
no second account, no forwarding rule, no copies. Nothing about how mail is
delivered or read in webmail changes.

Because the mailbox is shared with a human, **read-only is the load-bearing
guarantee here.** Medusa opens the mailbox read-only and has no code path that
can set a flag, move or delete a message — see `src/lib/inbox/imap.ts`, whose
session interface offers no such method. Concretely:

- a message read in webmail stays read;
- a message *unread* in webmail stays unread after Medusa imports it;
- marking a message read in `/app/inbox` does **not** mark it read in webmail.
  Medusa's read state is its own and is never written back.

If the importer breaks, mail delivery and webmail are unaffected. The worst case
is a stale admin page.

## Activation steps (not done)

None of this is automated, and none of it should be done from a script:

1. Put the existing `info@peptideeinkaufen.de` mailbox credentials privately
   into the production env (`/srv/peptides/.env`), or
   `backend/apps/backend/.env` locally. Never in the repository, never in a
   commit message, never in this file.
2. Keep IMAP strictly read-only — nothing in this feature writes to the mailbox,
   and nothing added later should. If Hostinger offers a restricted/app-specific
   credential, prefer it.
3. Set `INBOX_ENABLED=true`.
4. Restart Medusa.
5. Send a **new** test email to `info@` *after* activation.
6. Confirm it appears in both Hostinger Webmail and the Medusa admin inbox.

Step 5 says *new* for a reason: with `INBOX_IMPORT_EXISTING=false` the importer
starts at the mailbox's current position, so a mail sent before activation will
not appear in the admin. That is correct behaviour, not a fault.

## Switching it on

```dotenv
INBOX_ENABLED=true
INBOX_IMAP_HOST=imap.hostinger.com
INBOX_IMAP_PORT=993
INBOX_IMAP_SECURE=true
INBOX_IMAP_USER=info@peptideeinkaufen.de
INBOX_IMAP_PASSWORD=          # the real password, only in the env file
INBOX_IMAP_MAILBOX=INBOX
```

Then restart Medusa. Every key is documented in `.env.template`.

**`INBOX_ENABLED` unset means off**, like `ORDERS_ENABLED`: only the exact
string `true` turns it on. While it is off nothing opens a socket, nothing is
validated, and `/app/inbox` still shows whatever was imported previously.

### The first run imports nothing, on purpose

With `INBOX_IMPORT_EXISTING=false` (the default) the first successful connection
records the mailbox's current position (`uidNext - 1`) and imports **only
messages that arrive after it**. `info@` is a real mailbox with real history:
importing years of existing correspondence into a second system as a side effect
of flipping a switch is not something you can undo from the admin, and it is not
something a privacy policy written for the old state describes.

So the pre-activation test mail and everything older stay where they are —
readable in webmail, absent from `/app/inbox`.

To backfill deliberately, set `INBOX_IMPORT_EXISTING=true` *before the first
run* and bound it with `INBOX_IMPORT_SINCE_DAYS` (default 14, max 365). Treat
that as a data-protection decision, not a convenience. After the first run the
flag does nothing — the cursor is already recorded.

To redo the first run (test mailbox only): delete the `inbox_sync_state` row for
that mailbox.

## What it does every five minutes

1. Takes a lock (Medusa's Locking module). Another sync running ⇒ this one does
   nothing at all.
2. Connects, opens the mailbox **read-only**. Transient failures are retried
   three times with backoff; an authentication failure is not retried.
3. Fetches envelopes for UIDs above the stored cursor, up to 200 per run.
4. Downloads each message under `INBOX_MAX_MESSAGE_BYTES`, parses it, reduces it
   to plain text, stores it, and **writes the cursor after every message** so a
   restart resumes instead of re-importing.
5. Deduplicates on `(mailbox, uid)` and on `Message-ID`.
6. Threads on `In-Reply-To`, then `References`, then — only if the sender is
   already on the thread and it has been active within 14 days — the normalised
   subject.
7. Applies retention, if configured.

One malformed message is counted, skipped and the cursor moves past it. One
oversized message is recorded from its envelope with a placeholder body; its
content stays in Hostinger.

Logs carry counts, a UID, a duration and a coarse failure label
(`auth`, `tls`, `unreachable`, `no-mailbox`). **No subject, address, body or
password is ever logged.**

## Troubleshooting

Press **Sync now** on `/app/inbox`. It runs the same code as the scheduler,
shares the same lock, and refuses to run more than once every 30 seconds. Its
answer is one of:

| Status | Meaning | Where the fix is |
| --- | --- | --- |
| `ok` | It ran. The counts say what it did. | — |
| `disabled` | `INBOX_ENABLED` is not `true`. Nothing was contacted. | env |
| `misconfigured` | Switched on, settings incomplete. | env |
| `locked` | Another sync holds the lock. | wait |
| `throttled` | Less than 30s since the last one. | wait |
| `unreachable` | The mailbox did not answer. | server logs |

The browser is told nothing else — no host, no user, no IMAP error text. That is
deliberate: this endpoint is called precisely when something is wrong, and an
admin session is not a reason to hand out the mail server's answers. The detail
is in the Medusa log:

```bash
journalctl -u medusa -n 200 | grep '\[inbox\]'
```

`auth` means the password was rejected — rotate it in Hostinger and update the
env. **This is the same mailbox password a human uses for webmail**, so a
rotation has to be coordinated: change it in Hostinger, tell whoever reads the
mailbox, and update `/srv/peptides/.env` in the same sitting, or the importer
starts failing every five minutes. `tls` means the certificate did not verify;
that is never waved through, because something being between this process and
the mail server is exactly what the check is for. `no-mailbox` means
`INBOX_IMAP_MAILBOX` does not exist.

**`UIDVALIDITY changed`** in the log means the mail server renumbered the
mailbox (usually because it was recreated). The cursor is rebuilt at the current
position and history is *not* re-imported; anything that arrived in the gap has
to be read in Hostinger.

## Running more than one Medusa instance

The sync lock uses Medusa's Locking module, whose default provider is
**in-memory** — correct for today's single-instance deploy, and not sufficient
for two. Before running a second instance, register a shared provider in
`medusa-config.ts`:

```ts
[Modules.LOCKING]: {
  resolve: '@medusajs/locking',
  options: {
    providers: [
      { resolve: '@medusajs/locking-redis', id: 'redis',
        is_default: true, options: { redisUrl: process.env.REDIS_URL } },
    ],
  },
},
```

No code changes: `src/lib/inbox/lock.ts` resolves whatever provider is
configured.

## Retention

`INBOX_RETENTION_DAYS` is **unset, and nothing is ever deleted.**

That is not an oversight, and this document deliberately does not suggest a
number. Two things have to happen before it is set:

1. **A retention decision.** How long inbound business correspondence is kept is
   a legal and commercial question (§ 147 AO and § 257 HGB reach six and ten
   years for some documents; a general enquiry is not one of those, but the
   distinction is not a developer's call).
2. **A privacy-policy update.** `storefront/src/pages/datenschutz.astro` has to
   describe that email to `info@` is copied into a second system (this admin)
   and for how long it is kept there. A policy that does not mention it is wrong
   the moment this is enabled — and a policy describing a retention period that
   is not implemented is equally wrong.

When it is set, each successful sync deletes messages older than the window, in
batches of 1000, and then removes the threads left empty.

## What this feature deliberately does not do

- **No sending.** No reply, forward, compose or draft. Replies are written in
  webmail, from the mailbox itself.
- **No writing to the mailbox at all.** No flag change, no move, no delete, no
  append. The mailbox is opened read-only and the session interface has no
  method that could do otherwise.
- **No HTML.** `text/plain` is used when present; an HTML-only message is
  reduced to text on the server, and the HTML is discarded rather than stored.
  The admin renders `body_text` in a `<pre>`, escaped by React.
- **No remote content.** No image, pixel or stylesheet from a message is ever
  requested, because no URL from a message is kept.
- **No attachment download.** Filename, MIME type and size are recorded; the
  bytes are not stored and no endpoint serves them.
- **No store API.** Every route is under `/admin` and behind Medusa's admin
  authentication. This is somebody's correspondence.

## Files

| Path | What it is |
| --- | --- |
| `src/modules/inbox/` | models, migration, module service (store + reader) |
| `src/lib/inbox/config.ts` | env resolution; the password accessor lives here alone |
| `src/lib/inbox/sanitize.ts` | HTML→text, limits, invisible-character stripping |
| `src/lib/inbox/threading.ts` | subject normalisation, reference parsing, rules |
| `src/lib/inbox/imap.ts` | ImapFlow wrapper — read-only by construction |
| `src/lib/inbox/sync.ts` | one run: cursor, backoff, per-message isolation |
| `src/lib/inbox/lock.ts` | the Locking-module lock |
| `src/lib/inbox/service.ts` | the single entry point both callers use |
| `src/jobs/inbox-sync.ts` | the five-minute schedule |
| `src/api/admin/inbox/**` | the six admin routes |
| `src/admin/routes/inbox/page.tsx` | the page at `/app/inbox` |
