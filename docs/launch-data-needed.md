# Launch data — what still has to be collected

A worksheet, not a checklist. [go-live-checklist.md](go-live-checklist.md) is the
canonical list of *what blocks launch and why*; this file is the concrete data to
go and get, with somewhere to write it down as it arrives.

**The site is live and gated at https://peptideeinkaufen.de.** Everything below
is why the gate is still on. Fill these in, apply them, and the gate can come off
— see "Opening the shop" in [deploy.md](deploy.md).

Nothing here is a code change. It is all content and configuration.

---

## 1. Company data

Blocks: `impressum.astro`, `datenschutz.astro`, `agb.astro`, `widerruf.astro`.
All four currently render red `[Platzhalter]` markers, carry a "not legally
binding" banner and are `noindex`.

Source: your commercial register entry (Handelsregister) or trade registration
(Gewerbeanmeldung).

| Field | Value |
|---|---|
| Firmierung incl. legal form (GmbH / UG / e.K. / …) | |
| Street and number | |
| Postcode and town | |
| Managing director / owner | |
| Email for the Impressum | |
| Phone for the Impressum | |
| Registergericht | |
| HRB / HRA number (or "none") | |
| USt-IdNr. (or "Kleinunternehmer §19 UStG") | |
| Supervisory authority (follows from company seat) | |
| Shipping provider (DHL / DPD / …) | |

**The contact email and phone are also configuration, not page edits.** `/contact/`,
the Datenschutz controller block and the `Organization` JSON-LD all read them from
the storefront environment, so filling these two in makes the shop contactable
without touching a page:

| Variable | Value |
|---|---|
| `PUBLIC_CONTACT_EMAIL` | `info@peptideeinkaufen.de` — **PENDING VERIFICATION** (see below) |
| `PUBLIC_CONTACT_PHONE` (only if publicly offered) | |
| `PUBLIC_CONTACT_HOURS` (optional, needs a phone) | |

> **`info@peptideeinkaufen.de` is the intended address, not a verified one.**
> Confirmed with the owner on 2026-08-01 that the mailbox has **not** been
> tested. It is therefore set nowhere — not in `/srv/peptides/.env`, not in
> `storefront/.env`, not in any tracked file — and every build still renders the
> "no contact channel" state.
>
> - [ ] Send a test message to the mailbox from an unrelated account and confirm
>       it arrives and can be replied to.
> - [ ] Only then configure it, following
>       ["Publishing the contact email"](deploy.md) in the deploy runbook: back
>       up `/srv/peptides/.env`, set the key exactly once, **rebuild and
>       deploy** — the static storefront bakes the value in at build time, so
>       restarting Medusa changes nothing.
>
> Publishing an address that bounces is worse than publishing none: § 5 DDG
> wants a channel that works, and the customer only finds out after writing.

Until one of them is set, `/contact/` states plainly that the channels are being
set up rather than printing a placeholder — it is a public, indexable page. Set
them in `/srv/peptides/.env` and redeploy, the same way as the bank details below.

**Hosting provider** — this one is already known and needs an Art. 28 DSGVO
processing agreement (AVV) in place:

> Hetzner Online GmbH, Industriestr. 25, 91710 Gundelfingen, Germany.
> Server located in Falkenstein, Germany. Request the AVV from the Hetzner
> console under Legal / Data Protection.

⚠️ **Do not copy that postal address into the Datenschutz page without checking
it against Hetzner's own Impressum.** The town looks wrong (Hetzner's registered
seat is Gunzenhausen, not Gundelfingen), and naming a processor at an address it
does not have is a defect in the privacy policy rather than a typo in a note.
`datenschutz.astro` therefore names *Hetzner Online GmbH* and a data centre in
Germany — both verifiable from [deploy.md](deploy.md) — and carries a
`[Platzhalter]` for the full address until it is confirmed.

**How to apply:** edit the four pages, then remove the `draft` prop from
`LegalLayout` on each page that is final. That drops the banner and makes it
indexable.

---

## 2. Bank details — interim account set 2026-08-15

Payment is direct bank transfer only. All four are configured with an **interim
personal Wise account** (Belgian IBAN), so confirmations show real details and
no warning. What is still owed is the **business** account.

The values are not recorded here or anywhere else in git — read them from
`/srv/peptides/.env` on the server. Fill the table in only when the business
account replaces them, and even then keep the IBAN out of this file.

| Variable | Value |
|---|---|
| `PUBLIC_BANK_ACCOUNT_HOLDER` (exactly as registered) | set — personal, interim |
| `PUBLIC_BANK_IBAN` | set — interim |
| `PUBLIC_BANK_BIC` | set — interim |
| `PUBLIC_BANK_NAME` | set — interim |

**How to apply:** set them in `/srv/peptides/.env` on the server, then redeploy —
they are baked into the static build, so a redeploy is required, not just a
restart.

```bash
ssh root@2.28.21.11
nano /srv/peptides/.env
bash /srv/peptides/repo/deploy/deploy.sh <sha>
```

Never commit them. `.env` is git-ignored and git history is permanent.

---

## 3. Catalog — real analytical data

Blocks: honest product pages. Every purity value, COA status and price currently
in the catalog is **fabricated placeholder data**, tagged `metadata.demo`.
Publishing invented analytical figures for research chemicals is the item on this
page with the most exposure attached to it.

Six products are live. For each you need real numbers from the actual batch:

| Product | Purity (HPLC) | COA file | Batch / Lot | Price per pack size |
|---|---|---|---|---|
| BPC-157 | | | | |
| Retatrutide | | | | |
| GHK-Cu | | | | |
| MOTS-c | | | | |
| Semax | | | | |
| TB-500 | | | | |

Also needed per product: storage conditions, and whether the withdrawal right is
excluded for sealed vials (§ 312g Abs. 2 Nr. 3 BGB) — see checklist §4.

**How to apply:** update `backend/apps/backend/src/scripts/seed-peptides.ts` so
the state is reproducible, rather than editing the admin by hand. Then re-run it
on the server and redeploy so the static pages pick up the changes. Remove the
`demo` flag from `metadata` as each product becomes real.

---

## Also open, not on this worksheet

Two more hard blockers that are decisions or build work rather than data to
collect — full detail in [go-live-checklist.md](go-live-checklist.md):

- **B2B or B2C** (§3). A decision, not a lookup. It changes the AGB, the
  Widerruf page and whether prices are shown net or gross. Nothing about it
  depends on the server, so it can be settled today.
- **Order confirmation email** (§6). Now unblocked — DNS exists, so a mailbox on
  the domain plus SPF/DKIM/DMARC is possible. Must come *after* the bank details
  in §2, since the email carries them.

---

## When everything above is done

1. Apply each item and redeploy.
2. Confirm no `[Platzhalter]` or `PLATZHALTER` remains anywhere on the site.
3. Rate-limit `/store/order-lookup` — it is unauthenticated and currently only
   protected by the gate.
4. Remove the `=== PRE-LAUNCH GATE ===` block from `deploy/Caddyfile`, redeploy,
   and verify the apex returns 200 with no `X-Robots-Tag`.
