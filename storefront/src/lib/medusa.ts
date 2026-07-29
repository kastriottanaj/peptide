import Medusa from "@medusajs/js-sdk"
import type { HttpTypes } from "@medusajs/types"

const medusaBaseUrl =
  import.meta.env.SSR && process.env.MEDUSA_BUILD_SNAPSHOT_REQUIRED === "1"
    ? "http://127.0.0.1:9"
    : import.meta.env.PUBLIC_MEDUSA_BACKEND_URL

export const medusa = new Medusa({
  baseUrl: medusaBaseUrl,
  publishableKey: import.meta.env.PUBLIC_MEDUSA_PUBLISHABLE_KEY,
})

let cachedRegion: HttpTypes.StoreRegion | null = null

async function getDefaultRegion(): Promise<HttpTypes.StoreRegion> {
  if (cachedRegion) return cachedRegion

  if (import.meta.env.SSR) {
    const { snapshotRegions } = await import("./build-catalog")
    const captured = await snapshotRegions()
    if (captured) {
      const region = captured[0]
      if (!region) throw new Error("No region configured in build catalog snapshot.")
      cachedRegion = region
      return cachedRegion
    }
  }

  const { regions } = await medusa.store.region.list()
  const region = regions[0]
  if (!region) {
    throw new Error("No region configured in Medusa store.")
  }

  cachedRegion = region
  return cachedRegion
}

export async function getDefaultRegionId(): Promise<string> {
  return (await getDefaultRegion()).id
}

export type DeliveryCountry = { code: string; label: string }

/**
 * Countries the store can actually accept an order for.
 *
 * This has to come from the region rather than a hand-kept list: Medusa refuses
 * a cart whose shipping country is outside it ("Country with code at is not
 * within region Europe"), and that refusal only surfaces on submit — after the
 * customer has filled in the entire checkout form. Deriving the list makes an
 * unshippable country unselectable instead of a dead end.
 *
 * Labels come from `Intl.DisplayNames`, not from the API: `display_name` is
 * English ("Germany") and the storefront is German throughout.
 */
export async function listDeliveryCountries(): Promise<DeliveryCountry[]> {
  const region = await getDefaultRegion()
  const german = new Intl.DisplayNames(["de"], { type: "region" })

  const labelFor = (code: string, fallback?: string | null): string => {
    try {
      return german.of(code.toUpperCase()) ?? fallback ?? code.toUpperCase()
    } catch {
      return fallback ?? code.toUpperCase()
    }
  }

  return (region.countries ?? [])
    .map((country) => {
      const code = (country.iso_2 ?? "").toLowerCase()
      return { code, label: labelFor(code, country.display_name) }
    })
    .filter((country) => country.code)
    .sort((a, b) => {
      // Germany is the primary market, so it leads the list and is the default.
      if (a.code === "de") return -1
      if (b.code === "de") return 1
      return a.label.localeCompare(b.label, "de")
    })
}
