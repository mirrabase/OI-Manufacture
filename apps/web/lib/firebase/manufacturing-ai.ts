import { httpsCallable } from "firebase/functions"
import { manufacturerFunctions } from "./client"

export type ManufacturerChatMessage = {
  role: "user" | "assistant"
  content: string
}

export type AiSource = {
  id: string
  kind: string
  label: string
}

export type ManufacturerChatReply = {
  answer: string
  answerType: string
  sources: AiSource[]
}

export type ManufacturerInsight = {
  id: string
  priority: "high" | "medium" | "low"
  title: string
  reason: string
  recommendation: string
  prevention: string
  sources: AiSource[]
}

export type ManufacturerOverview = {
  generatedAt: number
  signalCount: number
  summary: string
  insights: ManufacturerInsight[]
}

export async function askManufacturerAssistant(messages: ManufacturerChatMessage[]) {
  const call = httpsCallable<
    { messages: ManufacturerChatMessage[] },
    ManufacturerChatReply
  >(manufacturerFunctions, "manufacturerChat")
  return (await call({ messages })).data
}

export async function getManufacturerOverview() {
  const call = httpsCallable<Record<string, never>, ManufacturerOverview>(
    manufacturerFunctions,
    "manufacturerOverview"
  )
  return (await call({})).data
}
