# Go-Live Checklist

**Status as of 2026-07-26: the business is still being established.**

The shop cannot go live yet, and that is not a technical problem. Company
registration, the business bank account and the legal review are all still in
progress. Everything below is waiting on real-world information that does not
exist yet — the code is in place and each item is a configuration or content
change, not development work.

This file is the single place to look for "what are we still waiting on".
Update it as items land.

> For the concrete fields to go and collect — company data, bank details, real
> purity figures — use the worksheet at
> [launch-data-needed.md](launch-data-needed.md). It has somewhere to write each
> value down and how to apply it. This file stays the canonical list of *what
> blocks launch and why*.

> **The site went public on 2026-07-29, with §1, §2, §3 and §6 still open.** The
> pre-launch gate was removed by explicit decision ahead of these items, so
> everything below is now a **live exposure**, not a pre-launch task. The shop is
> reachable and every page is crawlable. It does not take orders: that is
> `ORDERS_ENABLED`, still unset, and not a consequence of the items below.

**Hard blockers:** real company data on the legal pages (§2), the B2B/B2C
decision (§3), and the order confirmation email (§6). §1 is **provisionally
cleared** — an interim personal account is configured, see below — but the shop
still cannot lawfully trade without §2 and §3.

Two mitigations are in place:

- **Ordering is closed** as of 2026-07-30 (`ORDERS_ENABLED` unset in
  `/srv/peptides/.env`): the catalog is public, but add-to-cart and the checkout
  form are not rendered and the API refuses cart completion with 503. It stayed
  closed on 2026-08-15 when the interim bank details were configured — an
  explicit decision, because §2, §3 and §6 are still open. See
  [checkout.md](checkout.md).
- The four legal pages keep a per-page `noindex` from the `draft` prop, so
  unreviewed legal text is publicly reachable but not indexed. `deploy.sh` checks
  `/impressum` for it on every deploy.

---

## 1. Bank account — provisionally cleared 2026-08-15

Payment is direct bank transfer only. An **interim personal Wise account** is
configured, so a confirmation now shows real details and no orange warning.
This is explicitly a stopgap until the business account exists.

Set in `/srv/peptides/.env` (and `storefront/.env` locally), then rebuild:

```dotenv
PUBLIC_BANK_ACCOUNT_HOLDER=   # exactly as registered with the bank
PUBLIC_BANK_IBAN=
PUBLIC_BANK_BIC=
PUBLIC_BANK_NAME=
```

No code change needed — see [checkout.md](checkout.md). `.env` is git-ignored;
the IBAN must never be committed.

- [x] ~~Four variables set and storefront rebuilt~~ — 2026-08-15, interim
      personal Wise account (Belgian IBAN). Verified against two local test
      orders: real details, no warning, and the reference on screen equals
      `metadata->>'bank_reference'` in Postgres.
- [ ] **Business bank account opened** — still open. Three things follow from
      the interim account being personal and foreign, and none of them is
      cosmetic:
      - the payee name is a private individual while the Impressum is still
        `[Platzhalter]` (§2), which to a customer looks exactly like a scam;
      - the IBAN is Belgian, not German — legitimate for SEPA, but it needs the
        Impressum to explain who is being paid;
      - Wise is named in `datenschutz.astro` as the recipient of the payment
        data, with its company data still `[Platzhalter]` pending §4.
- [ ] `ORDERS_ENABLED=true` in `/srv/peptides/.env` — reopens add-to-cart, the
      checkout form and cart completion. **Deliberately still unset.** The bank
      details alone were never the whole gate: §2, §3 and §6 remain open, and
      §6 in particular means a customer gets nothing in writing.
- [ ] Test order against production once it is open

## 2. Company details — blocks the legal pages

Every legal page renders company data as red `[Platzhalter]` markers and carries
a banner saying it is not legally binding. All four are `noindex` until then.

Needed, from the commercial register entry or trade registration:

- [ ] Firmierung including legal form (GmbH, UG, e.K., …)
- [ ] Business address
- [ ] Managing director / owner name
- [ ] Email and phone for the Impressum
- [ ] Registergericht and HRB/HRA number (or confirmation that none exists)
- [ ] USt-IdNr., or confirmation of Kleinunternehmerregelung
- [ ] Competent data-protection supervisory authority (follows from company seat)
- [ ] Hosting provider named, with an Art. 28 DSGVO processing agreement
- [ ] Shipping provider named

Pages affected: `impressum.astro`, `datenschutz.astro`, `agb.astro`,
`widerruf.astro`. Remove `draft` from the `LegalLayout` props once a page is
final — that drops the banner and makes it indexable.

## 3. The B2B / B2C decision — changes the terms

**This one is a decision, not a lookup, and it needs making before launch.**

Selling only to businesses, research institutions and public bodies is a very
different legal position from selling to consumers:

