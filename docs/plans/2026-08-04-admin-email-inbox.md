# Plan — Admin email inbox (inbound only)

Spec: [docs/specs/2026-08-04-admin-email-inbox.md](../specs/2026-08-04-admin-email-inbox.md)

All paths are relative to `backend/apps/backend` unless stated otherwise.

## 1. Dependencies and configuration

- [x] `package.json` — add `imapflow` (IMAP client) and `mailparser` (MIME
      parsing) to dependencies, `@types/mailparser` to devDependencies.
- [x] `.env.template` — document every `INBOX_*` key. The mailbox address
      (`info@peptideeinkaufen.de`) is public and filled in; the password stays
      blank.
- [x] `medusa-config.ts` — register `./src/modules/inbox`.
- [x] repo `README.md` — inbox paragraph in the environment section.

Produces: the `INBOX_*` contract every later task reads.

## 2. Inbox module (persistence)

- [x] `src/modules/inbox/models/thread.ts`, `message.ts`, `sync-state.ts`
- [x] `src/modules/inbox/service.ts` — `MedusaService` plus the store methods
      the sync orchestrator needs (`findMessageByUid`, `findThreadByMessageIds`,
      `appendMessage`, counters, retention).
- [x] `src/modules/inbox/index.ts` — `INBOX_MODULE` + `Module(...)`.
- [x] `npx medusa db:generate inbox` → `src/modules/inbox/migrations/*.ts`

Consumes: nothing. Produces: `InboxStore` implementation, module key.

## 3. Inbox library

- [x] `src/lib/inbox/types.ts` — `NormalizedMessage`, `InboxStore`, sync result.
- [x] `src/lib/inbox/config.ts` — env resolution/validation, password accessor
      isolated so every use is greppable.
- [x] `src/lib/inbox/errors.ts` + `http.ts` — fixed-message error taxonomy, the
      single funnel from failure to HTTP response.
- [x] `src/lib/inbox/sanitize.ts` — header/body limits, HTML→text, control and
      bidi stripping, attachment metadata.
- [x] `src/lib/inbox/threading.ts` — subject normalisation, reference parsing,
      thread resolution rules.
- [x] `src/lib/inbox/parse.ts` — mailparser output → `NormalizedMessage`.
- [x] `src/lib/inbox/imap.ts` — ImapFlow wrapper behind an injectable factory.
- [x] `src/lib/inbox/lock.ts` — Locking-module lock, non-blocking acquire.
- [x] `src/lib/inbox/ingest.ts` — dedupe + threading + append, over `InboxStore`.
- [x] `src/lib/inbox/sync.ts` — the run: cursor, backoff, per-message isolation,
      metrics, retention.
- [x] `src/lib/inbox/service.ts` — read/query facade used by the API routes.

Consumes: module service. Produces: `runInboxSync`, query functions.

## 4. Scheduled job

- [x] `src/jobs/inbox-sync.ts` — every 5 minutes, resolves the container,
      returns early when disabled, never throws.

## 5. Admin API

- [x] `src/api/admin/inbox/threads/route.ts` (GET)
- [x] `src/api/admin/inbox/threads/[id]/route.ts` (GET, PATCH)
- [x] `src/api/admin/inbox/counts/route.ts` (GET)
- [x] `src/api/admin/inbox/messages/[id]/read/route.ts` (PATCH)
- [x] `src/api/admin/inbox/sync/route.ts` (POST)

## 6. Admin UI

- [x] `src/admin/lib/inbox-types.ts` — response types shared with tests.
- [x] `src/admin/lib/inbox-errors.ts` — status → message, no SDK import.
- [x] `src/admin/lib/inbox-api.ts` — typed GET/PATCH/POST on the existing SDK.
- [x] `src/admin/lib/inbox-queries.ts` — react-query hooks + mutations.
- [x] `src/admin/components/inbox/inbox.css` — scoped under `.pi`.
- [x] `src/admin/components/inbox/thread-list.tsx`, `thread-detail.tsx`
- [x] `src/admin/components/inbox/nav-icon.tsx` — sidebar icon + unread badge.
- [x] `src/admin/routes/inbox/page.tsx` — `defineRouteConfig({ label: "Inbox" })`.

## 7. Tests

- [x] `src/lib/inbox/__tests__/config.unit.spec.ts` — validation, off switch.
- [x] `src/lib/inbox/__tests__/sanitize.unit.spec.ts` — HTML, limits, controls.
- [x] `src/lib/inbox/__tests__/threading.unit.spec.ts` — subjects, references.
- [x] `src/lib/inbox/__tests__/ingest.unit.spec.ts` — dedupe, grouping.
- [x] `src/lib/inbox/__tests__/sync.unit.spec.ts` — mocked IMAP: first-run
      cursor, new-only import, malformed, oversized, connection failure, lock,
      disabled.
- [x] `src/lib/inbox/__tests__/routes.unit.spec.ts` — pagination, filters,
      status updates, read updates, no credential in any response.
- [x] `src/admin/components/inbox/__tests__/styles.admin.spec.tsx` — scoping,
      tokens, no `dangerouslySetInnerHTML`, no remote URL in the sources.
- [x] `src/admin/routes/inbox/__tests__/page.admin.spec.tsx` — empty state,
      filters, search, pagination, detail, read/unread, status actions,
      escaping, no reply/download control.

## 8. Verify and document

- [x] `npm run lint`, `npm run build`, `npm run test` in `backend/`.
- [x] `git diff --check`.
- [x] `docs/inbox.md` — runbook: activation steps against the existing `info@`
      mailbox (no second mailbox, no forwarding), enabling, retention decision,
      troubleshooting.
- [ ] Commit — **not done here.** Nothing is committed, pushed or deployed.
