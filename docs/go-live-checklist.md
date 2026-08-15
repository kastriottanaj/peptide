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

> **The shop is trading as of 2026-08-15, with §2, §3, §4, §5 and §6 open.**
> The site went public on 2026-07-29 and ordering was opened on 2026-08-15, both
> by explicit owner decision ahead of the items below. Nothing here is a
> pre-launch task any more: each one is a **live exposure against real customers
> and real money**, and this file is the record of what was accepted and when.

**Open while trading**, in the order that matters if only one gets fixed:

1. **§5 — every purity value, COA status and price in the catalog is
   fabricated.** This is the only item where the customer is misled about the
   product itself rather than about paperwork, and it is the reason the rest of
   this list exists. Selling research chemicals against invented analytical
   figures is what the repo has called its largest exposure since 2026-07-26.
2. **§6 — no order confirmation email.** A customer who orders receives nothing
   in writing. `/bestellung/suchen` and an explicit "note this down" line on the
   confirmation page are damage control, not a substitute.
3. **§2 — the legal pages are incomplete and unreviewed**: no register number,
   no VAT ID, no Art. 27 DSGVO representative, and a `PMB` address that may not
   be a *ladungsfähige Anschrift*. All four still carry `draft` and `noindex`.
4. ~~**§3 — the B2B/B2C decision is unmade**~~ — decided 2026-08-15: business
   customers only, enforced by a required confirmation at checkout. VAT and the
   Gerichtsstand survive it as separate open questions.
5. **§4 — no lawyer has read any of it.**

§1 is **provisionally cleared**: an interim personal account is configured and
the payee mismatch is explained on the confirmation page. See below.

One mitigation remains:

- ~~**Ordering is closed**~~ — **the shop has been open since 2026-08-15**
  (`ORDERS_ENABLED=true`). It was closed from 2026-07-30 and was reopened by
  explicit owner decision **with §2, §3, §4, §5 and §6 still open**. That was
  the mitigation holding every item below in a dormant state; it is gone, so
  each one is now live against real customers and real money. See
  [checkout.md](checkout.md).
- ~~The four legal pages keep a per-page `noindex`~~ — **removed 2026-08-15 by
  explicit decision.** All four are indexable while still carrying
  `[Platzhalter]` data; the plan is to fill them in in public. They keep the
  `draft` banner ("Noch nicht rechtsverbindlich"), which is now the only thing
  telling a visitor arriving from a search result that the text is not final —
  `deploy.sh` checks `/impressum` for that banner on every deploy. They are
  still absent from the sitemap: indexable is not final.

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
- [ ] **Business bank account opened** — still open, and **the interim account
      stays until it is** (owner's decision, 2026-08-15: fix the payee when the
      business account exists, not before). Three things follow from the interim
      account being personal and foreign, and none of them is cosmetic:
      - the payee is a private individual while the Impressum names an LLC (§2),
        so the name a customer is asked to pay appears nowhere else on the site;
      - the IBAN is Belgian, not German — legitimate for SEPA, but it needs the
        Impressum to explain who is being paid;
      - Wise is named in `datenschutz.astro` as the recipient of the payment
        data, with its company data still `[Platzhalter]` pending §4.

      All three went live with ordering on 2026-08-15. The first is explained on
      the confirmation page; the other two are not.
- [x] ~~`ORDERS_ENABLED=true` in `/srv/peptides/.env`~~ — **the shop is open as
      of 2026-08-15**, by explicit owner decision, with §2, §3, §4, §5 and §6
      still open. Add-to-cart, the checkout form and cart completion are live
      and real customers can transfer real money.
- [ ] Test order against production now that it is open

## 2. Company details — partially filled 2026-08-15

The operator is **a Virginia LLC**, identified from the signed Operating
Agreement. Firmierung, address and representative are configured as
`PUBLIC_COMPANY_*` in `/srv/peptides/.env` and render on `/impressum/` and in
the Datenschutz controller block. All four legal pages still carry the
`[Platzhalter]` markers below, the "not legally binding" banner and `noindex`.

- [x] ~~Firmierung including legal form~~ — set 2026-08-15
- [x] ~~Business address~~ — set 2026-08-15, **but see the mailbox warning in
      [launch-data-needed.md](launch-data-needed.md) §1**: it is a `PMB`
      private mail box, which may not be a *ladungsfähige Anschrift* under
      § 5 DDG
