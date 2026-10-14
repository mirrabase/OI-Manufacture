import { notFound, redirect } from "next/navigation"

const sections = [
  "analytics",
  "customers",
  "dashboard",
  "equipment",
  "materials",
  "orders",
  "production",
  "quotations",
  "rfqs",
  "settings",
]

export default async function LegacyDashboardSection({
  params,
}: {
  params: Promise<{ section: string }>
}) {
  const { section } = await params
  if (!sections.includes(section)) notFound()
  redirect(`/-/${section === "dashboard" ? "overview" : section}`)
}
