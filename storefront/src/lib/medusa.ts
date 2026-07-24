import Medusa from "@medusajs/js-sdk"

export const medusa = new Medusa({
  baseUrl: import.meta.env.PUBLIC_MEDUSA_BACKEND_URL,
  publishableKey: import.meta.env.PUBLIC_MEDUSA_PUBLISHABLE_KEY,
})

let cachedRegionId: string | null = null

export async function getDefaultRegionId(): Promise<string> {
  if (cachedRegionId) return cachedRegionId

  const { regions } = await medusa.store.region.list()
  const region = regions[0]
  if (!region) {
    throw new Error("No region configured in Medusa store.")
  }

  cachedRegionId = region.id
  return cachedRegionId
}
