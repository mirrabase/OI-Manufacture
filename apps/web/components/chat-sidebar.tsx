"use client"

import { createContext, useContext, useState } from "react"
import type { ReactNode } from "react"
import {
  BotIcon,
  MessageCircleIcon,
  SendIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"

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

  return (
    <aside
      aria-label="Workspace chat panel"
      aria-hidden={!isOpen}
      inert={!isOpen}
      className={`relative flex h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${
        isOpen ? "w-[25rem] border-l border-sidebar-border" : "w-0 border-l-0"
      }`}
    >
      <section className="flex h-full w-[25rem] shrink-0 flex-col bg-background text-foreground">
        <header className="flex h-10 shrink-0 items-center justify-between border-b px-3">
          <span className="text-xs font-medium text-muted-foreground">
            Workspace assistant
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close chat"
            title="Close chat"
            onClick={() => setIsOpen(false)}
          >
            <XIcon />
          </Button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
          <div className="mb-3 flex items-center gap-2 border-b pb-3">
            <span className="flex size-8 items-center justify-center rounded-full bg-muted">
              <BotIcon className="size-4" />
            </span>
            <span className="text-sm font-semibold">Workspace Chat</span>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
            <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <SparklesIcon className="size-5" />
            </span>
            <h2 className="text-base font-semibold">How can I help?</h2>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground">
              Chat for your workspace will be available here.
            </p>
          </div>
        </div>
        <div className="shrink-0 border-t p-3">
          <div className="rounded-lg border bg-background p-2">
            <textarea
              aria-label="Chat message"
              disabled
              placeholder="Chat integration is not connected yet"
              className="min-h-20 w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            />
            <div className="flex justify-end">
              <Button
                type="button"
                size="icon-sm"
                aria-label="Send message"
                title="Send message"
                disabled
              >
                <SendIcon />
              </Button>
            </div>
          </div>
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
          aria-label={isOpen ? "Close chat" : "Open chat"}
          aria-expanded={isOpen}
          title={isOpen ? "Close chat" : "Open chat"}
          className="size-6 justify-center rounded-full [&_svg]:size-4"
          onClick={() => setIsOpen(!isOpen)}
        >
          <MessageCircleIcon />
        </Button>
      </div>
    </aside>
  )
}