| | B2B only | Consumers included |
|---|---|---|
| Widerrufsrecht | Does not apply | 14 days, statutory instruction required |
| Warranty | Can be limited | § 476 BGB restricts limitation |
| Price display | Net prices permissible | Gross prices with VAT required |
| Gerichtsstand clause | Permissible | Not permissible |

`widerruf.astro` currently ships the **consumer** version deliberately. If a
consumer buys without a proper Widerrufsbelehrung, the withdrawal period
stretches to about twelve months instead of fourteen days — so having it and not
needing it is the cheap mistake, and the reverse is the expensive one.

- [ ] Decide the customer group
- [ ] If B2B only: state it explicitly in AGB § 2 and replace `widerruf.astro`
      with a short notice that no withdrawal right applies
- [ ] If consumers included: confirm gross pricing and who bears return shipping

## 4. Legal review

The legal pages are structurally complete scaffolding, not reviewed text. They
were written to the right statutory sections but have not been checked by a
lawyer, and this product category (research chemicals) carries specific risk.

- [ ] All four pages reviewed by a lawyer
- [ ] Decide whether the withdrawal right is excluded for sealed vials
      (§ 312g Abs. 2 Nr. 3 BGB) and label affected products accordingly
- [ ] Check export restrictions per destination country

## 5. Product data

Every purity value, COA status and price in the catalog is fabricated
placeholder data, tagged `metadata.demo`. It must be replaced with real,
lab-verified analytical data before anything is sold.

- [ ] Real analytical data per product
- [ ] Real prices
- [ ] COA documents available
- [ ] `demo` flags removed

## 6. Order confirmation email — MUST be done before deploying live

**Deferred on 2026-07-27 by decision. Do not launch without it.**

No email is sent after an order. Today that is survivable only because nobody
real is ordering.

Why it is a launch blocker rather than a nice-to-have: payment is bank transfer,
and the payment reference exists **only on the confirmation page**. A customer
who closes that tab — or pays later from their banking app, which is the normal
way people pay an invoice — has no record of the reference, the IBAN, or the
amount. They either cannot pay, or they pay without a usable reference and the
transfer cannot be matched to their order. Both end in a support conversation
and possibly a refund.

What it needs:

- [ ] A sending domain and mailbox on `peptideeinkaufen.de` — **unblocked as of
      2026-07-28**: DNS now points at the Hetzner box and records are managed in
      Hostinger's hPanel, so SPF/DKIM/DMARC can be added.
- [ ] SMTP or Resend credentials in the backend `.env`
- [ ] A Medusa notification provider configured
- [ ] An `order.placed` subscriber that sends the confirmation, containing at
      minimum: order number, itemised lines, total, IBAN/BIC/holder, and the
      payment reference
- [ ] SPF, DKIM and DMARC records, or the mail lands in spam — which for this
      email is the same as not sending it
- [ ] Verified end to end: place a test order, receive the mail, confirm the
      reference in it matches `metadata->>'bank_reference'` on the order

Note this must come **after** the bank details in section 1, since the email
carries them.

**Partially mitigated since 2026-07-27:** `/bestellung/suchen` lets a customer
retrieve their order and payment reference with order number + email, so a
closed tab is no longer a dead end. That reduces the damage but does not remove
the requirement — a customer who never receives anything in writing has no
prompt to pay at all, and no record for their own accounts.

- [ ] **Rate-limit `/store/order-lookup` before it is publicly reachable.**
      It is an unauthenticated endpoint taking an order number and an email.
      The generic error prevents probing for *which* half was wrong, but nothing
      stops volume. Put Cloudflare (or equivalent) in front of it at deploy time.

## 7. Technical items not blocked on the business

These can be done at any time:

- [x] ~~Shipping rules~~ — done 2026-07-26. €10 Germany, €20 rest of Europe,
      free from €100 merchandise after discount, verified across seven cart
      scenarios including the €99.80 boundary.
- [x] ~~Consent banner and analytics~~ — built 2026-07-29. Google Analytics 4
      behind an explicit statistics consent dialog, with the matching
      Datenschutz section. See [analytics.md](analytics.md). What is left is
      configuration, not development:

      - [x] ~~GA4 property created~~ — 2026-07-29, measurement ID in
            `CREDENTIALS.local.md`. Verified end to end from a local build: a
            real `page_view` reached the property after consent.
      - [ ] `PUBLIC_GA_MEASUREMENT_ID` set in `/srv/peptides/.env` and the
            storefront rebuilt. Until it is, production loads nothing and shows
            no dialog — the correct state, but also the reason no production
            data exists yet.
      - [ ] Google's data-processing terms accepted (the Art. 28 DSGVO
            agreement that Datenschutz §6 refers to).
      - [ ] Data retention chosen (2 or 14 months) and written into
            Datenschutz §8, replacing the `[Platzhalter]` note.
      - [ ] Third-country transfer basis in Datenschutz §6 confirmed by the
            legal review in §4 above.