- [x] ~~Managing director / owner name~~ — set 2026-08-15 (Chief Executive
      Member; the second member is deliberately **not** published — § 5 DDG
      wants the authorised representative, and per § 4.4 of the Operating
      Agreement the other members cannot bind the company)
- [x] ~~Email for the Impressum~~ — configured and live
- [x] ~~Phone for the Impressum~~ — set 2026-08-15. Not required by § 5 DDG
      given the email, so this was a choice; note it also publishes on the
      indexable `/contact/` page and in the site-wide `Organization` JSON-LD.
      See [launch-data-needed.md](launch-data-needed.md) §1
- [ ] Register authority and entity number — the Virginia SCC entity ID is not
      in the Operating Agreement
- [ ] USt-IdNr. — **a US seller shipping to German consumers has German VAT
      obligations.** This is not answered by the Kleinunternehmer question in
      §3, which assumes a German seller
- [ ] **Art. 27 DSGVO representative in the Union** — mandatory for a
      controller not established in the EU that offers goods to data subjects
      here. Must be appointed in writing and named in the Datenschutzerklärung,
      which currently says so in a `[Platzhalter]`
- [ ] Competent data-protection supervisory authority — a non-EU controller has
      no German Landesbehörde by company seat; follows from the Art. 27
      representative's seat
- [ ] Hosting provider named, with an Art. 28 DSGVO processing agreement
- [ ] Shipping provider named
- [ ] The Streitbeilegung section still points at the EU ODR platform, which has
      been discontinued. Replacement wording is a legal-review question and is
      marked `[Platzhalter]` on the page

**The payee and the operator disagree — knowingly, decided 2026-08-15.** The
Impressum names the LLC; the bank details in §1 are a private individual's Wise
account, so a customer would be asked to transfer to a name appearing nowhere
else on the site.

**Leave it as it is.** The owner's decision on 2026-08-15 was to keep the
interim account and reconcile the two when the business bank account is opened,
rather than change either side now. Do not "fix" this by editing
`PUBLIC_BANK_ACCOUNT_HOLDER` to the LLC — that would name a payee the account is
not held under, which banks reject and which is worse than the mismatch.

**It is live.** Ordering opened the same day, so customers now see it. It is
mitigated rather than hidden: `payeeDiffersFromCompany()` in `lib/bank.ts`
detects the mismatch and both `/bestellung/` and `/bestellung/suchen/` explain
who the payee is and warn against retyping the company name, which would get the
transfer rejected. The check is derived, not configured, so the explanation
**disappears by itself** the day `PUBLIC_BANK_ACCOUNT_HOLDER` becomes the
business account. Nothing has to remember to remove it.

Pages affected: `impressum.astro`, `datenschutz.astro`, `agb.astro`,
`widerruf.astro`. All four are already indexable (`draft noindex={false}`).
Remove `draft` from the `LegalLayout` props once a page is final — that drops
the banner and, at that point, the page also earns its sitemap entry at
priority 0.2 in `content-index.ts`.

## 3. The B2B / B2C decision — DECIDED 2026-08-15: **business customers only**

Owner decision, following the sister project `peptidebestellung.de`, which is
live with the same position. Design and non-goals:
[specs/2026-08-15-b2b-only.md](specs/2026-08-15-b2b-only.md).

- [x] ~~Decide the customer group~~ — Unternehmer (§ 14 BGB), research
      institutions, laboratories, public bodies and institutional buyers. **No
      contracts with consumers (§ 13 BGB).**
- [x] ~~State it explicitly in AGB § 2~~ — the customer confirms Unternehmer
      status on placing the order
- [x] ~~Replace `widerruf.astro` with a notice that no withdrawal right
      applies~~ — the page is now *Widerruf und Retouren* and carries **zero
      placeholders**
- [x] ~~Required business confirmation at checkout~~ — a separate checkbox in
      `kasse.astro`, not merged into the terms box

**The gate is what makes the text lawful, and the three parts are one change.**
The checkout confirmation, AGB § 2 and `/widerruf/` stand or fall together: put
"kein Verbraucherwiderrufsrecht" on a shop that still accepts consumers and a
consumer who slips through gets roughly twelve months to withdraw instead of
fourteen days (§ 356 Abs. 3 BGB). Never remove one of the three alone.

