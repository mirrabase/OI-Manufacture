export function manufacturerSourceHref(kind: string) {
  if (kind === "request") return "/-/requests"
  if (kind === "material" || kind === "purchase order") return "/-/materials"
  if (kind === "equipment") return "/-/equipment"
  if (kind === "pricing settings") return "/-/settings"
  return "/-/production"
}

export function addSourceCitationLinks(content: string, sources: { id: string }[], messageIndex: number) {
  return sources.reduce(
    (answer, source, index) => answer.replaceAll(`[${source.id}]`, `[${index + 1}](#source-${messageIndex}-${index})`),
    content
  )
}
