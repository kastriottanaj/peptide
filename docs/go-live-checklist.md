# Go-Live Checklist

**Status as of 2026-07-26: the business is still being established.**

The shop cannot go live yet, and that is not a technical problem. Company
registration, the business bank account and the legal review are all still in
progress. Everything below is waiting on real-world information that does not
exist yet — the code is in place and each item is a configuration or content
change, not development work.

This file is the single place to look for "what are we still waiting on".
Update it as items land.

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

## 6. Technical items not blocked on the business

These can be done at any time:

- [ ] Shipping rules — still the Medusa starter's flat €10. The €20
      non-Germany rate and free-from-€100 threshold are not configured, so the
      cart's „Versandkostenfrei ✓" hint can over-promise.
- [ ] Order confirmation email — nothing is sent today. Matters here because
      the payment reference exists only on the confirmation page; a customer who
      closes the tab cannot pay correctly.
- [ ] Consent banner and analytics — only once analytics actually exists, and
      the Datenschutz page needs a matching section added at the same time.
- [ ] Deployment — no production deploy exists for this repo yet.

---

## When an item lands

1. Make the change (usually `.env` or page content).
2. Remove the `draft` prop from any legal page that is now final.
3. Run the gates: `cd storefront && npm run typecheck && npm run build`.
4. Tick the box here and commit.
