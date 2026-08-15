import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { referenceForDisplayId } from "../lib/bank-reference"
import { requireSendingEnabled } from "../lib/inbox/reply"
// Importing this does not load a mail library: `smtp.ts` imports nodemailer
// lazily inside `createMailSender`, so a backend that never sends never pays
// for one. `reply.ts` likewise takes only types from it.
import { createMailSender } from "../lib/inbox/smtp"
import {
  orderEmailEnabled,
  resolveBankDetails,
  siteUrl,
} from "../lib/order-email/config"
import { renderOrderEmail } from "../lib/order-email/render"

/**
 * Sends the customer the only written record of their order.
 *
 * Payment is bank transfer, so the payment reference otherwise exists **only**
 * on the confirmation page. A customer who closes that tab, or pays later from
 * their banking app the way people normally pay an invoice, has no reference,
 * no IBAN and no amount — they either cannot pay, or pay with a reference we
 * cannot match. See docs/specs/2026-08-15-order-confirmation-email.md.
 *
 * ## Why the reference is derived here rather than read
 *
 * `order.placed` also triggers `order-bank-reference.ts`, which persists the
 * same value. Two subscribers on one event have no guaranteed order, so reading
 * `metadata.bank_reference` here would be a race that usually passes — the worst
 * kind. Both call `referenceForDisplayId`, the same definition the storefront
 * uses, so all three agree by construction and nothing waits for anything.
 *
 * ## Failure posture
 *
 * A send that cannot be made correctly is not made at all, and says why in the
 * log. Nothing here throws: the alternative to a missing email is an email with
 * a placeholder IBAN in it, which a customer would act on.
 */
export default async function orderConfirmationEmailHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  // Checked first, before any store call and before the mail library is
  // imported: with the switch off this subscriber does nothing and costs
  // nothing.
  if (!orderEmailEnabled()) return

  const bank = resolveBankDetails()
  if (!bank.ok) {
    logger.error(
      `Order ${data.id}: not sending a confirmation — bank details incomplete ` +
        `(${bank.missing.join(", ")}). An email instructing a transfer to a ` +
        "placeholder is worse than no email.",
    )
    return
  }

  const orderModule = container.resolve(Modules.ORDER)

  const order = await orderModule.retrieveOrder(data.id, {
    select: [
      "id",
      "display_id",
      "email",
      "currency_code",
      "metadata",
      "total",
      "item_subtotal",
      "discount_total",
      "shipping_total",
    ],
    relations: ["items"],
  })

  const metadata = (order.metadata ?? {}) as Record<string, unknown>
  if (metadata.confirmation_email_sent_at) {
    return // The event was replayed; the customer already has this message.
  }

  if (!order.email) {
    logger.error(`Order ${data.id}: no email address, cannot send confirmation.`)
    return
  }

  if (typeof order.display_id !== "number") {
    logger.error(`Order ${data.id}: no display_id, cannot derive a reference.`)
    return
  }

  let reference: string
  try {
    reference = referenceForDisplayId(order.display_id)
  } catch (error) {
    logger.error(`Order ${data.id}: cannot derive a bank reference — ${error}`)
    return
  }

  const message = renderOrderEmail({
    displayId: order.display_id,
    reference,
    currencyCode: order.currency_code ?? "eur",
    lines: (order.items ?? []).map((item) => ({
      title: item.product_title ?? item.title ?? "Artikel",
      variantTitle: item.variant_title,
      quantity: item.quantity ?? 0,
      total: Number(item.total ?? 0),
    })),
    itemSubtotal: Number(order.item_subtotal ?? 0),
    discountTotal: Number(order.discount_total ?? 0),
    shippingTotal: Number(order.shipping_total ?? 0),
    total: Number(order.total ?? 0),
    bank: bank.details,
    siteUrl: siteUrl(),
  })

  // Reuses the inbox transport, and with it a posture already settled there:
  // TLS verification non-negotiable, no attachments, no HTML, no file or URL
  // access, and no SMTP conversation in the logs.
  let smtp
  try {
    smtp = requireSendingEnabled()
  } catch (error) {
    logger.error(
      `Order ${data.id}: ORDER_EMAIL_ENABLED is set but SMTP is not usable — ${error}`,
    )
    return
  }

  const sender = await createMailSender(smtp)

  try {
    const result = await sender.send({
      to: order.email,
      subject: message.subject,
      text: message.text,
      messageId: `<order-${order.id}@peptideeinkaufen.de>`,
    })

    // Written only after the server accepted it. Marking first would turn a
    // transient SMTP failure into a customer who never gets the message and
    // never will, because the replay is now suppressed.
    //
    // Only this key is passed: Medusa merges a metadata object into the stored
    // record, so `bank_reference` written by the sibling subscriber survives
    // regardless of which of the two lands second.
    await orderModule.updateOrders(order.id, {
      metadata: { confirmation_email_sent_at: new Date().toISOString() },
    })

    logger.info(
      `Order ${order.id}: confirmation sent to ${order.email} ` +
        `(reference ${reference}, ${result.accepted} recipient(s) accepted).`,
    )
  } catch (error) {
    // Left unmarked on purpose, so a redelivery of the event can try again.
    logger.error(`Order ${data.id}: confirmation email failed — ${error}`)
  } finally {
    await sender.close()
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
