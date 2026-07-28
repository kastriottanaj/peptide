import { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

/**
 * Removes the test orders and abandoned carts left behind by local
 * verification, so the Medusa admin starts clean.
 *
 * Safe by construction: it only ever touches records whose email is on a
 * throwaway domain (@example.de / @example.com / @test.invalid). If it finds
 * anything outside that set it reports and leaves it alone — there is no flag
 * to make it delete a real order.
 *
 * Carts follow the same rule, plus one addition: a cart that has no email at
 * all and has not been touched for a week is an abandoned anonymous session,
 * which cannot belong to a customer who is still shopping.
 *
 * That cutoff is the point. An earlier version deleted every cart without a
 * `completed_at`, which is exactly the set of carts that are still in use — run
 * against a live store it would have emptied the basket of every customer
 * mid-checkout, real email or not, while the docstring above still promised it
 * only touched test data.
 *
 * Run with:  npx medusa exec ./src/scripts/purge-test-orders.ts
 */

const TEST_EMAIL_DOMAINS = ["@example.de", "@example.com", "@test.invalid"];

/** An anonymous cart is only abandoned once it has gone quiet for this long. */
const ABANDONED_AFTER_DAYS = 7;

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

  // --- Test and abandoned carts -----------------------------------------
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: ["id", "email", "completed_at", "updated_at"],
  });

  const abandonedBefore = Date.now() - ABANDONED_AFTER_DAYS * 24 * 60 * 60 * 1000;

  const isStaleAnonymous = (cart: any) => {
    if (cart.email || cart.completed_at) return false;
    const touched = new Date(cart.updated_at ?? 0).getTime();
    return Number.isFinite(touched) && touched < abandonedBefore;
  };

  const removable = carts.filter(
    (cart: any) => isTestEmail(cart.email) || isStaleAnonymous(cart)
  );
  const keptCarts = carts.length - removable.length;

  if (removable.length) {
    await cartModule.deleteCarts(removable.map((c: any) => c.id));
    logger.info(
      `Deleted ${removable.length} cart(s) (test email, or anonymous and idle ` +
        `for over ${ABANDONED_AFTER_DAYS} days), kept ${keptCarts}.`
    );
  } else {
    logger.info("No carts to remove.");
  }

  logger.info(
    "Done. Note: order display_id continues from the highest value ever used — " +
      "the next real order will not be #1."
  );
}
