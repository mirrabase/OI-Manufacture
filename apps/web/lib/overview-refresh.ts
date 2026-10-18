export const OVERVIEW_TTL_MS = 30 * 60_000
export const OVERVIEW_RETRY_MS = 60_000

export function scheduleOverviewRefresh({
  load,
  visibility = document,
  nextAt: initialNextAt = 0,
}: {
  load: () => Promise<number | null>
  nextAt?: number
  visibility?: Pick<
    Document,
    "hidden" | "addEventListener" | "removeEventListener"
  >
}) {
  let stopped = false
  let loading = false
  let nextAt = initialNextAt
  let timer: ReturnType<typeof setTimeout> | undefined
  const check = async () => {
    clearTimeout(timer)
    if (stopped || visibility.hidden || loading) return
    if (Date.now() < nextAt) {
      timer = setTimeout(() => void check(), nextAt - Date.now())
      return
    }
    loading = true
    try {
      const generatedAt = await load()
      nextAt =
        generatedAt === null
          ? Date.now() + OVERVIEW_RETRY_MS
          : Math.max(Date.now() + 1000, generatedAt + OVERVIEW_TTL_MS)
    } catch {
      nextAt = Date.now() + OVERVIEW_RETRY_MS
    } finally {
      loading = false
      if (!stopped && !visibility.hidden)
        timer = setTimeout(() => void check(), Math.max(0, nextAt - Date.now()))
    }
  }
  const visible = () => {
    void check()
  }
  visibility.addEventListener("visibilitychange", visible)
  void check()
  return () => {
    stopped = true
    clearTimeout(timer)
    visibility.removeEventListener("visibilitychange", visible)
  }
}
