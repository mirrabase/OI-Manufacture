import Link from "next/link"

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

export function generateStaticParams() {
  return sections.map((section) => ({ section }))
}

export default async function LegacyDashboardSection({
  params,
}: {
  params: Promise<{ section: string }>
}) {
  const { section } = await params
  const destination = section === "dashboard" ? "/-/overview" : `/-/${section}`
  return (
    <main className="p-6 text-sm">
      This workspace moved to <Link className="underline" href={destination}>{destination}</Link>.
    </main>
  )
}
