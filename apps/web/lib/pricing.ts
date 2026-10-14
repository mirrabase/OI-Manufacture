export const defaultPricing = {
  materialPerKg: 150_000,
  machinePerHour: 15_000,
  setup: 10_000,
  markupPercent: 30,
  minimumTotal: 25_000,
  layerHeight: 0.2,
  infillPercent: 15,
}

export type Pricing = typeof defaultPricing

export function validatePricing(value: Pricing) {
  if (!value || Object.keys(value).length !== Object.keys(defaultPricing).length
    || ![value.materialPerKg, value.machinePerHour, value.setup, value.minimumTotal].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 10_000_000)
    || !Number.isFinite(value.markupPercent) || value.markupPercent < 0 || value.markupPercent > 500
    || !Number.isFinite(value.layerHeight) || value.layerHeight < 0.08 || value.layerHeight > 0.32
    || !Number.isFinite(value.infillPercent) || value.infillPercent < 0 || value.infillPercent > 100) {
    throw new Error("Invalid pricing. Rates must be 0–10,000,000 IDR, markup 0–500%, layer height 0.08–0.32 mm, and infill 0–100%.")
  }
}

export function calculateEstimate(grams: number, seconds: number, quantity: number, pricing: Pricing) {
  validatePricing(pricing)
  if (![grams, seconds].every((n) => Number.isFinite(n) && n > 0)
    || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100_000) throw new Error("Invalid slicing measurements or quantity.")
  const materialCost = grams / 1000 * pricing.materialPerKg * quantity
  const machineCost = seconds / 3600 * pricing.machinePerHour * quantity
  const subtotal = materialCost + machineCost + pricing.setup
  const markup = subtotal * pricing.markupPercent / 100
  const total = Math.ceil(Math.max(pricing.minimumTotal, subtotal + markup) / 1000) * 1000
  if (!Number.isSafeInteger(total)) throw new Error("Estimate exceeds the supported amount.")
  return { materialCost, machineCost, setupCost: pricing.setup, markup, total }
}
