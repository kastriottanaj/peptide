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

**Hard blockers before any live deployment:** real bank details (§1), real
company data on the legal pages (§2), the B2B/B2C decision (§3), and the order
confirmation email (§6). None of them are optional — the shop either cannot take
money or cannot lawfully trade without them.

---

## 1. Bank account — blocks all payments

Payment is direct bank transfer only. Until the account exists, no customer can
pay. Every order confirmation currently shows `PLATZHALTER` and an orange
warning telling the customer **not** to transfer.

Set in `storefront/.env`, then rebuild:

```dotenv
PUBLIC_BANK_ACCOUNT_HOLDER=   # exactly as registered with the bank
PUBLIC_BANK_IBAN=
PUBLIC_BANK_BIC=
PUBLIC_BANK_NAME=
```

No code change needed — see [checkout.md](checkout.md). `.env` is git-ignored;
the IBAN must never be committed.

- [ ] Business bank account opened
- [ ] Four variables set and storefront rebuilt
- [ ] Test order shows real details and no warning

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

      - [ ] GA4 property created, `PUBLIC_GA_MEASUREMENT_ID` set in
            `/srv/peptides/.env`, storefront rebuilt. Until it is set, nothing
            loads and no dialog appears — which is the correct state while gated.
      - [ ] Google's data-processing terms accepted (the Art. 28 DSGVO
            agreement that Datenschutz §6 refers to).
      - [ ] Data retention chosen (2 or 14 months) and written into
            Datenschutz §8, replacing the `[Platzhalter]` note.
      - [ ] Third-country transfer basis in Datenschutz §6 confirmed by the
            legal review in §4 above.

- [ ] Search Console — verify the domain property by DNS TXT in Hostinger
      hPanel. This works **now**, while gated, because DNS is not served by the
      gated box. The sitemap cannot be submitted until the gate is off; both
      steps are in [analytics.md](analytics.md).
- [x] ~~Deployment~~ — done 2026-07-28. Hetzner VPS, no Docker: Postgres, Redis,
      Node and Caddy from apt, Medusa as a systemd service. DNS from Hostinger,
      TLS via Let's Encrypt. See [deploy.md](deploy.md).

      **The storefront is deployed gated** — HTTP basic auth plus
      `X-Robots-Tag: noindex` — precisely because §1–§6 above are still open.
      Nothing is publicly reachable and no one can place an order. Un-gating is
      a deliberate step ("Opening the shop" in `deploy.md`) that must not happen
      until the hard blockers are ticked.
- [ ] Automated database backups. None exist; `pg_dump` is manual today. Must be
      in place before real orders arrive.
- [ ] Monitoring / uptime alerting. Nothing currently reports that the box is
      down.

---

## When an item lands

1. Make the change (usually `.env` or page content).
2. Remove the `draft` prop from any legal page that is now final.
3. Run the gates: `cd storefront && npm run typecheck && npm run build`.
4. Tick the box here and commit.