- [x] ~~Search Console — verify the domain property by DNS TXT~~ — done
      2026-07-29. The record resolves publicly on the apex; token in
      `CREDENTIALS.local.md`, do not delete it. Verification worked while gated
      precisely because DNS is not served by the gated box.

      - [ ] Submit `sitemap.xml` — **unblocked as of 2026-07-29**, now that the
            gate is off and Google no longer gets a 401. Steps in
            [analytics.md](analytics.md).
- [x] ~~IndexNow~~ — built 2026-07-30. The build emits the key file and
      `deploy.sh` pushes the URLs whose HTML changed to Bing, Yandex and the
      other participants after publishing. See [indexnow.md](indexnow.md).
      Runs **on**: `INDEXNOW_KEY` is configured in `/srv/peptides/.env`.

      - [x] ~~Decide whether to switch it on~~ — enabled. The site is public and
            crawlable since 2026-07-29, so Bing would index it regardless;
            IndexNow only decides whether that takes minutes or weeks. Note this
            was switched on while purity values are still fabricated and the
            legal pages still say `[Platzhalter]`.
      - [x] ~~Switch it on~~ — `INDEXNOW_KEY` set in `/srv/peptides/.env`. The
            2026-08-06 deploy submitted 38 URLs.
      - Submissions are sourced from the generated sitemaps, so a route the
        sitemaps withhold is never submitted. `/coa-pruefen/` is excluded while
        it has no valid linked document — the same predicate that keeps it
        `noindex, follow` keeps it out of IndexNow, which is the intended
        behaviour and not a gap to fix.
- [x] ~~Deployment~~ — done 2026-07-28. Hetzner VPS, no Docker: Postgres, Redis,
      Node and Caddy from apt, Medusa as a systemd service. DNS from Hostinger,
      TLS via Let's Encrypt. See [deploy.md](deploy.md).

- [x] ~~Un-gate the storefront~~ — done 2026-07-29 by explicit decision, with
      §1–§6 still open. Basic auth and the site-wide `X-Robots-Tag` are gone;
      the site is public and crawlable. See "What is still open" in
      [deploy.md](deploy.md) for the resulting exposures and how to re-gate.
- [ ] Automated database backups. None exist; `pg_dump` is manual today. Must be
      in place before real orders arrive.
- [ ] Monitoring / uptime alerting. Nothing currently reports that the box is
      down.

## 8. Unsupported public claims — removed 2026-08-01

Three statements on public pages asserted facts nothing in this repository
supports. All three are **removed**; what remains is the underlying decision,
which is tracked in the sections above.

- [x] ~~**`llms.txt` asserted VAT treatment.**~~ Removed 2026-08-01. It told
      language models "Alle Preise in EUR inkl. deutscher Umsatzsteuer" while
      AGB § 4 carried a `[Platzhalter]`. It now states the currency only —
      **not** replaced with a net or gross claim, because §3 is still open. The
      AGB placeholder stays until §3 is decided, and then both change together.
- [x] ~~**The homepage promised a delivery time.**~~ Removed 2026-08-01. It
      stated "Zustellung in 1–3 Werktagen nach Zahlungseingang" with no carrier
      contracted (§2) and no dispatch SLA. Replaced with "Informationen zu
      Versand und Lieferzeit werden vor Aktivierung des Bestellvorgangs
      veröffentlicht." No new number was invented; AGB § 6 keeps `[Anzahl]`.
- [x] ~~**`ORDERS_CLOSED_TEXT` stated a business status.**~~ Removed
      2026-08-01. "Der Shop wird gerade eingerichtet" read a business status out
      of a boolean that carries none. The shared copy now says only that
      ordering is unavailable. `ORDERS_CLOSED_CONTACT` was corrected in the same
      pass: it pointed customers at a "Kontaktformular" that does not exist.

`src/lib/operational-claims.test.ts` scans every source file and every built
page and text route for these claims and their paraphrases, so none can return
while the questions above are open. **Answering §3 or contracting a carrier
means updating that test's allow-list deliberately — not deleting it.**

Still open from the same pass: `datenschutz.astro` names Hetzner Online GmbH as
the hosting processor but keeps a `[Platzhalter]` for the full address, because
the address recorded in [launch-data-needed.md](launch-data-needed.md) names a
town that looks wrong. Confirm it against Hetzner's own Impressum and conclude
the Art. 28 AVV before that page loses its `draft` flag.

---

## When an item lands

1. Make the change (usually `.env` or page content).
2. Remove the `draft` prop from any legal page that is now final.
3. Run the gates: `cd storefront && npm run typecheck && npm run build`.
4. Tick the box here and commit.