Two things this decision did **not** settle, contrary to the old table here:

- [ ] **VAT.** B2B removes the PAngV duty to display gross prices — it does not
      say what tax is owed. The seller is a US LLC shipping to German business
      customers, so the Kleinunternehmer question never applied. AGB § 4 keeps a
      placeholder, reworded to ask the right question.
- [ ] **Gerichtsstand.** Now permissible in principle, but only towards
      Kaufleute and public-law bodies (§ 38 ZPO), not every Unternehmer — and
      the venue is unresolved because the provider sits in the United States
      while the AGB choose German law. AGB § 12 keeps a placeholder.

## 4. Legal review

The legal pages are structurally complete scaffolding, not reviewed text. They
were written to the right statutory sections but have not been checked by a
lawyer, and this product category (research chemicals) carries specific risk.

- [ ] All four pages reviewed by a lawyer
- [x] ~~Decide whether the withdrawal right is excluded for sealed vials
      (§ 312g Abs. 2 Nr. 3 BGB)~~ — **moot as of 2026-08-15.** That provision
      carves an exception out of the *consumer* withdrawal right, and §3 removed
      the consumer right entirely. Nothing to exclude. The practical effect it
      would have had is now an ordinary B2B term instead: returns only after
      approval, and only unopened and sealed.
- [x] ~~Who bears the cost of a return~~ — **also moot.** The seller-bears-costs
      line was published on 2026-08-15 and removed the same day with the
      consumer Widerrufsbelehrung. Art. 246a EGBGB governs consumer contracts;
      returns are now discretionary and settled case by case after approval.
- [ ] Check export restrictions per destination country

## 5. Product data

Every purity value, COA status and price in the catalog is fabricated
placeholder data, tagged `metadata.demo`. It must be replaced with real,
lab-verified analytical data before anything is sold.

- [ ] Real analytical data per product
- [ ] Real prices
- [ ] COA documents available
- [ ] `demo` flags removed

## 6. Order confirmation email — BUILT 2026-08-15

Deferred on 2026-07-27, and shipped once the shop began trading. Design:
[specs/2026-08-15-order-confirmation-email.md](specs/2026-08-15-order-confirmation-email.md).

An `order.placed` subscriber sends the customer the order number, the itemised
lines, the totals, the bank details and the payment reference. **One item below
is still open — SPF/DKIM/DMARC — and until it is done the mail may land in
spam, which for this email is close to not sending it.**

Why it is a launch blocker rather than a nice-to-have: payment is bank transfer,
and the payment reference exists **only on the confirmation page**. A customer
who closes that tab — or pays later from their banking app, which is the normal
way people pay an invoice — has no record of the reference, the IBAN, or the
amount. They either cannot pay, or they pay without a usable reference and the
transfer cannot be matched to their order. Both end in a support conversation
and possibly a refund.

What it needs:

- [x] ~~A sending domain and mailbox on `peptideeinkaufen.de`~~ —
      `info@peptideeinkaufen.de`, already used by the support inbox.
- [x] ~~SMTP credentials in the backend `.env`~~ — the existing `INBOX_SMTP_*`
      values. One mailbox, reused.
- [x] ~~A notification provider configured~~ — not a Medusa notification module
      in the end. The subscriber reuses `lib/inbox/smtp.ts`, which is already
      hardened (TLS verification non-negotiable, no attachments, no HTML, no
      file or URL access, no SMTP conversation in the logs). A second transport
      would have been a second thing to get wrong.
- [x] ~~An `order.placed` subscriber~~ — `order-confirmation-email.ts`. Carries
      order number, itemised lines, totals, holder/IBAN/BIC/bank and the
      reference. Refuses to send when the bank details are unset or still
      `PLATZHALTER`: an email instructing a transfer to a placeholder is worse
      than no email.
- [ ] **SPF, DKIM and DMARC records at Hostinger.** The one thing left. Without
      them the mail may be filed as spam.
- [ ] Verified end to end against production: place a test order, receive the
      mail, confirm the reference in it matches `metadata->>'bank_reference'`
      on the order.

The switch is `ORDER_EMAIL_ENABLED`, deliberately **not** `INBOX_SMTP_ENABLED`.
The credentials are one mailbox; the permission to email every customer who
checks out is a separate decision, and that separation is the same one
`INBOX_SMTP_ENABLED` was given its own variable for.

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
