# Spec — order confirmation email

**Date:** 2026-08-15
**Status:** approved by owner, implemented same day
**Closes:** [go-live-checklist.md](../go-live-checklist.md) §6

## Goal

Send the customer a written record after they order. Today they receive nothing,
and the shop has been taking real money since 2026-08-15.

This matters more here than for a card shop: payment is bank transfer, so the
**payment reference exists only on the confirmation page**. A customer who closes
that tab — or pays later from their banking app, which is how people normally pay
an invoice — has no reference, no IBAN and no amount. They either cannot pay, or
pay with no usable reference and the transfer cannot be matched to an order.

## What already exists

Almost all of it, which is why this is small:

- `nodemailer` is a dependency, and `lib/inbox/smtp.ts` exposes a hardened
  `MailSender` — TLS verification non-negotiable, no attachments, no HTML, no
  file or URL access, no SMTP conversation in the logs.
- `lib/inbox/config.ts` resolves SMTP host, port, user, password and sender.
- The Redis event bus is real in production, so `order.placed` survives a
  restart. `medusa-config.ts` already names this email as the reason.
- `lib/bank-reference.ts` derives the reference from `display_id`.

## Design

| File | Role |
|---|---|
| `lib/order-email/config.ts` | The `ORDER_EMAIL_ENABLED` switch and the bank details, read from env and validated |
| `lib/order-email/render.ts` | Pure: order + bank details → subject and plain-text body. Unit tested |
| `subscribers/order-confirmation-email.ts` | `order.placed` → resolve, render, send, mark |

Five decisions worth stating:

1. **Its own switch, `ORDER_EMAIL_ENABLED`.** Not `INBOX_SMTP_ENABLED`, whose
   own docstring says reading mail and sending mail are different decisions and
   one variable must not enable both. The credentials are shared; the permission
   to email customers is not. Unset is off, only `true` is on.
2. **The reference is derived, never read from the order.** `order.placed` also
   triggers `order-bank-reference.ts`, and two subscribers on one event have no
   guaranteed order — so waiting for it to have written `metadata.bank_reference`
   would be a race. Both sides call `referenceForDisplayId`, which is the same
   definition the confirmation page uses. Three producers, one value.
3. **No bank details, no email.** If `PUBLIC_BANK_*` is unset or still says
   `PLATZHALTER`, the send is refused and logged. An email instructing a customer
   to transfer to a placeholder is worse than no email.
4. **Idempotent by `metadata.confirmation_email_sent_at`.** The event can be
   replayed. Medusa merges a metadata object into the stored record rather than
   replacing it, so this writes only its own key and cannot clobber
   `bank_reference` written by the other subscriber.
5. **Plain text, German, no new claims.** No delivery estimate, no dispatch SLA,
   no response time — the same rule `operational-claims.test.ts` enforces on the
   storefront. It states what was ordered, what to pay, and how to quote it.

## Non-goals

- **No HTML email.** Plain text is what the hardened sender supports, and a
  bank-transfer instruction has nothing to gain from markup.
- **No SPF/DKIM/DMARC changes.** DNS records are configured at Hostinger, not in
  this repository. Still outstanding — without them this mail lands in spam,
  which for this email is the same as not sending it.
- **No shipping or status emails.** One event, one message.
- **No retry queue beyond what the event bus already provides.**

## Verification

```bash
cd backend && npm run lint && npm run build && npm run test
```

Manually:

- With `ORDER_EMAIL_ENABLED` unset, placing an order sends nothing and loads no
  mail library.
- With it set, a test order produces a mail whose reference equals
  `metadata->>'bank_reference'` on the order and whose total matches the order.
- Re-emitting `order.placed` for the same order sends nothing the second time.
