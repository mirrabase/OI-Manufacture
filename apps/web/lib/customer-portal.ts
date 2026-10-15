import type { Pricing } from "./pricing"

export type PrintEstimate = {
  status: "processing" | "ready" | "failed" | "unsupported"
  requestedAt: number
  calculatedAt?: number
  error?: string
  gramsPerUnit?: number
  secondsPerUnit?: number
  total?: number
  materialCost?: number
  machineCost?: number
  setupCost?: number
  markup?: number
  pricing?: Pricing
  profile?: string
  gcodePath?: string
}

export type ManufacturingRequirements = {
  quantity: number
  material: string
  process: string
  unit: "mm" | "inch"
  notes: string
}

export type UploadedModelMetadata = {
  name: string
  size: number
  contentType: string
  storagePath: string
  boundingBoxMm: [number, number, number]
  volumeCm3?: number
}

export type CustomerRFQ = {
  ownerUid: string
  customer: { name: string; email: string }
  product: string
  requirements: ManufacturingRequirements
  model: UploadedModelMetadata
  status: "Draft" | "Submitted" | "Under Review" | "Quoted" | "Preparing Production" | "In Production" | "Completed" | "Closed"
  quoteTotal?: number
  paymentStatus?: "Unpaid" | "Paid"
  activeKaseraPaymentAttemptId?: string
  kaseraPaymentRequestId?: string
  paymentReviewRequired?: boolean
  paymentReviewReason?: string
  createdAt: number
  submittedAt?: number
  quotedAt?: number
  paidAt?: number
  productionStartedAt?: number
  completedAt?: number
  estimate?: PrintEstimate
  estimateRequestedAt?: number
}

export const formatIDR = (amount: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount)
