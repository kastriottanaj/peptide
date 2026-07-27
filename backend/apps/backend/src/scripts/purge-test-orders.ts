import { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

/**
 * Removes the test orders and abandoned carts left behind by local
 * verification, so the Medusa admin starts clean.
 *
 * Safe by construction: it only ever touches orders whose email is on a
 * throwaway domain (@example.de / @example.com / @test.invalid). If it finds
 * anything outside that set it reports and leaves it alone — there is no flag
 * to make it delete a real order.
 *
 * Carts are removed when they were never completed, or when they carry a test
 * email. Completing a cart on a real order would normally make it part of that
 * record and off-limits, but a completed cart addressed to a throwaway domain
 * is test data by the same definition as the order it produced — and once that
 * order is gone it is an orphan.
 *
 * Run with:  npx medusa exec ./src/scripts/purge-test-orders.ts
 */

const TEST_EMAIL_DOMAINS = ["@example.de", "@example.com", "@test.invalid"];

const isTestEmail = (email: string | null | undefined) =>
  !!email && TEST_EMAIL_DOMAINS.some((domain) => email.toLowerCase().endsWith(domain));

export default async function purgeTestOrders({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const orderModule = container.resolve(Modules.ORDER);
  const cartModule = container.resolve(Modules.CART);

  // --- Orders -----------------------------------------------------------
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "display_id", "email"],
  });

  const testOrders = orders.filter((order: any) => isTestEmail(order.email));
  const realOrders = orders.filter((order: any) => !isTestEmail(order.email));

  if (realOrders.length) {
    logger.warn(
      `Leaving ${realOrders.length} non-test order(s) untouched: ${realOrders
        .map((o: any) => `#${o.display_id}`)
        .join(", ")}`
    );
  }

  if (testOrders.length) {
    await orderModule.deleteOrders(testOrders.map((o: any) => o.id));
    logger.info(
      `Deleted ${testOrders.length} test order(s): ${testOrders
        .map((o: any) => `#${o.display_id} (${o.email})`)
        .join(", ")}`
    );
  } else {
    logger.info("No test orders found.");
  }

  // --- Abandoned carts --------------------------------------------------
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: ["id", "email", "completed_at"],
  });

  const removable = carts.filter(
    (cart: any) => !cart.completed_at || isTestEmail(cart.email)
  );
  const keptCarts = carts.length - removable.length;

  if (removable.length) {
    await cartModule.deleteCarts(removable.map((c: any) => c.id));
    logger.info(
      `Deleted ${removable.length} cart(s) (abandoned or test), kept ${keptCarts}.`
    );
  } else {
    logger.info("No carts to remove.");
  }

  logger.info(
    "Done. Note: order display_id continues from the highest value ever used — " +
      "the next real order will not be #1."
  );
}
