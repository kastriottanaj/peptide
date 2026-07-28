import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

/**
 * Assigns the payment reference the customer types into their banking app,
 * carried over from peptidebestellung.de's `generate_bank_reference()`.
 *
 * The alphabet deliberately omits I, L, O, 0 and 1 — the code is transcribed by
 * hand, and those characters are the ones people get wrong.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LENGTH = 6;
const PREFIX = "PE";

// 31^6 — the number of distinct 6-character codes.
const MODULUS = ALPHABET.length ** LENGTH;
// Coprime to 31, so `displayId -> (displayId * MULTIPLIER + OFFSET) % MODULUS`
// is a bijection: distinct orders can never collide.
const MULTIPLIER = 1103515245;
const OFFSET = 12345;

/**
 * Derives the reference from the order's `display_id`.
 *
 * The template generated a random suffix and re-rolled on collision, which is
 * only safe behind a unique DB constraint — Medusa's order metadata has none,
 * so a random check here would be racy. Deriving it instead makes uniqueness
 * structural, and the bijective mix keeps consecutive orders from producing
 * adjacent-looking codes that would advertise order volume.
 */
function referenceFor(displayId: number): string {
  // BigInt rather than Number: `displayId * MULTIPLIER` crosses 2^53 at around
  // order 8.2 million, and beyond that float rounding destroys the bijection
  // the uniqueness claim above rests on — two orders could share a reference,
  // which for a bank-transfer store means two payments we cannot tell apart.
  const scrambled = Number(
    (BigInt(Math.max(0, Math.floor(displayId))) * BigInt(MULTIPLIER) +
      BigInt(OFFSET)) %
      BigInt(MODULUS)
  );

  let n = scrambled;
  let suffix = "";
  for (let i = 0; i < LENGTH; i++) {
    suffix = ALPHABET[n % ALPHABET.length] + suffix;
    n = Math.floor(n / ALPHABET.length);
  }

  return `${PREFIX}-${suffix}`;
}

export default async function orderBankReferenceHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const orderModule = container.resolve(Modules.ORDER);

  const order = await orderModule.retrieveOrder(data.id, {
    select: ["id", "display_id", "metadata"],
  });

  const existing = (order.metadata ?? {}) as Record<string, unknown>;
  if (typeof existing.bank_reference === "string" && existing.bank_reference) {
    return; // Already assigned — the event was replayed.
  }

  if (typeof order.display_id !== "number") {
    logger.error(`Order ${data.id} has no display_id; cannot build a reference.`);
    return;
  }

  const reference = referenceFor(order.display_id);

  await orderModule.updateOrders(data.id, {
    metadata: { ...existing, bank_reference: reference },
  });

  logger.info(`Order ${data.id}: bank reference ${reference}`);
}

export const config: SubscriberConfig = {
  event: "order.placed",
};
