import { MessageCircleIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

export function ChatSidebar() {
  return (
    <aside
      aria-label="Chat sidebar"
      className="sticky top-(--header-height) hidden h-full w-10 shrink-0 p-0 md:flex"
    >
      <div className="flex h-full w-full flex-col items-center gap-2 bg-sidebar px-2 pt-2 text-sidebar-foreground">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Chat"
          title="Chat"
          className="size-6 justify-center rounded-full [&_svg]:size-4"
        >
          <MessageCircleIcon />
        </Button>
      </div>
    </aside>
  )
}
