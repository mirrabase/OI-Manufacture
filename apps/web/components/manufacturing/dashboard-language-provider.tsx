"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { DASHBOARD_INDONESIAN } from "./dashboard-translations"

type DashboardLanguage = "en" | "id"
type LanguageContextValue = {
  language: DashboardLanguage
  changeLanguage: (language: DashboardLanguage) => void
}

const LANGUAGE_KEY = "oi-dashboard-language"
const LanguageContext = createContext<LanguageContextValue | null>(null)
const translatedTextNodes = new WeakMap<Text, { original: string; translated: string }>()
const translatedAttributes = new WeakMap<Element, Map<string, { original: string; translated: string }>>()
const translatableAttributes = ["aria-label", "aria-description", "placeholder", "title"]

function preserveSpace(source: string, translated: string) {
  const leading = source.match(/^\s*/)?.[0] ?? ""
  const trailing = source.match(/\s*$/)?.[0] ?? ""
  return `${leading}${translated}${trailing}`
}

function translateDashboard(root: HTMLElement, language: DashboardLanguage) {
  const ignoredText = "script, style, noscript, input, textarea, code, pre, [contenteditable='true'], [data-translation-ignore]"
  const ignoredElement = "script, style, noscript, code, pre, [contenteditable='true'], [data-translation-ignore]"
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const text = node as Text
    const parent = text.parentElement
    if (!parent || parent.closest(ignoredText)) continue

    const current = text.nodeValue ?? ""
    const previous = translatedTextNodes.get(text)
    if (language === "en") {
      if (previous && current === previous.translated) text.nodeValue = previous.original
      translatedTextNodes.delete(text)
      continue
    }
    if (previous && current === previous.translated) continue

    const translated = Object.hasOwn(DASHBOARD_INDONESIAN, current.trim()) ? DASHBOARD_INDONESIAN[current.trim()] : undefined
    if (translated) {
      const value = preserveSpace(current, translated)
      if (value !== current) {
        translatedTextNodes.set(text, { original: current, translated: value })
        text.nodeValue = value
      }
    } else {
      translatedTextNodes.delete(text)
    }
  }

  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (element.matches(ignoredElement)) continue
    for (const attribute of translatableAttributes) {
      const current = element.getAttribute(attribute)
      if (current === null) continue
      const records = translatedAttributes.get(element) ?? new Map()
      const previous = records.get(attribute)
      if (language === "en") {
        if (previous && current === previous.translated) element.setAttribute(attribute, previous.original)
        records.delete(attribute)
        continue
      }
      if (previous && current === previous.translated) continue
      const translated = Object.hasOwn(DASHBOARD_INDONESIAN, current.trim()) ? DASHBOARD_INDONESIAN[current.trim()] : undefined
      if (translated) {
        const value = preserveSpace(current, translated)
        if (value !== current) {
          records.set(attribute, { original: current, translated: value })
          element.setAttribute(attribute, value)
        }
      } else {
        records.delete(attribute)
      }
      if (records.size) translatedAttributes.set(element, records)
      else translatedAttributes.delete(element)
    }
  }
}

export function useDashboardLanguage() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error("Dashboard language context is unavailable.")
  return context
}

export function DashboardLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<DashboardLanguage>("en")

  const changeLanguage = useCallback((nextLanguage: DashboardLanguage) => {
    setLanguage(nextLanguage)
    try { localStorage.setItem(LANGUAGE_KEY, nextLanguage) } catch { /* The current page still uses the selected language. */ }
  }, [])

  useEffect(() => {
    try {
      if (localStorage.getItem(LANGUAGE_KEY) === "id") setLanguage("id")
    } catch { /* Default to English when persistent storage is unavailable. */ }
  }, [])

  useEffect(() => {
    const root = document.body
    const apply = () => translateDashboard(root, language)
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(root, { attributes: true, attributeFilter: translatableAttributes, childList: true, characterData: true, subtree: true })
    return () => observer.disconnect()
  }, [language])

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const value = useMemo(() => ({ language, changeLanguage }), [language, changeLanguage])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}
