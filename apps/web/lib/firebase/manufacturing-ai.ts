import { callApi } from "./api"

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
  return callApi<ManufacturerChatReply>("ai/chat", { messages }, true)
}

export async function getManufacturerOverview() {
  return callApi<ManufacturerOverview>("ai/overview", {}, true)
}
