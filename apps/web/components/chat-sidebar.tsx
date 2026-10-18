"use client"

import { createContext, useContext, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import {
  Loader2Icon,
  MessageCircleIcon,
  SendIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react"
import Link from "next/link"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

import { Button } from "@workspace/ui/components/button"
import {
  askManufacturerAssistant,
  type AiSource,
  type ManufacturerChatMessage,
} from "@/lib/firebase/manufacturing-ai"
import { addSourceCitationLinks, manufacturerSourceHref } from "@/lib/manufacturing-source"

type DisplayMessage = ManufacturerChatMessage & { sources?: AiSource[] }

const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="mb-2 mt-4 text-base font-semibold leading-snug first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-3 text-sm font-semibold leading-snug first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-3 text-sm font-semibold leading-snug first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-primary/40 pl-3 text-muted-foreground">{children}</blockquote>,
  table: ({ children }) => <div className="my-2 max-w-full overflow-x-auto rounded-md border"><table className="w-full min-w-max border-collapse text-left text-xs">{children}</table></div>,
  th: ({ children }) => <th className="border-b bg-muted/70 px-2 py-1.5 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-t px-2 py-1.5 align-top">{children}</td>,
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">{children}</pre>,
  code: ({ children }) => <code className="font-mono text-[0.9em]">{children}</code>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">{children}</a>,
  img: () => null,
}

function messageMarkdownComponents(sources: AiSource[], messageIndex: number): Components {
  return {
    ...markdownComponents,
    a: ({ children, href }) => {
      const citation = /^#source-(\d+)-(\d+)$/.exec(href ?? "")
      const sourceIndex = citation && Number(citation[1]) === messageIndex ? Number(citation[2]) : -1
      const source = sources[sourceIndex]
      return source ? (
        <a
          href={href}
          aria-label={`Sumber ${sourceIndex + 1}: ${source.label}`}
          title={`Sumber ${sourceIndex + 1}: ${source.label}`}
          className="relative -top-0.5 mx-0.5 inline-flex size-3.5 items-center justify-center rounded-full border border-border bg-muted/60 align-super text-[8px] font-semibold leading-none text-foreground no-underline transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
        >
          {sourceIndex + 1}
        </a>
      ) : (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">{children}</a>
      )
    },
  }
}

type ChatPanelContextValue = {
  isOpen: boolean
  setIsOpen: (isOpen: boolean) => void
}

const ChatPanelContext = createContext<ChatPanelContextValue | null>(null)

export function ChatPanelProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <ChatPanelContext.Provider value={{ isOpen, setIsOpen }}>
      {children}
    </ChatPanelContext.Provider>
  )
}

function useChatPanel() {
  const context = useContext(ChatPanelContext)
  if (!context) {
    throw new Error("Chat panel components must be inside ChatPanelProvider.")
  }
  return context
}

