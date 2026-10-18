export function manufacturerSourceHref(kind: string) {
  if (kind.startsWith("analytics:"))
    return manufacturerSourceHref(
      kind.slice(10) === "customers"
        ? "customer"
        : ((
            {
              requests: "request",
              materials: "material",
              purchasing: "purchase order",
              pricing: "pricing settings",
            } as Record<string, string>
          )[kind.slice(10)] ?? kind.slice(10))
    )
  if (kind === "customer") return "/-/customers"
  if (["organization settings", "membership"].includes(kind))
    return "/-/settings"
  if (kind === "inventory movement") return "/-/materials"
  if (["payment", "notification"].includes(kind)) return "/-/requests"
  if (kind === "request") return "/-/requests"
  if (kind === "material" || kind === "purchase order") return "/-/materials"
  if (kind === "equipment") return "/-/equipment"
  if (kind === "pricing settings") return "/-/settings"
  return "/-/production"
}

export function addSourceCitationLinks(
  content: string,
  sources: { id: string }[],
  messageIndex: number
) {
  return sources.reduce(
    (answer, source, index) =>
      answer.replaceAll(
        `[${source.id}]`,
        `[${index + 1}](#source-${messageIndex}-${index})`
      ),
    content
  )
}
