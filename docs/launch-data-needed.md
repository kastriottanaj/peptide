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

**The operator is a US company.** Identified on 2026-08-15 from the signed
Operating Agreement: a Virginia multi-member LLC, represented by its Chief
Executive Member. The name, address and representative are configured in
`/srv/peptides/.env` as `PUBLIC_COMPANY_*` and render on `/impressum/` and in
the Datenschutz controller block.

The values are **not recorded here** — same rule as the bank details in §2. The
Impressum names a real company and a real natural person, and git history is
permanent, so they live in `.env` and nowhere else. Read them from the server.

| Field | Status |
|---|---|
| `PUBLIC_COMPANY_NAME` incl. legal form | set 2026-08-15 |
| `PUBLIC_COMPANY_STREET` / `_LOCALITY` / `_COUNTRY` | set 2026-08-15 — but see the warning below |
| `PUBLIC_COMPANY_REPRESENTATIVE` | set 2026-08-15 |
| `PUBLIC_COMPANY_REGISTER_AUTHORITY` | **open** — Virginia SCC, authority name and format to confirm |
| `PUBLIC_COMPANY_REGISTER_NUMBER` | **open** — the SCC entity ID is not in the Operating Agreement |
| `PUBLIC_COMPANY_VAT_ID` | **open** — see the VAT warning below |
| Supervisory authority | **open** — a non-EU controller has no German Landesbehörde by company seat |
| Shipping provider (DHL / DPD / …) | **open** |

⚠️ **Three consequences of the operator being a US entity, none of them
cosmetic. All three need the legal review in §4 of the checklist.**

1. **The address is a private mailbox.** The Operating Agreement gives the
   principal office as a `PMB` (private mail box) suite. § 5 DDG wants a
   *ladungsfähige Anschrift* — an address at which legal service can actually
   be effected. A mail-forwarding box is contested at best. Confirm what
   address may be published, and whether the registered-agent address is the
   right one instead.
2. **An Art. 27 DSGVO representative in the Union is mandatory**, because the
   controller is not established in the EU and offers goods to data subjects
   in Germany. It must be appointed in writing and named in the
   Datenschutzerklärung; the page carries a `[Platzhalter]` saying so.
3. **VAT is not optional and not obviously zero.** A non-EU business selling
   goods to German consumers has German VAT obligations (registration, or
   OSS/IOSS). The `USt-IdNr.` field cannot be answered by the Kleinunternehmer
   question in §3 of the checklist, which assumes a German seller.

**The contact email and phone are also configuration, not page edits.** `/contact/`,
the Datenschutz controller block and the `Organization` JSON-LD all read them from
the storefront environment, so filling these two in makes the shop contactable
without touching a page:

| Variable | Value |
|---|---|
| `PUBLIC_CONTACT_EMAIL` | `info@peptideeinkaufen.de` — set and live |
| `PUBLIC_CONTACT_PHONE` | set 2026-08-15 — a German mobile number, read it from the server |
| `PUBLIC_CONTACT_HOURS` (optional, needs a phone) | **open** — no hours published, so the line promises no availability |

> **The address is configured and public**, on `/contact/`, `/datenschutz/` and
> now `/impressum/`. The mailbox is also the one the support inbox polls
> (`INBOX_SMTP_*` / `INBOX_IMAP_*` on the server, see [inbox.md](inbox.md)), so
> it is a real mailbox rather than an intended one — which is what the earlier
> "pending verification" note here was waiting for.
>
> Publishing an address that bounces is worse than publishing none: § 5 DDG
> wants a channel that works, and the customer only finds out after writing. If
> the mailbox is ever retired, unset the variable and redeploy rather than
> leaving it on the page.

⚠️ **The number is published in three places, one of them indexable.** § 5 DDG
does not require a phone number at all when the email enables fast electronic
contact, so this was a choice rather than an obligation, and it has costs worth
knowing:

- `/impressum/` and `/datenschutz/` — `noindex`, so not crawled;
- **`/contact/` — public and indexable**, as a `tel:` link;
- the site-wide `Organization` JSON-LD `telephone` property, on every page.

A number on an indexable page is scraped, so expect cold calls and SMS spam. If
that becomes a problem the fix is to unset `PUBLIC_CONTACT_PHONE` and redeploy —
the Impressum returns to `[Telefonnummer]`, `/contact/` drops the channel, and
the JSON-LD omits the property. Nothing else has to change.

No opening hours are configured, and `resolveContactChannels` drops hours
without a phone anyway, so the site promises no availability window on the
line — only that it exists.

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