export function DashboardChatPanel() {
  const { isOpen, setIsOpen } = useChatPanel()
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const endOfMessages = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    endOfMessages.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages, sending])

  async function sendMessage() {
    const content = draft.trim()
    if (!content || sending) return

    const conversation = [...messages, { role: "user" as const, content }]
    setMessages(conversation)
    setDraft("")
    setError("")
    setSending(true)
    try {
      const reply = await askManufacturerAssistant(
        conversation.slice(-10).map(({ role, content: message }) => ({
          role,
          content: message,
        }))
      )
      setMessages([
        ...conversation,
        { role: "assistant", content: reply.answer, sources: reply.sources },
      ])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Asisten sedang tidak tersedia. Silakan coba lagi.")
    } finally {
      setSending(false)
    }
  }

  return (
    <aside
      aria-label="Panel obrolan asisten manufaktur"
      aria-hidden={!isOpen}
      inert={!isOpen}
      className={`relative flex h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${
        isOpen ? "w-[25rem] border-l border-sidebar-border" : "w-0 border-l-0"
      }`}
    >
      <section className="flex h-full w-[25rem] shrink-0 flex-col bg-background text-foreground">
        <header className="flex h-10 shrink-0 items-center justify-between border-b px-3">
          <span className="text-xs font-medium text-muted-foreground">
            Asisten manufaktur
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Tutup obrolan"
            title="Tutup obrolan"
            onClick={() => setIsOpen(false)}
          >
            <XIcon />
          </Button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-1" role="log" aria-live="polite" aria-label="Percakapan dengan asisten manufaktur">
            {!messages.length ? (
              <div className="flex h-full min-h-48 flex-col items-center justify-center px-4 text-center">
                <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <SparklesIcon className="size-5" />
                </span>
                <h2 className="text-base font-semibold">Tanya soal operasional pabrik</h2>
                <p className="mt-2 max-w-xs text-sm text-muted-foreground">
                  Tanyakan pesanan pelanggan, penawaran harga, kesiapan produksi, stok bahan, kapasitas mesin, atau proses kerja. Untuk informasi operasional, jawaban akan mengacu pada data di dashboard.
                </p>
              </div>
            ) : null}
            {messages.map((message, index) => (
              <article key={`${index}-${message.role}`} className={`animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none max-w-[92%] rounded-xl px-3 py-2 text-sm ${message.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "mr-auto border bg-muted/50"}`}>
                {message.role === "assistant" ? <div className="min-w-0 break-words leading-relaxed"><ReactMarkdown remarkPlugins={[remarkGfm]} components={messageMarkdownComponents(message.sources ?? [], index)}>{addSourceCitationLinks(message.content, message.sources ?? [], index)}</ReactMarkdown></div> : <p className="whitespace-pre-wrap break-words">{message.content}</p>}
                {message.sources?.length ? (
                  <nav aria-label="Sumber jawaban" className="mt-2 min-w-0 overflow-x-auto border-t border-current/10 pt-2">
                    <div className="flex w-max min-w-full flex-nowrap gap-2 pb-1">
                      {message.sources.map((source, sourceIndex) => (
                        <Link
                          key={source.id}
                          id={`source-${index}-${sourceIndex}`}
                          href={manufacturerSourceHref(source.kind)}
                          title={`Buka ${source.label}`}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                        >
                          <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold text-muted-foreground">{sourceIndex + 1}</span>
                          {source.label}
                        </Link>
                      ))}
                    </div>
                  </nav>
                ) : null}
              </article>
            ))}
            {sending ? (
              <div
                role="status"
                aria-label="Thinking"
                className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none mr-auto flex w-fit max-w-[92%] items-center gap-2 rounded-xl border bg-muted/50 px-3 py-2.5 text-sm font-medium text-foreground"
              >
                Thinking
                <Loader2Icon aria-hidden="true" className="size-3.5 animate-spin text-primary motion-reduce:animate-none" />
              </div>
            ) : null}
            <div ref={endOfMessages} />
            {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{error}</p> : null}
          </div>
        </div>
        <div className="shrink-0 border-t p-3">
          <form className="rounded-lg border bg-background p-2" onSubmit={(event) => { event.preventDefault(); void sendMessage() }}>
            <textarea
              aria-label="Pesan"
              value={draft}
              maxLength={2000}
              disabled={sending}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void sendMessage()
                }
              }}
              placeholder="Tulis pertanyaan tentang pesanan, produksi, stok, atau mesin…"
              className="min-h-20 w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                size="icon-sm"
                aria-label={sending ? "Mengirim pesan" : "Kirim pesan"}
                title={sending ? "Mengirim pesan" : "Kirim pesan"}
                disabled={sending || !draft.trim()}
              >
                {sending ? <Loader2Icon className="animate-spin motion-reduce:animate-none" /> : <SendIcon />}
              </Button>
            </div>
          </form>
        </div>
      </section>
    </aside>
  )
}

export function ChatSidebar() {
  const { isOpen, setIsOpen } = useChatPanel()

  return (
    <aside
      aria-label="Chat sidebar"
      className="sticky top-(--header-height) hidden h-full w-10 shrink-0 p-0 md:flex"
    >
      <div className="flex h-full w-full flex-col items-center bg-sidebar px-2 pt-2 text-sidebar-foreground">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={isOpen ? "Tutup obrolan" : "Buka obrolan"}
          aria-expanded={isOpen}
          title={isOpen ? "Tutup obrolan" : "Buka obrolan"}
          className="size-6 justify-center rounded-full [&_svg]:size-4"
          onClick={() => setIsOpen(!isOpen)}
        >
          <MessageCircleIcon />
        </Button>
      </div>
    </aside>
  )
}
