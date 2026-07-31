# Launch data — what still has to be collected

A worksheet, not a checklist. [go-live-checklist.md](go-live-checklist.md) is the
canonical list of *what blocks launch and why*; this file is the concrete data to
go and get, with somewhere to write it down as it arrives.

**The site is live and public at https://peptideeinkaufen.de.** The gate came off
on 2026-07-29 ahead of this list, so everything below is now a **live exposure**
rather than a pre-launch task — most urgently the bank details, without which the
shop can take an order that cannot be paid.

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

**Hosting provider** — this one is already known and needs an Art. 28 DSGVO
processing agreement (AVV) in place:

> Hetzner Online GmbH, Industriestr. 25, 91710 Gundelfingen, Germany.
> Server located in Falkenstein, Germany. Request the AVV from the Hetzner
> console under Legal / Data Protection.

**How to apply:** edit the four pages, then remove the `draft` prop from
`LegalLayout` on each page that is final. That drops the banner and makes it
indexable.

---

## 2. Bank details

Blocks: every order confirmation. Payment is direct bank transfer only, so until
these are real **no customer can pay** — the confirmation page shows
`PLATZHALTER` and an orange warning telling them not to transfer.

| Variable | Value |
|---|---|
| `PUBLIC_BANK_ACCOUNT_HOLDER` (exactly as registered) | |
| `PUBLIC_BANK_IBAN` | |
| `PUBLIC_BANK_BIC` | |
| `PUBLIC_BANK_NAME` | |

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
