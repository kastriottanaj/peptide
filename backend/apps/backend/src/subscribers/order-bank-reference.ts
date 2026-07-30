import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { referenceForDisplayId } from "../lib/bank-reference";

/**
 * Persists the payment reference on the order so the admin and the recovery
 * lookup can see it.
 *
 * This subscriber is not what the customer's confirmation depends on. It runs
 * asynchronously on `order.placed`, so the confirmation page can render before
 * it has written anything — the page therefore derives the same reference from
 * `display_id` itself, using the shared definition in `lib/bank-reference.ts`.
 * Both sides producing one value is the whole point: a customer who quotes a
 * reference we cannot match has paid into a void.
 */
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

  let reference: string;
  try {
    reference = referenceForDisplayId(order.display_id);
  } catch (error) {
    logger.error(`Order ${data.id}: cannot derive a bank reference — ${error}`);
    return;
  }

  await orderModule.updateOrders(data.id, {
    metadata: { ...existing, bank_reference: reference },
  });

  logger.info(`Order ${data.id}: bank reference ${reference}`);
}

export const config: SubscriberConfig = {
  event: "order.placed",
};
