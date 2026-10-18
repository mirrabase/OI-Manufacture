export type Usage = {
  inputTokens?: number
  outputTokens?: number
  thoughtsTokens?: number
  [key: string]: unknown
}
export type Budget = {
  calls: number
  tools: number
  fallbackUsed: boolean
  deadline: number
  usage: Usage[]
}
export const createBudget = (): Budget => ({
  calls: 0,
  tools: 0,
  fallbackUsed: false,
  deadline: Date.now() + 45_000,
  usage: [],
})
export function transientProviderError(error: unknown) {
  const e = error as {
    status?: number | string
    code?: number | string
    cause?: { status?: number }
    name?: string
  }
  return [
    429,
    500,
    502,
    503,
    504,
    "RESOURCE_EXHAUSTED",
    "UNAVAILABLE",
    "DEADLINE_EXCEEDED",
    "ECONNRESET",
    "ETIMEDOUT",
  ].includes(e?.status ?? e?.code ?? e?.cause?.status ?? "")
}
export async function boundedGenerate<T extends { usage?: Usage }>(
  budget: Budget,
  generate: (fallback: boolean, signal: AbortSignal) => Promise<T>
): Promise<T> {
  while (true) {
    if (budget.calls >= 4 || Date.now() >= budget.deadline)
      throw new Error("Assistant generation budget exhausted")
    budget.calls++
    try {
      const response = await generate(
        budget.fallbackUsed,
        AbortSignal.timeout(Math.max(1, budget.deadline - Date.now()))
      )
      budget.usage.push(response.usage ?? {})
      return response
    } catch (error) {
      budget.usage.push({ unavailable: true })
      if (budget.fallbackUsed || !transientProviderError(error)) throw error
      budget.fallbackUsed = true
    }
  }
}
export function consumeTool(budget: Budget) {
  if (++budget.tools > 8 || Date.now() >= budget.deadline)
    throw new Error("Assistant tool budget exhausted")
}
export function boundedPrompt(system: string, prompt: string) {
  if (system.length + prompt.length > 24_000)
    throw new Error("Assistant context budget exhausted")
  return prompt
}
