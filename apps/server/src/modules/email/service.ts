import type { DocumentData } from "firebase-admin/firestore"
const formatIDR = (amount: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount)

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!
  )
}

async function sendResendEmail({
  apiKey,
  from,
  to,
  subject,
  html,
  idempotencyKey,
}: {
  apiKey: string
  from: string
  to?: string
  subject: string
  html: string
  idempotencyKey: string
}) {
  if (!apiKey || !to) {
    console.warn(
      "[Resend] Email skipped because its API key or recipient is missing."
    )
    return null
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
    signal: AbortSignal.timeout(10000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`Resend rejected the email (HTTP ${response.status}).`)
  }
  return payload?.id || null
}

function emailTemplate({
  heading,
  intro,
  customerName,
  rfqId,
  amount,
  details,
  link,
  totalLabel,
}: {
  heading: string
  intro: string
  customerName?: string
  rfqId: string
  amount: number
  details: string[][]
  link: string
  totalLabel: string
}) {
  const formattedAmount = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount)
  const rows = details
    .map(
      ([label, value]) =>
        `<tr><td style="padding:9px 0;border-bottom:1px solid #eee;color:#667085">${escapeHtml(label)}</td><td style="padding:9px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600">${escapeHtml(value)}</td></tr>`
    )
    .join("")
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f4f5f7;padding:24px;font-family:Arial,sans-serif;color:#202124">
    <main style="max-width:560px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
      <p style="margin:0 0 8px;color:#667085;font-size:12px">OI MANUFACTURE · ${escapeHtml(rfqId)}</p>
      <h1 style="margin:0 0 16px;font-size:22px">${heading}</h1>
      <p>Halo ${escapeHtml(customerName || "Customer")},</p>
      <p style="line-height:1.6;color:#475467">${intro}</p>
      <table style="width:100%;border-collapse:collapse">
        ${rows}
        <tr><td style="padding:14px 0;font-weight:700">${totalLabel}</td><td style="padding:14px 0;text-align:right;font-weight:700">${formattedAmount}</td></tr>
      </table>
      <p style="margin:24px 0;text-align:center"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#165dff;color:#fff;text-decoration:none;font-weight:600">Lihat detail request</a></p>
      <p style="margin:0;color:#667085;font-size:12px">OI Manufacture · Jika ada pertanyaan, balas email ini.</p>
    </main>
  </body>
</html>`
}

function emailDetails(rfq: DocumentData) {
  return [
    ["Produk / part", rfq.product || "3D Printed Part"],
    ...(rfq.requirements?.material
      ? [["Material", rfq.requirements.material]]
      : []),
    ...(rfq.requirements?.color ? [["Color", rfq.requirements.color]] : []),
    ...(rfq.requirements?.infillPercent !== undefined
      ? [["Infill", `${rfq.requirements.infillPercent}%`]]
      : []),
    ["Jumlah", `${rfq.requirements?.quantity || 1} unit`],
  ]
}

async function sendQuoteEmail({
  apiKey,
  from,
  rfq,
  rfqId,
  appOrigin,
}: {
  apiKey: string
  from: string
  rfq: DocumentData
  rfqId: string
  appOrigin: string
}) {
  const html = emailTemplate({
    heading: "Quotation Anda Siap",
    intro:
      "Manufacturer telah menerbitkan harga final untuk request Anda. Buka detail request untuk meninjau quotation dan melanjutkan pembayaran melalui Kasera.",
    customerName: rfq.customer?.name,
    rfqId,
    amount: rfq.quoteTotal,
    details: emailDetails(rfq),
    link: `${appOrigin}/?orderId=${encodeURIComponent(rfqId)}`,
    totalLabel: "Total quotation",
  })
  return sendResendEmail({
    apiKey,
    from,
    to: rfq.customer?.email,
    subject: `Quotation siap · ${rfqId}`,
    html,
    idempotencyKey: `quote_${rfqId}_${rfq.quotedAt || "na"}_${rfq.quoteTotal}`,
  })
}

async function sendReceiptEmail({
  apiKey,
  from,
  to,
  customerName,
  rfqId,
  product,
  quantity,
  material,
  color,
  infillPercent,
  shippingSelection,
  amount,
  paidAt,
  paymentId,
  appOrigin = "http://localhost:3001",
}: {
  apiKey: string
  from: string
  to?: string
  customerName?: string
  rfqId: string
  product?: string
  quantity?: number
  material?: string
  color?: string
  infillPercent?: number
  shippingSelection?: { courierName: string; service: string; cost: number }
  amount: number
  paidAt?: number
  paymentId?: string
  appOrigin?: string
}) {
  const rfq = {
    product,
    requirements: { quantity, material, color, infillPercent },
  }
  const html = emailTemplate({
    heading: "Pembayaran Dikonfirmasi",
    intro:
      "Pembayaran untuk request Anda telah dikonfirmasi. Pesanan kini masuk ke tahap persiapan produksi.",
    customerName,
    rfqId,
    amount,
    details: [
      ...emailDetails(rfq),
      ...(shippingSelection
        ? [
            [
              "Shipping",
              `${shippingSelection.courierName} · ${shippingSelection.service}`,
            ],
            ["Estimated shipping cost", formatIDR(shippingSelection.cost)],
          ]
        : []),
      ...(paymentId ? [["ID transaksi", paymentId]] : []),
      ...(paidAt
        ? [["Dikonfirmasi pada", new Date(paidAt).toLocaleString("id-ID")]]
        : []),
    ],
    link: `${appOrigin}/?orderId=${encodeURIComponent(rfqId)}`,
    totalLabel: "Total dibayar",
  })
  return sendResendEmail({
    apiKey,
    from,
    to,
    subject: `Pembayaran dikonfirmasi · ${rfqId}`,
    html,
    idempotencyKey: `paid_${rfqId}_${paidAt || paymentId || "confirmed"}`,
  })
}

async function sendRfqEmailForChange({
  before,
  after,
  rfqId,
  apiKey,
  from,
  appOrigin = "http://localhost:3001",
}: {
  before?: DocumentData
  after?: DocumentData
  rfqId: string
  apiKey: string
  from: string
  appOrigin?: string
}) {
  if (!after) return null
  const quoteChanged =
    after.status === "Quoted" &&
    after.paymentStatus === "Unpaid" &&
    Number.isSafeInteger(after.quoteTotal) &&
    after.quoteTotal > 0 &&
    (before?.status !== "Quoted" ||
      before.quoteTotal !== after.quoteTotal ||
      before.quotedAt !== after.quotedAt)
  if (quoteChanged) {
    return sendQuoteEmail({ apiKey, from, rfq: after, rfqId, appOrigin })
  }
  if (
    after.paymentStatus === "Paid" &&
    before?.paymentStatus !== "Paid" &&
    Number.isSafeInteger(after.quoteTotal) &&
    after.quoteTotal > 0
  ) {
    return sendReceiptEmail({
      apiKey,
      from,
      to: after.customer?.email,
      customerName: after.customer?.name,
      rfqId,
      product: after.product,
      quantity: after.requirements?.quantity,
      material: after.requirements?.material,
      color: after.requirements?.color,
      infillPercent: after.requirements?.infillPercent,
      shippingSelection: after.shipping?.selection,
      amount: after.quoteTotal + (after.shipping?.selection?.cost ?? 0),
      paidAt: after.paidAt,
      paymentId: after.kaseraPaymentRequestId,
      appOrigin,
    })
  }
  return null
}

export { sendQuoteEmail, sendReceiptEmail, sendRfqEmailForChange }
