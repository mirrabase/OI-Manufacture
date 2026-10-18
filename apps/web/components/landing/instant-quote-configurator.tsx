"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { onAuthStateChanged, signInAnonymously, type User } from "firebase/auth"
import { httpsCallable } from "firebase/functions"
import {
  ArrowRightIcon,
  BoxIcon,
  CheckCircle2Icon,
  ClockIcon,
  DownloadIcon,
  FileTextIcon,
  FileUpIcon,
  HelpCircleIcon,
  LayersIcon,
  Loader2Icon,
  ReceiptIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TruckIcon,
  UploadCloudIcon,
  ZapIcon,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { cn } from "@workspace/ui/lib/utils"
import { auth, functions } from "@/lib/firebase/client"
import {
  downloadModel,
  listenToCustomerRequest,
  submitCustomerRequest,
} from "@/lib/firebase/customer-requests"
import {
  formatIDR,
  type CustomerRFQ,
  type ManufacturingRequirements,
  type ShippingAddress,
  type ShippingDestination,
  type ShippingDestinationOption,
  type ShippingRate,
  type UploadedModelMetadata,
} from "@/lib/customer-portal"
import { readCustomerProfile, saveCustomerProfile } from "@/lib/customer-profile"
import { DEMO_ORGANIZATION_ID } from "@/lib/organization"
import { QuoteShippingPanel } from "@/components/customer/quote-shipping-panel"

const DedicatedModelViewer = dynamic(() => import("./dedicated-model-viewer"), {
  ssr: false,
  loading: () => (
    <div className="grid h-[340px] place-items-center rounded-xl border border-dashed bg-muted/30 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <Loader2Icon className="size-4 animate-spin text-primary" />
        Memuat 3D Viewport Engine…
      </div>
    </div>
  ),
})

const MAX_FILE_SIZE = 50 * 1024 * 1024

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function totalDue(rfq: CustomerRFQ) {
  return (rfq.quoteTotal ?? 0) + (rfq.shipping?.selection?.cost ?? 0)
}

const COLOR_HEX_MAP: Record<string, string> = {
  Black: "#27272a",
  White: "#f1f5f9",
  Grey: "#64748b",
  Orange: "#f97316",
  Blue: "#2563eb",
}

const MATERIAL_DENSITY: Record<string, number> = {
  PLA: 1.24,
  PETG: 1.27,
  ABS: 1.04,
  TPU: 1.21,
  "Tough Resin": 1.15,
}

const MATERIAL_RATES: Record<string, number> = {
  PLA: 150_000,
  PETG: 180_000,
  ABS: 200_000,
  TPU: 260_000,
  "Tough Resin": 480_000,
}

const PROCESS_HOURLY_RATES: Record<string, number> = {
  FDM: 15_000,
  SLA: 35_000,
  SLS: 60_000,
}

const PROCESS_SETUP_FEES: Record<string, number> = {
  FDM: 10_000,
  SLA: 20_000,
  SLS: 35_000,
}

export function InstantQuoteConfigurator() {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [authError, setAuthError] = useState("")

  // URL Query Params state (e.g. ?orderId=RFQ-xxx&payment=return)
  const [orderIdParam, setOrderIdParam] = useState<string | null>(null)
  const [paymentReturned, setPaymentReturned] = useState(false)
  const [trackedOrder, setTrackedOrder] = useState<(CustomerRFQ & { id: string }) | null>(null)
  const [loadingTrackedOrder, setLoadingTrackedOrder] = useState(false)

  // Local file & Client-side Parser state
  const [file, setFile] = useState<File | null>(null)
  const [geometry, setGeometry] = useState<import("three").BufferGeometry | null>(null)
  const [model, setModel] = useState<UploadedModelMetadata | null>(null)
  const [unit, setUnit] = useState<"mm" | "inch">("mm")
  const [rawDimensions, setRawDimensions] = useState<[number, number, number] | null>(null)
  const [rawVolume, setRawVolume] = useState<number | undefined>()
  const [triangleCount, setTriangleCount] = useState<number>(0)
  const [isParsing, setIsParsing] = useState(false)

  // Layer-by-layer slider preview state
  const [currentLayer, setCurrentLayer] = useState<number>(0)

  // Form & Configurator State
  const [product, setProduct] = useState("")
  const [contactName, setContactName] = useState("")
  const [contactEmail, setContactEmail] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [processType, setProcessType] = useState("FDM")
  const [material, setMaterial] = useState("PLA")
  const [color, setColor] = useState("Black")
  const [infill, setInfill] = useState("20%")
  const [notes, setNotes] = useState("")
  const [shippingDestination, setShippingDestination] = useState<ShippingDestination | null>(null)
  const [shippingDestinationSearch, setShippingDestinationSearch] = useState("")
  const [shippingDestinations, setShippingDestinations] = useState<ShippingDestinationOption[]>([])
  const [searchingShippingDestinations, setSearchingShippingDestinations] = useState(false)
  const [shippingPhone, setShippingPhone] = useState("")
  const [shippingAddressLine, setShippingAddressLine] = useState("")
  const [shippingPostalCode, setShippingPostalCode] = useState("")
  const [shippingAddressError, setShippingAddressError] = useState("")
  const [shippingAddressSaved, setShippingAddressSaved] = useState(false)
  const [savingShippingAddress, setSavingShippingAddress] = useState(false)
  const [shippingPreviewRates, setShippingPreviewRates] = useState<ShippingRate[]>([])
  const [selectedShippingPreviewRate, setSelectedShippingPreviewRate] = useState<ShippingRate | null>(null)
  const [loadingShippingPreview, setLoadingShippingPreview] = useState(false)
  const [shippingPreviewError, setShippingPreviewError] = useState("")
  const [shippingPreviewRevision, setShippingPreviewRevision] = useState(0)
  const [profileLoadedUid, setProfileLoadedUid] = useState("")
  const [productionLeadTimeDays, setProductionLeadTimeDays] = useState<number | null>(null)
  const [loadingProductionLeadTime, setLoadingProductionLeadTime] = useState(false)

  // Submission & Slicing State
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState("")
  const [submittedRfqId, setSubmittedRfqId] = useState<string | null>(null)
  const [liveRfq, setLiveRfq] = useState<(CustomerRFQ & { id: string }) | null>(null)
  const [isPaying, setIsPaying] = useState(false)
  const [paymentError, setPaymentError] = useState("")
  const [isDownloading, setIsDownloading] = useState(false)

  // Auth Initialization
  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      if (nextUser) {
        setUser(nextUser)
        setAuthReady(true)
        return
      }
      void signInAnonymously(auth)
        .catch((err) => {
          setAuthError(err instanceof Error ? err.message : "Gagal menginisialisasi sesi guest.")
          setAuthReady(true)
        })
    })
  }, [])

  useEffect(() => {
    if (!user || profileLoadedUid === user.uid) return
    const profile = readCustomerProfile(user.uid)
    if (profile) {
      setContactName(profile.name ?? profile.shipping?.recipientName ?? "")
      setContactEmail(profile.email ?? "")
      if (profile.shipping) {
        setShippingPhone(profile.shipping.phone)
        setShippingAddressLine(profile.shipping.addressLine)
        setShippingPostalCode(profile.shipping.postalCode)
        setShippingDestination(profile.shipping.destination)
        setShippingDestinationSearch(profile.shipping.destination.label)
      }
    }
    setProfileLoadedUid(user.uid)
  }, [user, profileLoadedUid])

  // Check URL parameters on mount
  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    setPaymentReturned(params.get("payment") === "return")
    const id = params.get("orderId") || params.get("rfqId") || params.get("id")
    if (id) {
      setOrderIdParam(id)
    }
  }, [])

  // Listen to order if orderIdParam is present
  useEffect(() => {
    if (!orderIdParam) return
    setLoadingTrackedOrder(true)
    const unsubscribe = listenToCustomerRequest(
      orderIdParam,
      (row) => {
        setTrackedOrder(row)
        setLoadingTrackedOrder(false)
      },
      () => {
        setLoadingTrackedOrder(false)
      }
    )
    return () => unsubscribe()
  }, [orderIdParam])

  // Real-time listener for submitted RFQ
  useEffect(() => {
    if (!submittedRfqId) return
    const unsubscribe = listenToCustomerRequest(
      submittedRfqId,
      (row) => {
        setLiveRfq(row)
      },
      (err) => {
        setSubmitError(`Gagal membaca update kuotasi: ${err.message}`)
      }
    )
    return () => unsubscribe()
  }, [submittedRfqId])

  useEffect(() => {
    if (orderIdParam || !submittedRfqId || liveRfq?.paymentStatus !== "Paid") return
    setTrackedOrder(liveRfq)
    setOrderIdParam(liveRfq.id)
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", `/?orderId=${encodeURIComponent(liveRfq.id)}&payment=return`)
      setPaymentReturned(true)
    }
  }, [orderIdParam, submittedRfqId, liveRfq])

  useEffect(() => {
    if (shippingDestination?.label === shippingDestinationSearch) {
      setShippingDestinations([])
      setSearchingShippingDestinations(false)
      return
    }
    if (shippingDestinationSearch.trim().length < 2) {
      setShippingDestinations([])
      setSearchingShippingDestinations(false)
      return
    }
    let active = true
    const timer = window.setTimeout(async () => {
      setSearchingShippingDestinations(true)
      setShippingAddressError("")
      try {
        const searchLocations = httpsCallable<
          { scope: "auto"; search: string },
          { destinations: ShippingDestinationOption[] }
        >(functions, "searchShippingLocations")
        const result = await searchLocations({ scope: "auto", search: shippingDestinationSearch.trim() })
        if (active) setShippingDestinations(result.data.destinations)
      } catch (cause) {
        if (active) setShippingAddressError(cause instanceof Error ? cause.message : "Could not search delivery locations.")
      } finally {
        if (active) setSearchingShippingDestinations(false)
      }
    }, 350)
    return () => { active = false; window.clearTimeout(timer) }
  }, [shippingDestinationSearch, shippingDestination])

  // Recalculate dimensions & volume when unit changes
  useEffect(() => {
    if (!rawDimensions || !model) return
    const scale = unit === "mm" ? 1 : 25.4
    setModel((current) =>
      current
        ? {
            ...current,
            boundingBoxMm: rawDimensions.map((v) => v * scale) as [number, number, number],
            ...(rawVolume === undefined ? {} : { volumeCm3: rawVolume * scale ** 3 }),
          }
        : null
    )
  }, [unit, rawDimensions, rawVolume])

  // Total layers calculation (e.g. 0.2 mm layer height)
  const totalLayers = useMemo(() => {
    if (!model) return 1
    const heightMm = model.boundingBoxMm[1] || model.boundingBoxMm[2] || 20
    return Math.max(1, Math.ceil(heightMm / 0.2))
  }, [model])

  // Client-side parser holding the file locally in memory
  async function handleFileSelected(chosenFile: File | undefined) {
    setSubmitError("")
    setGeometry(null)
    setModel(null)
    setFile(null)
    setSubmittedRfqId(null)
    setLiveRfq(null)

    if (!chosenFile) return
    if (!chosenFile.name.toLowerCase().endsWith(".stl")) {
      setSubmitError("Silakan pilih file berformat .STL.")
      return
    }
    if (chosenFile.size > MAX_FILE_SIZE) {
      setSubmitError("Ukuran file STL maksimal 50 MB.")
      return
    }

    setIsParsing(true)
    try {
      const buffer = await chosenFile.arrayBuffer()
      const [{ STLLoader }] = await Promise.all([
        import("three/examples/jsm/loaders/STLLoader.js"),
      ])
      const parsed = new STLLoader().parse(buffer)

      const positions = parsed.getAttribute("position")
      if (!positions || positions.count < 9 || positions.count % 3 !== 0) {
        throw new Error("Mesh STL tidak memiliki segitiga valid.")
      }

      parsed.computeBoundingBox()
      if (!parsed.boundingBox) throw new Error("Gagal membaca dimensi model 3D.")

      const dims = [
        parsed.boundingBox.max.x - parsed.boundingBox.min.x,
        parsed.boundingBox.max.y - parsed.boundingBox.min.y,
        parsed.boundingBox.max.z - parsed.boundingBox.min.z,
      ] as [number, number, number]

      if (!dims.every(Number.isFinite) || dims.some((v) => v <= 0)) {
        throw new Error("Dimensi model STL tidak valid.")
      }

      setTriangleCount(positions.count / 3)

      const checkClosed = positions.count <= 600_000
      const edges = new Map<string, number>()
      let signedVolume = 0
      const point = (idx: number) =>
        [positions.getX(idx), positions.getY(idx), positions.getZ(idx)] as const
      const key = (p: readonly number[]) => p.map((v) => v.toFixed(5)).join(",")
      const edge = (a: readonly number[], b: readonly number[]) => {
        const k1 = key(a)
        const k2 = key(b)
        const id = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`
        edges.set(id, (edges.get(id) ?? 0) + 1)
      }

      for (let i = 0; i < positions.count; i += 3) {
        const a = point(i)
        const b = point(i + 1)
        const c = point(i + 2)
        signedVolume +=
          (a[0] * (b[1] * c[2] - b[2] * c[1]) +
            a[1] * (b[2] * c[0] - b[0] * c[2]) +
            a[2] * (b[0] * c[1] - b[1] * c[0])) /
          6
        if (checkClosed) {
          edge(a, b)
          edge(b, c)
          edge(c, a)
        }
      }

      const volumeCm3 =
        checkClosed &&
        [...edges.values()].every((count) => count === 2) &&
        Math.abs(signedVolume) > 1e-8
          ? Math.abs(signedVolume) / 1000
          : undefined

      const unitScale = unit === "mm" ? 1 : 25.4
      const calculatedHeight = dims[1] * unitScale
      const layers = Math.max(1, Math.ceil(calculatedHeight / 0.2))

      setGeometry(parsed)
      setFile(chosenFile)
      setRawDimensions(dims)
      setRawVolume(volumeCm3)
      setProduct(chosenFile.name.replace(/\.stl$/i, ""))
      setCurrentLayer(layers - 1)
      setModel({
        name: chosenFile.name,
        size: chosenFile.size,
        contentType: "model/stl",
        storagePath: "",
        boundingBoxMm: dims.map((v) => v * unitScale) as [number, number, number],
        ...(volumeCm3 === undefined ? {} : { volumeCm3: volumeCm3 * unitScale ** 3 }),
      })
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Gagal memproses file STL ini.")
    } finally {
      setIsParsing(false)
    }
  }

  // Reset submitted quote when ANY field changes on the left so recalculation is always fresh!
  function handleParamChange<T>(setter: (val: T) => void, val: T) {
    setter(val)
    if (submittedRfqId) {
      setSubmittedRfqId(null)
      setLiveRfq(null)
    }
  }

  // Real-time Professional Quotation & Pricing Recalculation Engine
  const quotation = useMemo(() => {
    if (!model) return null

    const qty = Math.max(1, parseInt(quantity, 10) || 1)
    const infillPercent = parseInt(infill, 10) || 20
    const density = MATERIAL_DENSITY[material] || 1.24
    const materialPerKg = MATERIAL_RATES[material] || 150_000
    const hourlyRate = PROCESS_HOURLY_RATES[processType] || 15_000
    const setupFee = PROCESS_SETUP_FEES[processType] || 10_000

    // Infill factor: 20% shell + 80% interior * infill
    const infillFactor = processType === "FDM" ? 0.2 + 0.8 * (infillPercent / 100) : 0.85
    const volumeCm3 = model.volumeCm3 || 25
    const unitGrams = Math.max(1, Math.round(volumeCm3 * density * infillFactor * 10) / 10)
    const totalGrams = unitGrams * qty

    // Print time: ~20g per hour for FDM
    const hoursPerUnit = Math.max(0.3, unitGrams / 20)
    const totalHours = Math.round(hoursPerUnit * qty * 10) / 10

    // Cost Breakdown
    const materialCost = Math.round((totalGrams / 1000) * materialPerKg)
    const machineCost = Math.round(totalHours * hourlyRate)
    const subtotal = materialCost + machineCost + setupFee
    const markup = Math.round(subtotal * 0.3)
    const total = Math.ceil(Math.max(25_000, subtotal + markup) / 1000) * 1000

    return {
      qty,
      infillPercent,
      density,
      materialPerKg,
      unitGrams,
      totalGrams,
      totalHours,
      materialCost,
      machineCost,
      setupFee,
      markup,
      total,
    }
  }, [model, material, infill, quantity, processType])

  useEffect(() => {
    if (!user || !model || !quotation || submittedRfqId) {
      setProductionLeadTimeDays(null)
      setLoadingProductionLeadTime(false)
      return
    }
    let active = true
    const timer = window.setTimeout(async () => {
      setLoadingProductionLeadTime(true)
      try {
        const estimate = httpsCallable<{
          organizationId: string
          materialName: string
          process: string
          dimensionsMm: [number, number, number]
          plannedHours: number
        }, { leadTimeDays: number | null }>(functions, "getCustomerProductionLeadTime")
        const result = await estimate({
          organizationId: DEMO_ORGANIZATION_ID,
          materialName: material,
          process: processType,
          dimensionsMm: model.boundingBoxMm,
          plannedHours: quotation.totalHours,
        })
        if (active) setProductionLeadTimeDays(result.data.leadTimeDays)
      } catch {
        if (active) setProductionLeadTimeDays(null)
      } finally {
        if (active) setLoadingProductionLeadTime(false)
      }
    }, 300)
    return () => { active = false; window.clearTimeout(timer) }
  }, [user, model, quotation, submittedRfqId, material, processType])

  useEffect(() => {
    if (submittedRfqId || !user || !file || !model || !quotation || !shippingDestination) {
      setShippingPreviewRates([])
      setLoadingShippingPreview(false)
      if (!submittedRfqId) setSelectedShippingPreviewRate(null)
      if (!shippingDestination) setShippingPreviewError("")
      return
    }
    const weightGrams = Math.ceil(quotation.unitGrams * quotation.qty)
    if (!Number.isSafeInteger(weightGrams) || weightGrams < 1) {
      setShippingPreviewRates([])
      setSelectedShippingPreviewRate(null)
      setLoadingShippingPreview(false)
      setShippingPreviewError("Jumlah pesanan terlalu besar untuk menghitung estimasi ongkir.")
      return
    }
    let active = true
    setLoadingShippingPreview(true)
    setShippingPreviewError("")
    setShippingPreviewRates([])
    setSelectedShippingPreviewRate(null)
    const timer = window.setTimeout(async () => {
      try {
        const previewShippingRates = httpsCallable<
          { organizationId: string; destination: ShippingDestination; weightGrams: number; dimensionsMm: number[] },
          { rates: ShippingRate[] }
        >(functions, "getCustomerShippingRatePreview")
        const result = await previewShippingRates({
          organizationId: DEMO_ORGANIZATION_ID,
          destination: shippingDestination,
          weightGrams,
          dimensionsMm: model.boundingBoxMm,
        })
        if (active) setShippingPreviewRates(result.data.rates)
      } catch (cause) {
        if (active) setShippingPreviewError(cause instanceof Error ? cause.message : "Ongkir belum bisa dihitung.")
      } finally {
        if (active) setLoadingShippingPreview(false)
      }
    }, 350)
    return () => { active = false; window.clearTimeout(timer) }
  }, [file, model, quotation, shippingDestination, shippingPreviewRevision, submittedRfqId, user])

  // Submit and upload to Firebase
  async function handleSubmitOrder() {
    if (!user) {
      setSubmitError("Sesi guest belum siap. Muat ulang halaman dan coba lagi.")
      return
    }
    if (!file || !model) {
      setSubmitError("Pilih file STL terlebih dahulu.")
      return
    }
    if (!contactName.trim() || !contactEmail.trim() || !/^\S+@\S+\.\S+$/.test(contactEmail.trim())) {
      setSubmitError("Isi nama dan alamat email yang valid untuk menerima quotation.")
      return
    }
    if (!shippingDestination || !contactName.trim() || !shippingPhone.trim() || !shippingAddressLine.trim() || !shippingPostalCode.trim()) {
      setShippingAddressError("Lengkapi nomor telepon, alamat, kode pos, dan pilih lokasi pengiriman.")
      return
    }
    setShippingAddressError("")
    const qty = parseInt(quantity, 10)
    if (!Number.isInteger(qty) || qty < 1) {
      setSubmitError("Jumlah pesanan minimal 1 unit.")
      return
    }

    setIsSubmitting(true)
    setSubmitError("")
    const id = `RFQ-${crypto.randomUUID()}`
    const storagePath = `rfqs/${user.uid}/${id}/${file.name}`
    const draft: CustomerRFQ = {
      organizationId: DEMO_ORGANIZATION_ID,
      ownerUid: user.uid,
      customer: { name: contactName.trim(), email: contactEmail.trim() },
      product: product.trim() || file.name,
      requirements: {
        quantity: qty,
        material,
        color,
        infillPercent: Number.parseInt(infill, 10),
        process: processType,
        unit,
        notes: notes.trim(),
      } satisfies ManufacturingRequirements,
      model: { ...model, storagePath },
      shipping: {
        address: {
          recipientName: contactName.trim(),
          phone: shippingPhone.trim(),
          addressLine: shippingAddressLine.trim(),
          postalCode: shippingPostalCode.trim(),
          destination: shippingDestination,
        } satisfies ShippingAddress,
      },
      status: "Draft",
      paymentStatus: "Unpaid",
      createdAt: Date.now(),
    }

    saveCustomerProfile(user.uid, {
      name: contactName.trim(),
      email: contactEmail.trim(),
      shipping: draft.shipping?.address,
    })

    try {
      await submitCustomerRequest(id, file, draft)
      setSubmittedRfqId(id)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Gagal mengunggah model ke server.")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSaveShippingAddress() {
    if (!user || !submittedRfqId) return
    if (!shippingDestination || !contactName.trim() || !shippingPhone.trim() || !shippingAddressLine.trim() || !shippingPostalCode.trim()) {
      setShippingAddressError("Lengkapi nama, nomor telepon, alamat, kode pos, dan pilih lokasi pengiriman.")
      return
    }

    const address: ShippingAddress = {
      recipientName: contactName.trim(),
      phone: shippingPhone.trim(),
      addressLine: shippingAddressLine.trim(),
      postalCode: shippingPostalCode.trim(),
      destination: shippingDestination,
    }
    setSavingShippingAddress(true)
    setShippingAddressError("")
    setShippingAddressSaved(false)
    try {
      const saveAddress = httpsCallable<{ rfqId: string; address: ShippingAddress }, { ok: boolean }>(functions, "saveCustomerShippingAddress")
      await saveAddress({ rfqId: submittedRfqId, address })
      saveCustomerProfile(user.uid, { name: contactName.trim(), email: contactEmail.trim(), shipping: address })
      setShippingAddressSaved(true)
    } catch (cause) {
      setShippingAddressError(cause instanceof Error ? cause.message : "Alamat pengiriman belum bisa disimpan.")
    } finally {
      setSavingShippingAddress(false)
    }
  }

  // Pay with Kasera
  async function handlePayWithKasera(rfq: CustomerRFQ & { id: string }) {
    setIsPaying(true)
    setPaymentError("")
    try {
      const returnUrl = new URL(window.location.origin)
      returnUrl.searchParams.set("orderId", rfq.id)
      returnUrl.searchParams.set("payment", "return")

      const createCheckout = httpsCallable<
        { rfqId: string; returnUrl: string },
        { checkoutUrl: string }
      >(functions, "createKaseraCheckout")

      const result = await createCheckout({
        rfqId: rfq.id,
        returnUrl: returnUrl.toString(),
      })
      window.location.assign(result.data.checkoutUrl)
    } catch (err) {
      setPaymentError(
        err instanceof Error ? err.message : "Gagal membuka checkout pembayaran Kasera."
      )
      setIsPaying(false)
    }
  }

  // Reset order tracking to new quote
  function resetToNewQuote() {
    setOrderIdParam(null)
    setTrackedOrder(null)
    setFile(null)
    setGeometry(null)
    setModel(null)
    setSubmittedRfqId(null)
    setLiveRfq(null)
    setPaymentReturned(false)
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", "/")
    }
  }

  // Render Order Receipt State if orderIdParam is present
  if (orderIdParam) {
    return (
        <div className="mx-auto flex max-w-[1440px] flex-col gap-8 px-4 py-10 sm:px-6">
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={resetToNewQuote} className="gap-2">
            <RotateCcwIcon className="size-4" /> Buat Pesanan Baru
          </Button>
          <Badge variant="outline" className="font-mono text-xs">
            ID: {orderIdParam}
          </Badge>
        </div>

        {loadingTrackedOrder ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl border bg-card text-muted-foreground">
            <Loader2Icon className="size-6 animate-spin text-primary" />
            <p className="text-sm">Memuat status pesanan...</p>
          </div>
        ) : trackedOrder ? (
          <div className="grid gap-6">
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-4">
                  <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                    {trackedOrder.paymentStatus === "Paid" ? (
                      <CheckCircle2Icon className="size-6" />
                    ) : (
                      <ClockIcon className="size-6" />
                    )}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-xl font-bold tracking-tight">
                        {trackedOrder.product}
                      </h1>
                      <Badge variant={trackedOrder.paymentStatus === "Paid" ? "default" : "outline"}>
                        {trackedOrder.paymentStatus === "Paid" ? "Lunas" : trackedOrder.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Diterima pada{" "}
                      {new Date(trackedOrder.submittedAt || trackedOrder.createdAt).toLocaleString(
                        "id-ID",
                        { dateStyle: "long", timeStyle: "short" }
                      )}
                    </p>
                  </div>
                </div>

              </CardContent>
            </Card>

            <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
              {trackedOrder.paymentStatus === "Paid" ? <CheckCircle2Icon className="size-5 shrink-0 text-primary" /> : <ClockIcon className="size-5 shrink-0 text-primary" />}
              <div>
                <p className="font-semibold">
                  {trackedOrder.paymentStatus === "Paid"
                    ? "Payment Succeeded · pembayaran dikonfirmasi dan request masuk ke persiapan produksi."
                    : trackedOrder.activeKaseraPaymentAttemptId
                      ? "Menunggu konfirmasi pembayaran dari Kasera. Status akan berubah otomatis setelah pembayaran terverifikasi."
                      : paymentReturned
                      ? "Kasera mengembalikan Anda ke halaman ini. Menunggu konfirmasi pembayaran; status akan diperbarui otomatis."
                    : trackedOrder.quoteTotal
                      ? "Quotation final sudah tersedia. Lanjutkan pembayaran melalui Kasera."
                      : trackedOrder.estimate?.status === "failed" || trackedOrder.estimate?.status === "unsupported"
                        ? "Manufacturer sedang meninjau request dan akan mengirim harga final lewat email. Belum ada pembayaran."
                        : "Request diterima. Menunggu harga final sebelum pembayaran."}
                </p>
                <p className="text-xs text-muted-foreground">
                  Pembaruan quotation dikirim ke <strong>{trackedOrder.customer.email}</strong>. Simpan ID request <strong>{trackedOrder.id}</strong> untuk pelacakan.
                </p>
              </div>
            </div>

            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
              <div className="grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Detail Spesifikasi Manufaktur</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Nama Part</p>
                    <p className="mt-1 text-sm font-medium">{trackedOrder.product}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">File 3D STL</p>
                    <p className="mt-1 text-sm font-medium">{trackedOrder.model.name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Teknologi & Material</p>
                    <p className="mt-1 text-sm font-medium">
                      {trackedOrder.requirements.process} · {trackedOrder.requirements.material}
                      {trackedOrder.requirements.color ? ` · ${trackedOrder.requirements.color}` : ""}
                      {trackedOrder.requirements.infillPercent !== undefined ? ` · ${trackedOrder.requirements.infillPercent}% infill` : ""}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Jumlah (Quantity)</p>
                    <p className="mt-1 text-sm font-medium">{trackedOrder.requirements.quantity} Unit</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Dimensi Bounding Box</p>
                    <p className="mt-1 text-sm font-mono font-medium">
                      {trackedOrder.model.boundingBoxMm.map((v) => v.toFixed(1)).join(" × ")} mm
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Status Manufaktur</p>
                    <Badge variant="outline" className="mt-1">
                      {trackedOrder.status}
                    </Badge>
                  </div>
                  <div className="sm:col-span-2 pt-2 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isDownloading}
                      onClick={async () => {
                        setIsDownloading(true)
                        try {
                          await downloadModel(
                            trackedOrder.model.storagePath,
                            trackedOrder.model.name
                          )
                        } finally {
                          setIsDownloading(false)
                        }
                      }}
                      className="gap-2"
                    >
                      <DownloadIcon className="size-4" />
                      {isDownloading ? "Mengunduh STL..." : "Unduh File Model (STL)"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Tahapan Produksi</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {[
                    { label: "Pesanan Diterima", desc: "File STL berhasil dianalisis", done: true },
                    { label: "Pembayaran Lunas", desc: "Diverifikasi otomatis via Kasera", done: trackedOrder.paymentStatus === "Paid" },
                    { label: "Persiapan Mesin & Material", desc: "G-Code toolpath & alokasi printer", done: ["Preparing Production", "In Production", "Completed"].includes(trackedOrder.status) },
                    { label: "Proses Pencetakan (Production)", desc: "Mesin sedang mencetak part", done: ["In Production", "Completed"].includes(trackedOrder.status) },
                    { label: "Quality Control & Selesai", desc: "Inspeksi dimensi & packing", done: trackedOrder.status === "Completed" },
                  ].map((step, idx) => (
                    <div key={step.label} className="flex items-start gap-3 text-xs">
                      <div
                        className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                          step.done ? "bg-primary text-primary-foreground" : "border bg-muted text-muted-foreground"
                        }`}
                      >
                        {step.done ? "✓" : idx + 1}
                      </div>
                      <div>
                        <p className={`font-semibold ${step.done ? "text-foreground" : "text-muted-foreground"}`}>
                          {step.label}
                        </p>
                        <p className="text-muted-foreground">{step.desc}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
              </div>

              <aside className="grid content-start gap-4">
                {user && trackedOrder.shipping?.address ? <QuoteShippingPanel rfq={trackedOrder} uid={user.uid} /> : null}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Payment receipt</CardTitle>
                    <CardDescription>Final quotation and selected delivery service.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm">
                    {trackedOrder.quoteTotal ? <>
                      <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">Manufacturing quotation</span><span className="font-medium">{formatIDR(trackedOrder.quoteTotal)}</span></div>
                      {trackedOrder.shipping?.selection ? <p className="text-xs text-muted-foreground">Includes {trackedOrder.shipping.selection.courierName} {trackedOrder.shipping.selection.service} delivery.</p> : null}
                      <div className="flex items-baseline justify-between gap-3 border-t pt-3 font-semibold"><span>{trackedOrder.shipping?.selection ? "Total payment" : "Manufacturing subtotal"}</span><span className="text-xl text-primary">{formatIDR(totalDue(trackedOrder))}</span></div>
                      {!trackedOrder.shipping?.selection ? <p className="text-xs text-muted-foreground">Choose a courier above to calculate delivery and continue to payment.</p> : null}
                    </> : <p className="text-sm text-muted-foreground">The Manufacturer’s final quotation will appear here.</p>}
                    {trackedOrder.paymentReviewRequired ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{trackedOrder.paymentReviewReason || "Pembayaran perlu ditinjau Manufacturer sebelum checkout dapat dilanjutkan."}</p> : null}
                    {trackedOrder.status === "Quoted" && trackedOrder.paymentStatus === "Unpaid" && trackedOrder.quoteTotal && trackedOrder.shipping?.address && trackedOrder.shipping.selection && !trackedOrder.paymentReviewRequired && !trackedOrder.activeKaseraPaymentAttemptId ? <Button disabled={isPaying} onClick={() => void handlePayWithKasera(trackedOrder)} className="w-full gap-2">{isPaying ? <><Loader2Icon className="size-4 animate-spin" />Membuka checkout...</> : <>Bayar via Kasera <ArrowRightIcon className="size-4" /></>}</Button> : null}
                    {paymentError ? <p role="alert" className="text-sm text-destructive">{paymentError}</p> : null}
                    {trackedOrder.estimate?.status === "ready" && typeof trackedOrder.estimate.total === "number" ? <div className="flex items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground"><span>Simulation estimate · reference only</span><span>{formatIDR(trackedOrder.estimate.total)}</span></div> : null}
                  </CardContent>
                </Card>
              </aside>
            </div>
          </div>
        ) : (
          <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed bg-card text-center p-8">
            <HelpCircleIcon className="size-8 text-muted-foreground" />
            <p className="text-base font-semibold">Pesanan Tidak Ditemukan</p>
            <Button size="sm" onClick={resetToNewQuote} className="mt-2">
              Kembali ke Halaman Utama
            </Button>
          </div>
        )}
      </div>
    )
  }

  const currentRfq = liveRfq
  const quoteTotal = currentRfq?.quoteTotal
  const estimate = currentRfq?.estimate
  const isQuoting = isSubmitting || (submittedRfqId && !quoteTotal && estimate?.status === "processing")
  const isQuoteReady = Boolean(quoteTotal && quoteTotal > 0)
  const canPay = currentRfq?.status === "Quoted" && currentRfq.paymentStatus === "Unpaid" && isQuoteReady && Boolean(currentRfq.shipping?.address && currentRfq.shipping.selection) && !currentRfq.paymentReviewRequired && !currentRfq.activeKaseraPaymentAttemptId
  const canEditShippingAddress = !submittedRfqId || Boolean(currentRfq && ["Submitted", "Quoted"].includes(currentRfq.status) && currentRfq.paymentStatus === "Unpaid" && !currentRfq.activeKaseraPaymentAttemptId)

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground antialiased selection:bg-primary selection:text-primary-foreground">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <BoxIcon className="size-5" />
            </span>
            <div>
              <span className="text-base font-bold tracking-tight">OI Manufacture</span>
              <span className="hidden text-xs text-muted-foreground sm:inline-block sm:ml-2 pl-2 border-l">
                On-Demand 3D Printing & Manufacturing
              </span>
            </div>
          </div>

          <nav className="flex items-center gap-4 text-xs font-medium">
            <a href="#configurator" className="hidden sm:inline-block text-muted-foreground hover:text-foreground transition-colors">
              Instant Quote
            </a>
            <a href="#materials" className="hidden sm:inline-block text-muted-foreground hover:text-foreground transition-colors">
              Materials & Specs
            </a>
            <a href="#faq" className="hidden sm:inline-block text-muted-foreground hover:text-foreground transition-colors">
              FAQ
            </a>
            <Button render={<Link href="/-/requests" />} variant="outline" size="sm" className="h-8 text-xs font-medium">
              Manufacturer Portal
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden border-b bg-muted/20 py-10 sm:py-14">
          <div className="mx-auto max-w-[1440px] px-4 sm:px-6">
            <div className="mx-auto max-w-3xl text-center">
              <Badge variant="outline" className="mb-4 gap-1.5 px-3 py-1 text-xs font-semibold tracking-wide uppercase border-primary/30 bg-primary/5 text-primary">
                <SparklesIcon className="size-3.5" /> Instant 3D CAD Slicing & Direct Checkout
              </Badge>
              <h1 className="text-3xl font-extrabold tracking-tight sm:text-5xl">
                Cetak 3D Presisi dengan Preview & Tracing Geometri Instan
              </h1>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
                Pilih atau seret file STL Anda. Model langsung ditahan di memori browser untuk analisis dimensi, volume, dan preview 3D interaktif sebelum diunggah.
              </p>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-xs font-medium text-muted-foreground sm:gap-8">
                <div className="flex items-center gap-1.5">
                  <ZapIcon className="size-4 text-primary" />
                  <span>Client-Side Mesh Tracing</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <LayersIcon className="size-4 text-primary" />
                  <span>FDM · SLA Resin · SLS</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ShieldCheckIcon className="size-4 text-primary" />
                  <span>Bayar Kasera QRIS / VA</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <TruckIcon className="size-4 text-primary" />
                  <span>Lead Time 24-48 Jam</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Core Configurator Section (Split Layout) */}
        <section id="configurator" className="py-10 sm:py-14">
          <div className="mx-auto max-w-[1440px] px-4 sm:px-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-6 xl:gap-8">
              
              {/* 3D model preview and request configuration */}
              <div className="contents">

                {/* 2. Manufacturing Parameters Form */}
                <Card className="order-3 lg:order-none lg:col-start-1 lg:col-span-9 lg:row-start-2">
                  <CardHeader>
                    <CardTitle className="text-base font-semibold">Alamat Pengiriman & Spesifikasi</CardTitle>
                    <CardDescription className="text-xs">
                      Pilih tujuan kirim, lalu atur kebutuhan cetak dan material.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    <section className="grid gap-3 border-b pb-4" aria-labelledby="shipping-address-heading">
                      <div>
                        <h3 id="shipping-address-heading" className="text-sm font-semibold">Alamat pengiriman</h3>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        <div className="grid content-start gap-1.5 sm:col-span-2 xl:col-span-3">
                          <Label htmlFor="shipping-destination" className="text-xs font-semibold">Cari kota atau negara tujuan</Label>
                          <Input id="shipping-destination" required autoComplete="off" disabled={!canEditShippingAddress} placeholder="Cari kota, kecamatan, atau negara" value={shippingDestinationSearch} onChange={(event) => { setShippingDestination(null); setShippingAddressError(""); setShippingAddressSaved(false); setShippingDestinationSearch(event.target.value) }} className="h-8 text-xs" />
                          {searchingShippingDestinations ? <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2Icon className="size-3 animate-spin" />Mencari lokasi…</p> : null}
                          {shippingDestinations.length ? <div className="grid max-h-40 gap-1 overflow-y-auto rounded-md border p-1">{shippingDestinations.map((destination) => <button key={`${destination.scope}-${destination.id}`} type="button" className="flex items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-xs hover:bg-muted" onClick={() => { const { postalCode, ...selectedDestination } = destination; setShippingDestination(selectedDestination); setShippingPostalCode(postalCode ?? ""); setShippingDestinationSearch(destination.label); setShippingDestinations([]); setShippingAddressError(""); setShippingAddressSaved(false) }}><span>{destination.label}</span><span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">{destination.scope === "domestic" ? "Indonesia" : "International"}</span></button>)}</div> : null}
                          {!searchingShippingDestinations && shippingDestinationSearch.trim().length >= 2 && !shippingDestination && !shippingDestinations.length && !shippingAddressError ? <p className="text-xs text-muted-foreground">Lokasi belum ditemukan. Coba nama kota atau negara lain.</p> : null}
                          {shippingDestination ? <p className="text-xs text-muted-foreground">Rute terdeteksi: {shippingDestination.scope === "domestic" ? "Indonesia" : "International"} · {shippingDestination.label}</p> : null}
                        </div>
                        <label className="grid gap-1.5 text-xs font-semibold sm:col-span-2 xl:col-span-3">Alamat lengkap<Input required autoComplete="shipping street-address" disabled={!canEditShippingAddress} placeholder="Nama jalan, nomor, gedung, kecamatan" value={shippingAddressLine} onChange={(event) => { setShippingAddressLine(event.target.value); setShippingAddressError(""); setShippingAddressSaved(false) }} className="h-8 text-xs font-normal" /></label>
                        <label className="grid gap-1.5 text-xs font-semibold">Nama pemesan / penerima<Input required autoComplete="name" disabled={!canEditShippingAddress} placeholder="Nama Anda" value={contactName} onChange={(event) => { setContactName(event.target.value); setShippingAddressError(""); setShippingAddressSaved(false) }} className="h-8 text-xs font-normal" /></label>
                        <label className="grid gap-1.5 text-xs font-semibold">Nomor telepon penerima<Input required type="tel" autoComplete="shipping tel" disabled={!canEditShippingAddress} value={shippingPhone} onChange={(event) => { setShippingPhone(event.target.value); setShippingAddressError(""); setShippingAddressSaved(false) }} className="h-8 text-xs font-normal" /></label>
                        <label className="grid gap-1.5 text-xs font-semibold">Kode pos<Input required autoComplete="shipping postal-code" disabled={!canEditShippingAddress} value={shippingPostalCode} onChange={(event) => { setShippingPostalCode(event.target.value); setShippingAddressError(""); setShippingAddressSaved(false) }} className="h-8 text-xs font-normal" /><span className="text-[11px] font-normal text-muted-foreground">Terisi otomatis jika tersedia untuk lokasi yang dipilih.</span></label>
                        {shippingAddressError ? <p role="alert" className="text-xs text-destructive sm:col-span-2 xl:col-span-3">{shippingAddressError}</p> : null}
                        {shippingAddressSaved ? <p role="status" className="text-xs text-primary sm:col-span-2 xl:col-span-3">Alamat tersimpan. Tarif ekspedisi sedang diperbarui.</p> : null}
                        {submittedRfqId && canEditShippingAddress ? <Button type="button" size="sm" variant="outline" className="w-fit" disabled={savingShippingAddress} onClick={() => void handleSaveShippingAddress()}>{savingShippingAddress ? <><Loader2Icon className="size-3.5 animate-spin" /> Menyimpan alamat…</> : "Simpan alamat pengiriman"}</Button> : null}
                      </div>
                    </section>

                    <section className="grid gap-3" aria-labelledby="print-specifications-heading">
                    <h3 id="print-specifications-heading" className="text-sm font-semibold">Spesifikasi cetak & material</h3>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {/* Process Type */}
                    <div className="grid gap-1.5">
                      <Label htmlFor="process" className="text-xs font-semibold">
                        Teknologi Cetak
                      </Label>
                      <Select value={processType} onValueChange={(v) => handleParamChange(setProcessType, String(v ?? "FDM"))}>
                        <SelectTrigger id="process" className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="FDM">FDM (Fused Deposition Modeling)</SelectItem>
                          <SelectItem value="SLA">SLA Resin (Presisi Sangat Halus)</SelectItem>
                          <SelectItem value="SLS">SLS (Nylon Industri Tanpa Support)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Material Choice */}
                    <div className="grid gap-1.5">
                      <Label htmlFor="material" className="text-xs font-semibold">
                        Pilihan Material
                      </Label>
                      <Select value={material} onValueChange={(v) => handleParamChange(setMaterial, String(v ?? "PLA"))}>
                        <SelectTrigger id="material" className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PLA">PLA (Standar, Stabil)</SelectItem>
                          <SelectItem value="PETG">PETG (Kuat, Tahan Kimia)</SelectItem>
                          <SelectItem value="ABS">ABS (Tahan Benturan)</SelectItem>
                          <SelectItem value="TPU">TPU (Fleksibel & Lentur)</SelectItem>
                          <SelectItem value="Tough Resin">Tough Resin (SLA Ultra Detail)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Color with 3D color reflection */}
                    <div className="grid gap-1.5">
                      <Label htmlFor="color" className="text-xs font-semibold">
                        Warna Part
                      </Label>
                      <Select value={color} onValueChange={(v) => setColor(String(v ?? "Black"))}>
                        <SelectTrigger id="color" className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Black">Hitam (Industrial Black)</SelectItem>
                          <SelectItem value="White">Putih (Pure White)</SelectItem>
                          <SelectItem value="Grey">Abu-abu (Mechanical Grey)</SelectItem>
                          <SelectItem value="Orange">Orange (Prusa Signature)</SelectItem>
                          <SelectItem value="Blue">Biru (Industrial Blue)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Infill Density */}
                    <div className="grid gap-1.5">
                      <Label htmlFor="infill" className="text-xs font-semibold">
                        Kepadatan (Infill %)
                      </Label>
                      <Select value={infill} onValueChange={(v) => handleParamChange(setInfill, String(v ?? "20%"))}>
                        <SelectTrigger id="infill" className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="15%">15% (Prototipe Ringan)</SelectItem>
                          <SelectItem value="20%">20% (Standar Fungsional)</SelectItem>
                          <SelectItem value="40%">40% (Kekuatan Beban Tinggi)</SelectItem>
                          <SelectItem value="100%">100% (Solid Padat Maksimal)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Quantity */}
                    <div className="grid gap-1.5">
                      <Label htmlFor="quantity" className="text-xs font-semibold">
                        Jumlah Part (Quantity)
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id="quantity"
                          type="number"
                          min="1"
                          step="1"
                          value={quantity}
                          onChange={(e) => handleParamChange(setQuantity, e.target.value)}
                          className="h-8 text-xs font-mono font-medium"
                        />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">Unit</span>
                      </div>
                    </div>

                    {/* Unit Switch */}
                    <div className="grid gap-1.5">
                      <Label htmlFor="unit" className="text-xs font-semibold">
                        Satuan File STL
                      </Label>
                      <Select value={unit} onValueChange={(v) => handleParamChange(setUnit, v as "mm" | "inch")}>
                        <SelectTrigger id="unit" className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="mm">Milimeter (mm)</SelectItem>
                          <SelectItem value="inch">Inci (Inches)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Notes */}
                    <div className="grid gap-1.5 sm:col-span-2 xl:col-span-3">
                      <Label htmlFor="notes" className="text-xs font-semibold">
                        Catatan Teknis Khusus (Opsional)
                      </Label>
                      <textarea
                        id="notes"
                        rows={2}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Toleransi lubang baut, orientasi penekanan, atau instruksi khusus..."
                        className="rounded-md border border-input bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                    </div>
                    </section>

                    <div className="grid gap-1.5 border-t pt-3">
                      <Label htmlFor="contact-email" className="text-xs font-semibold">Email untuk quotation dan update pesanan</Label>
                      <Input id="contact-email" type="email" autoComplete="email" placeholder="email@perusahaan.com" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} className="h-8 text-xs sm:max-w-md" />
                    </div>
                  </CardContent>
                </Card>

              </div>

              {/* Receipt remains the only right sidebar */}
              <div className="contents">
                
                {/* Upload and 3D preview share one workspace card. */}
                <Card className="order-1 overflow-hidden border-border/80 shadow-md lg:order-none lg:col-start-1 lg:col-span-9 lg:row-start-1">
                  <CardContent className="grid gap-3 p-3">
                    {file && model ? (
                      <>
                        <div className="relative overflow-hidden rounded-lg border bg-card">
                          <DedicatedModelViewer
                            geometry={geometry}
                            currentLayer={currentLayer}
                            totalLayers={totalLayers}
                            color={COLOR_HEX_MAP[color] || "#7c3aed"}
                          />
                        </div>

                        <div className="flex flex-col gap-3 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex min-w-0 items-center gap-3">
                            <FileUpIcon className="size-5 shrink-0 text-primary" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{file.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatSize(file.size)} · {model.boundingBoxMm.map((value) => value.toFixed(1)).join(" × ")} mm
                              </p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <label
                              htmlFor="stl-model-upload"
                              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "cursor-pointer")}
                            >
                              Ganti STL
                              <input
                                id="stl-model-upload"
                                type="file"
                                accept=".stl,model/stl,application/sla"
                                className="sr-only"
                                onChange={(event) => {
                                  void handleFileSelected(event.currentTarget.files?.[0])
                                  event.currentTarget.value = ""
                                }}
                              />
                            </label>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setFile(null)
                                setGeometry(null)
                                setModel(null)
                                setRawDimensions(null)
                                setRawVolume(undefined)
                                setTriangleCount(0)
                                setProduct("")
                                setCurrentLayer(0)
                                setSubmittedRfqId(null)
                                setLiveRfq(null)
                                setSubmitError("")
                              }}
                            >
                              Hapus
                            </Button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <label
                        htmlFor="stl-model-upload"
                        className={cn(
                          "relative flex min-h-[400px] flex-col items-center justify-center gap-3 overflow-hidden rounded-lg border-2 border-dashed bg-muted/20 px-6 py-10 text-center transition-colors sm:min-h-[480px]",
                          isParsing ? "cursor-wait border-primary/40" : "cursor-pointer hover:border-primary/60 hover:bg-primary/[0.03]"
                        )}
                      >
                        <input
                          id="stl-model-upload"
                          type="file"
                          accept=".stl,model/stl,application/sla"
                          disabled={isParsing}
                          className="sr-only"
                          onChange={(event) => {
                            void handleFileSelected(event.currentTarget.files?.[0])
                            event.currentTarget.value = ""
                          }}
                        />
                        {isParsing ? (
                          <Loader2Icon className="size-10 animate-spin text-primary" />
                        ) : (
                          <UploadCloudIcon className="size-10 text-primary" />
                        )}
                        <span className="grid gap-1">
                          <span className="text-base font-semibold text-foreground">
                            {isParsing ? "Memproses model 3D…" : "Upload file STL untuk melihat preview"}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {isParsing ? "Membaca mesh dan dimensi model." : "Klik untuk memilih file dari perangkat Anda."}
                          </span>
                        </span>
                        {!isParsing ? (
                          <span className="rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">
                            .STL · maksimal 50 MB
                          </span>
                        ) : null}
                      </label>
                    )}

                    {/* Step-by-step layer slider preview right below 3D viewport */}
                    {file && model ? (
                      <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold flex items-center gap-1.5">
                            <LayersIcon className="size-4 text-primary" /> Simulasi Print Layer (Step-by-Step)
                          </span>
                          <span className="font-mono text-xs font-medium text-muted-foreground">
                            Layer {currentLayer + 1} / {totalLayers} · {(currentLayer * 0.2).toFixed(1)} mm
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            min={0}
                            max={Math.max(0, totalLayers - 1)}
                            value={currentLayer}
                            onChange={(e) => setCurrentLayer(Number(e.target.value))}
                            className="w-full accent-primary h-2 cursor-pointer bg-muted rounded-lg"
                          />
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                {/* 2. Professional Quotation & Invoice Receipt Card */}
                <Card className="order-2 border-primary/20 shadow-lg lg:sticky lg:top-24 lg:order-none lg:col-start-10 lg:col-span-3 lg:row-start-1 lg:row-span-2 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
                  <CardHeader className="border-b bg-muted/20 pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ReceiptIcon className="size-4 text-primary" />
                        <CardTitle className="text-sm font-bold uppercase tracking-wider">
                          {submittedRfqId ? "Quotation & Status Pembayaran" : "Ringkasan Pesanan & Estimasi Biaya"}
                        </CardTitle>
                      </div>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {submittedRfqId ? (isQuoteReady ? "QUOTATION FINAL" : "MENUNGGU QUOTATION") : file ? "ESTIMASI SIMULASI" : "MENUNGGU MODEL"}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="p-5 grid gap-4">
                    {/* Itemized Invoice Table */}
                    {!submittedRfqId && quotation ? (
                      <div className="flex flex-col divide-y text-xs">
                        <div className="pb-3 flex justify-between items-start">
                          <div>
                            <p className="font-semibold text-sm text-foreground">{product || file?.name}</p>
                            <p className="text-muted-foreground text-[11px] mt-0.5">
                              {processType} · {material} ({color}, {infill} Infill)
                            </p>
                            <p className="text-muted-foreground text-[11px]">
                              Dimensi: {model?.boundingBoxMm.map((v) => v.toFixed(1)).join(" × ")} mm
                            </p>
                          </div>
                          <div className="text-right font-mono font-medium">
                            {quotation.qty} Unit
                          </div>
                        </div>

                        {/* Customer-Centric Quotation Rows */}
                        <div className="py-2.5 flex justify-between items-center text-muted-foreground">
                          <span>Harga Satuan (Unit Price)</span>
                          <span className="font-mono font-medium text-foreground">
                            {formatIDR(Math.round(quotation.total / quotation.qty))} / unit
                          </span>
                        </div>

                        <div className="py-2.5 flex justify-between items-center text-muted-foreground">
                          <span>Jumlah Pesanan (Quantity)</span>
                          <span className="font-mono font-medium text-foreground">
                            {quotation.qty} Unit
                          </span>
                        </div>

                        <div className="py-2.5 flex justify-between items-center text-muted-foreground">
                          <span>Estimasi Waktu Produksi (Lead Time)</span>
                          <span className="font-mono font-medium text-foreground">
                            {loadingProductionLeadTime ? "Menghitung kapasitas…" : productionLeadTimeDays ? `${productionLeadTimeDays} Hari Kerja` : "Konfirmasi kapasitas"}
                          </span>
                        </div>

                        <div className="py-2.5 flex justify-between items-center text-muted-foreground">
                          <span>Pembersihan Support & QC Dimensi</span>
                          <span className="font-medium text-emerald-600 dark:text-emerald-400">
                            Termasuk (Gratis)
                          </span>
                        </div>

                        <div className="py-2.5 flex justify-between items-center text-muted-foreground">
                          <span>Pajak (PPN)</span>
                          <span className="font-medium text-foreground">
                            Termasuk
                          </span>
                        </div>

                        {/* Grand Total */}
                        <div className="pt-3 flex justify-between items-baseline">
                          <div>
                            <span className="text-xs font-bold uppercase tracking-wider text-primary">
                              Estimasi simulasi · belum harga final
                            </span>
                            <p className="text-[10px] text-muted-foreground">
                              Garansi akurasi dimensi ±0.2 mm & packing aman
                            </p>
                          </div>
                          <div className="text-right">
                            <span className="text-2xl font-extrabold tracking-tight text-primary">
                              {formatIDR(quotation.total)}
                            </span>
                          </div>
                        </div>
                        <div className="grid gap-2 border-t pt-3">
                          <div className="flex justify-between gap-3 text-xs"><span>Estimasi ongkir{selectedShippingPreviewRate ? ` · ${selectedShippingPreviewRate.courierName} ${selectedShippingPreviewRate.service}` : " · pilih ekspedisi di bawah"}</span><span>{selectedShippingPreviewRate ? formatIDR(selectedShippingPreviewRate.cost) : "—"}</span></div>
                          {selectedShippingPreviewRate ? <div className="flex justify-between gap-3 text-sm font-semibold"><span>Total estimasi · belum final</span><span>{formatIDR(quotation.total + selectedShippingPreviewRate.cost)}</span></div> : null}
                        </div>
                      </div>
                    ) : submittedRfqId && currentRfq && isQuoteReady ? (
                      <div className="grid gap-3 py-2">
                        <div><p className="text-sm font-semibold">{currentRfq.product}</p><p className="text-xs text-muted-foreground">{currentRfq.requirements.quantity} unit · {currentRfq.requirements.process} · {currentRfq.requirements.material}{currentRfq.requirements.color ? ` · ${currentRfq.requirements.color}` : ""}{currentRfq.requirements.infillPercent !== undefined ? ` · ${currentRfq.requirements.infillPercent}% infill` : ""}</p></div>
                        <div className="grid gap-2 border-t pt-3 text-xs">
                          <div className="flex justify-between gap-3"><span>Manufacturing quotation</span><span>{formatIDR(currentRfq.quoteTotal!)}</span></div>
                          <div className="flex justify-between gap-3"><span>Shipping · {currentRfq.shipping?.selection ? `${currentRfq.shipping.selection.courierName} ${currentRfq.shipping.selection.service}` : "Choose a service below"}</span><span>{currentRfq.shipping?.selection ? formatIDR(currentRfq.shipping.selection.cost) : "—"}</span></div>
                          <div className="flex items-baseline justify-between border-t pt-3"><span className="font-bold uppercase tracking-wider text-primary">{currentRfq.shipping?.selection ? "Order total" : "Manufacturing subtotal"}</span><span className="text-2xl font-extrabold tracking-tight text-primary">{formatIDR(totalDue(currentRfq))}</span></div>
                          {!currentRfq.shipping?.selection ? <p className="text-right text-[11px] text-muted-foreground">Choose a courier below to see the final total.</p> : null}
                        </div>
                        <p className="text-xs text-muted-foreground">Payment: {currentRfq.paymentStatus ?? "Unpaid"}{currentRfq.paymentStatus === "Paid" ? ` · ${currentRfq.status}` : ""}</p>
                      </div>
                    ) : submittedRfqId ? (
                      <div role="status" className="grid justify-items-center gap-2 py-6 text-center">
                        {isQuoting ? <Loader2Icon className="size-6 animate-spin text-primary" /> : <ClockIcon className="size-6 text-primary" />}
                        <p className="text-sm font-semibold">{isQuoting ? "Menyiapkan quotation…" : "Menunggu quotation final"}</p>
                        <p className="max-w-sm text-xs text-muted-foreground">{estimate?.status === "unsupported" || estimate?.status === "failed" ? "Manufacturer akan meninjau file dan mengirim harga final ke email Anda. Belum ada pembayaran yang perlu dilakukan." : "Harga final dan tombol pembayaran Kasera akan muncul di sini setelah Manufacturer menerbitkan quotation."}</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
                        <FileTextIcon className="size-8 opacity-40 mb-2" />
                        <p className="text-xs">
                          Belum ada item untuk dihitung. Upload file STL di sisi kiri untuk melihat rincian kalkulasi biaya.
                        </p>
                      </div>
                    )}

                    {!submittedRfqId && file && model ? (
                      <div className="grid gap-2 border-t pt-4">
                        <p className="text-xs font-semibold">Pilih ekspedisi · estimasi ongkir</p>
                        {!shippingDestination ? <p className="text-xs text-muted-foreground">Pilih kota tujuan di card kiri untuk melihat ongkir.</p> : null}
                        {loadingShippingPreview ? <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2Icon className="size-3 animate-spin" />Menghitung tarif ekspedisi…</p> : null}
                        {shippingPreviewRates.length ? <Select value={selectedShippingPreviewRate?.id ?? ""} onValueChange={(value) => setSelectedShippingPreviewRate(shippingPreviewRates.find((rate) => rate.id === String(value ?? "")) ?? null)}>
                          <SelectTrigger className="w-full text-xs" disabled={loadingShippingPreview}><SelectValue placeholder="Pilih ekspedisi" /></SelectTrigger>
                          <SelectContent>{shippingPreviewRates.map((rate) => <SelectItem key={rate.id} value={rate.id}>{rate.courierName} · {rate.service} · {formatIDR(rate.cost)}</SelectItem>)}</SelectContent>
                        </Select> : null}
                        {selectedShippingPreviewRate ? <p className="text-xs text-muted-foreground">{selectedShippingPreviewRate.etd || "Estimasi waktu pengiriman mengikuti layanan ekspedisi."}</p> : null}
                        {shippingPreviewError ? <div className="grid justify-items-start gap-2"><p role="alert" className="text-xs text-destructive">{shippingPreviewError}</p><Button type="button" variant="outline" size="sm" disabled={loadingShippingPreview} onClick={() => setShippingPreviewRevision((revision) => revision + 1)}>Coba hitung ongkir lagi</Button></div> : null}
                        {shippingDestination && !loadingShippingPreview && !shippingPreviewError && !shippingPreviewRates.length ? <p className="text-xs text-muted-foreground">Belum ada tarif untuk rute ini.</p> : null}
                      </div>
                    ) : null}

                    {submittedRfqId && currentRfq && !isQuoteReady && currentRfq.estimate?.status === "ready" && typeof currentRfq.estimate.total === "number" ? (
                      <div className="grid gap-2 border-t pt-3 text-xs">
                        <div className="flex justify-between gap-3"><span>Manufacturing estimate · simulation</span><span>{formatIDR(currentRfq.estimate.total)}</span></div>
                        <div className="flex justify-between gap-3"><span>Shipping{currentRfq.shipping?.selection ? ` · ${currentRfq.shipping.selection.courierName} ${currentRfq.shipping.selection.service}` : " · choose below"}</span><span>{currentRfq.shipping?.selection ? formatIDR(currentRfq.shipping.selection.cost) : "—"}</span></div>
                        {currentRfq.shipping?.selection ? <div className="flex justify-between gap-3 border-t pt-2 font-semibold"><span>Estimated total · not final</span><span>{formatIDR(currentRfq.estimate.total + currentRfq.shipping.selection.cost)}</span></div> : null}
                        <p className="text-[11px] text-muted-foreground">The Manufacturer’s final quotation may differ from this estimate.</p>
                      </div>
                    ) : null}

                    {user && submittedRfqId && currentRfq && ["Submitted", "Quoted"].includes(currentRfq.status) && currentRfq.paymentStatus === "Unpaid" ? (
                      <QuoteShippingPanel rfq={currentRfq} uid={user.uid} preferredRate={selectedShippingPreviewRate ?? undefined} showAddress={false} />
                    ) : null}

                    {/* Action & Checkout Buttons */}
                    <div className="border-t pt-4 flex flex-col gap-2">
                      {submitError ? (
                        <p role="alert" className="text-xs text-destructive rounded-lg border border-destructive/20 bg-destructive/5 p-2.5">
                          {submitError}
                        </p>
                      ) : null}

                      {paymentError ? (
                        <p role="alert" className="text-xs text-destructive rounded-lg border border-destructive/20 bg-destructive/5 p-2.5">
                          {paymentError}
                        </p>
                      ) : null}

                      {!submittedRfqId ? (
                        <Button
                          type="button"
                          size="lg"
                          disabled={isSubmitting || !file || !model}
                          onClick={() => void handleSubmitOrder()}
                          className="w-full gap-2 font-bold shadow-md bg-primary text-primary-foreground"
                        >
                          {isSubmitting ? (
                            <>
                              <Loader2Icon className="size-4 animate-spin" />
                              Membuat Pesanan & Mengunggah...
                            </>
                          ) : (
                            <>
                              Kirim request untuk quotation <ArrowRightIcon className="size-4" />
                            </>
                          )}
                        </Button>
                      ) : isQuoting ? (
                        <div className="flex items-center justify-center gap-2 py-2 text-xs font-medium text-primary">
                          <Loader2Icon className="size-4 animate-spin" />
                          Menghitung harga final dari file STL...
                        </div>
                      ) : canPay && currentRfq ? (
                        <Button
                          type="button"
                          size="lg"
                          disabled={isPaying}
                          onClick={() => void handlePayWithKasera(currentRfq)}
                          className="w-full gap-2 font-bold shadow-md bg-primary text-primary-foreground"
                        >
                          {isPaying ? (
                            <>
                              <Loader2Icon className="size-4 animate-spin" />
                              Membuka Kasera Checkout...
                            </>
                          ) : (
                            <>
                              Bayar {formatIDR(totalDue(currentRfq))} via Kasera <ArrowRightIcon className="size-4" />
                            </>
                          )}
                        </Button>
                      ) : submittedRfqId && currentRfq?.paymentStatus === "Paid" ? (
                        <p role="status" className="rounded-lg bg-primary/10 p-3 text-center text-sm font-semibold">Payment Succeeded · {currentRfq.status}</p>
                      ) : submittedRfqId && currentRfq?.paymentReviewRequired ? (
                        <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-2.5 text-xs text-destructive">{currentRfq.paymentReviewReason || "Pembayaran sedang ditinjau Manufacturer."}</p>
                      ) : null}

                      <p className="text-center text-[10px] text-muted-foreground mt-1">
                        {!submittedRfqId ? "Quotation final akan dikirim ke email Anda. Pembayaran Kasera baru tersedia setelah harga resmi diterbitkan." : `Pembaruan request dikirim ke ${(currentRfq?.customer.email ?? contactEmail) || "email Anda"}. Pembayaran hanya dilakukan setelah quotation final tersedia.`}
                      </p>
                    </div>
                  </CardContent>
                </Card>

              </div>

            </div>
          </div>
        </section>

        {/* Section: Industrial Materials & Capabilities */}
        <section id="materials" className="border-t bg-muted/10 py-14">
          <div className="mx-auto max-w-[1440px] px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center mb-10">
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Material Cetak & Spesifikasi Toleransi
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Standar industri untuk prototyping fungsional maupun batch produksi langsung.
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-3">
              <Card>
                <CardHeader>
                  <Badge variant="outline" className="w-fit mb-2">FDM 3D Printing</Badge>
                  <CardTitle className="text-lg">FDM Industrial Filament</CardTitle>
                  <CardDescription className="text-xs">
                    PLA, PETG, ABS, TPU
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground flex flex-col gap-2">
                  <div className="flex justify-between border-b pb-1.5">
                    <span>Toleransi Dimensi</span>
                    <span className="font-semibold text-foreground">± 0.2 mm</span>
                  </div>
                  <div className="flex justify-between border-b pb-1.5">
                    <span>Layer Height</span>
                    <span className="font-semibold text-foreground">0.12 - 0.28 mm</span>
                  </div>
                  <div className="flex justify-between border-b pb-1.5">
                    <span>Max Build Volume</span>
                    <span className="font-semibold text-foreground">300 × 300 × 300 mm</span>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed">
                    Cocok untuk casing prototipe, jig & fixture mekanik, dan part tahan benturan fungsional.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <Badge variant="outline" className="w-fit mb-2">SLA Photopolymer</Badge>
                  <CardTitle className="text-lg">SLA High-Precision Resin</CardTitle>
                  <CardDescription className="text-xs">
                    Standard & Tough Resin
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground flex flex-col gap-2">
                  <div className="flex justify-between border-b pb-1.5">
                    <span>Toleransi Dimensi</span>
                    <span className="font-semibold text-foreground">± 0.05 mm</span>
                  </div>
                  <div className="flex justify-between border-b pb-1.5">
                    <span>Layer Height</span>
                    <span className="font-semibold text-foreground">0.05 mm</span>
                  </div>
                  <div className="flex justify-between border-b pb-1.5">
                    <span>Permukaan Akhir</span>
                    <span className="font-semibold text-foreground">Sangat Halus / Glossy</span>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed">
                    Sangat ideal untuk master mold, part perhiasan, figur miniatur, dan casing dengan detail mikro.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <Badge variant="outline" className="w-fit mb-2">SLS Powder Fusion</Badge>
                  <CardTitle className="text-lg">SLS Industrial Nylon</CardTitle>
                  <CardDescription className="text-xs">
                    PA12 Nylon Powder
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground flex flex-col gap-2">
                  <div className="flex justify-between border-b pb-1.5">
                    <span>Toleransi Dimensi</span>
                    <span className="font-semibold text-foreground">± 0.15 mm</span>
                  </div>
                  <div className="flex justify-between border-b pb-1.5">
                    <span>Support Structure</span>
                    <span className="font-semibold text-foreground">Tanpa Support</span>
                  </div>
                  <div className="flex justify-between border-b pb-1.5">
                    <span>Kekuatan Mekanik</span>
                    <span className="font-semibold text-foreground">Isotropik Tinggi</span>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed">
                    Pilihan utama untuk komponen end-use produksi skala kecil dengan geometri internal kompleks.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Section: Frequently Asked Questions */}
        <section id="faq" className="border-t py-14">
          <div className="mx-auto max-w-4xl px-4 sm:px-6">
            <h2 className="text-2xl font-bold tracking-tight text-center sm:text-3xl mb-8">
              Pertanyaan yang Sering Diajukan (FAQ)
            </h2>

            <div className="grid gap-4">
              <Card>
                <CardHeader className="py-4">
                  <CardTitle className="text-sm font-semibold">
                    Apakah file saya langsung diunggah saat dipilih?
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground leading-relaxed">
                  Tidak. File STL Anda diproses dan ditahan di memori browser lokal terlebih dahulu untuk melakukan tracing geometri, verifikasi mesh, dan kalkulasi estimasi awal. File baru akan diunggah ke server ketika Anda mengonfirmasi pesanan.
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="py-4">
                  <CardTitle className="text-sm font-semibold">
                    Bagaimana alur pembayaran via Kasera?
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground leading-relaxed">
                  Setelah kuotasi resmi terbit, Anda dapat langsung mengklik tombol &apos;Bayar via Kasera&apos; untuk membayar menggunakan QRIS atau Virtual Account bank pilihan Anda. Begitu pembayaran selesai, receipt resmi otomatis dikirim ke email via Resend.
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t bg-muted/20 py-8">
        <div className="mx-auto flex max-w-[1440px] flex-col items-center justify-between gap-4 px-4 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <span className="font-bold text-foreground">OI Manufacture</span> · Precision 3D Printing
          </div>
          <div>
            Terintegrasi dengan Gateway Pembayaran Kasera & Layanan Email Resend
          </div>
          <div className="flex items-center gap-4">
            <Link href="/portal" className="hover:text-foreground">
              Customer Portal
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Staff Login
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
