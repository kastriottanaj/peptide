import { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";

/**
 * Replace the fabricated analytical metadata with the real figures.
 *
 * `seed-peptides.ts` seeded every product with `purity: ">99%"`,
 * `coa_status: "verfügbar"`, `demo: "true"` and `data_status: "placeholder"` —
 * invented values, identical across the catalog, with no document behind them.
 * They shipped to paying customers once ordering opened, which made them the
 * largest exposure in the project (docs/go-live-checklist.md §5).
 *
 * The real data comes from the sister shop `peptidebestellung.de`, confirmed by
 * the owner on 2026-08-15 to sell **the same stock** — that confirmation is the
 * whole basis for this script, because analytical data is batch-bound and a
 * purity figure from someone else's lot is no better than an invented one.
 *
 * Three deliberate restrictions, each of which loses coverage on purpose:
 *
 * 1. **A document is attached only where the pack size matches exactly.** The
 *    certificates are per amount (10 mg, 50 mg), and `coa-documents.ts` binds a
 *    document to a *variant* for exactly this reason. So BPC-157 5 mg, TB-500
 *    5 mg, Retatrutide 5/15 mg and GHK-Cu 100 mg get no document — their amount
 *    was not analysed — and the product page renders "nicht hinterlegt".
 * 2. **Semax gets no document at all.** The certificate is for 10 mg; this shop
 *    sells one 30 mg pack. Purity is a property of the lot and is applied, but
 *    nothing here claims a 30 mg vial was measured.
 * 3. **`coa_batch` is left unset.** The source data offers an `orderNumber`,
 *    but order 100014395 covers six different products, so it is a laboratory
 *    order reference and not a lot number. Writing it into a field the
 *    storefront labels "Charge" would be a fabricated identifier — exactly the
 *    defect this script exists to remove. Null renders as "nicht hinterlegt".
 *
 * Idempotent: re-running writes the same values. Safe to run before or after a
 * deploy, but the storefront is static and reads the catalog at build time, so
 * a rebuild is required before any of this is visible.
 *
 * Run with:  npx medusa exec ./src/scripts/apply-real-analytics.ts
 */

/** Analysis date printed on every certificate in this set. */
const ANALYSIS_DATE = "2026-05-11";

/** Where the documents are served from. Must be an allowlisted https origin. */
const DOCUMENT_BASE = "https://peptideeinkaufen.de/coa";

type Analytics = {
  /** Product handle in Medusa. */
  handle: string;
  /** Real HPLC purity for the lot, as printed on the certificate. */
  purity: string;
  /** Variant title (pack size) the certificate actually covers, if any. */
  documentFor: string | null;
  /** Filename under `storefront/public/coa/`. */
  document: string | null;
};

const CATALOG: Analytics[] = [
  {
    handle: "bpc-157",
    purity: "99,43 %",
    documentFor: "10 mg",
    document: "bpc-157-10mg-coa.pdf",
  },
  {
    handle: "ghk-cu",
    purity: "99,2 %",
    documentFor: "50 mg",
    document: "ghk-cu-50mg-coa.pdf",
  },
  {
    handle: "mots-c",
    purity: "99,41 %",
    documentFor: "10 mg",
    document: "mots-c-10mg-coa.pdf",
  },
  {
    handle: "retatrutide",
    purity: "99,44 %",
    documentFor: "10 mg",
    document: "retatrutide-10mg-coa.pdf",
  },
  {
    handle: "tb-500",
    purity: "99,33 %",
    documentFor: "10 mg",
    document: "tb-500-10mg-coa.pdf",
  },
  {
    // 30 mg is the only pack sold here and the certificate is for 10 mg.
    // Same lot, so the purity holds; the document does not cover this amount.
    handle: "semax",
    purity: "99,43 %",
    documentFor: null,
    document: null,
  },
];

export default async function applyRealAnalytics({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "handle", "title", "metadata", "variants.id", "variants.title", "variants.metadata"],
  });

  const byHandle = new Map(products.map((product) => [product.handle, product]));
  let updated = 0;
  let documents = 0;

  for (const entry of CATALOG) {
    const product = byHandle.get(entry.handle);
    if (!product) {
      logger.warn(`No product with handle "${entry.handle}" — skipping.`);
      continue;
    }

    const metadata = { ...((product.metadata ?? {}) as Record<string, unknown>) };

    metadata.purity = entry.purity;
    metadata.coa_analysis_date = ANALYSIS_DATE;

    // Explicit nulls, not `delete`. Medusa **merges** a metadata object into
    // the stored one, so a key left out of the payload survives untouched —
    // the first run of this script set real purity values while `demo: "true"`
    // and `data_status: "placeholder"` stayed behind, claiming the very data
    // beside them was fabricated. Null is what actually removes a key.
    metadata.demo = null;
    metadata.data_status = null;
    // `coa_status` is no longer read by the storefront — the presence of a
    // document is the only claim it makes — but a stale "verfügbar" sitting in
    // the record invites a future reader to trust it.
    metadata.coa_status = null;

    const variants = (product.variants ?? []) as Array<{
      id: string;
      title: string | null;
      metadata: Record<string, unknown> | null;
    }>;

    const variantUpdates = variants.map((variant) => {
      const variantMeta = { ...((variant.metadata ?? {}) as Record<string, unknown>) };
      const matches = entry.documentFor !== null && variant.title === entry.documentFor;

      if (matches && entry.document) {
        variantMeta.coa_document_url = `${DOCUMENT_BASE}/${entry.document}`;
        variantMeta.coa_document_type = "COA (HPLC-UV)";
        variantMeta.coa_analysis_date = ANALYSIS_DATE;
        documents += 1;
      } else {
        // Any pack size the certificate does not cover must carry no document,
        // including on a re-run after the mapping narrows. Null rather than
        // `delete`, for the merge reason above: omitting the key would leave a
        // stale document attached to a variant it no longer covers.
        variantMeta.coa_document_url = null;
        variantMeta.coa_document_type = null;
        variantMeta.coa_analysis_date = null;
      }

      return { id: variant.id, metadata: variantMeta };
    });

    await updateProductsWorkflow(container).run({
      input: {
        products: [{ id: product.id, metadata, variants: variantUpdates }],
      },
    });

    updated += 1;
    logger.info(
      `${product.title}: Reinheit ${entry.purity}` +
        (entry.documentFor ? `, COA an "${entry.documentFor}"` : ", ohne COA-Dokument"),
    );
  }

  logger.info(
    `Done. ${updated} product(s) updated, ${documents} variant(s) carry a document. ` +
      "Rebuild the storefront — it reads the catalog at build time.",
  );
}
