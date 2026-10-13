import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { SidebarTrigger } from "@workspace/ui/components/sidebar"
import { BellIcon, CommandIcon, SearchIcon } from "lucide-react"

import { NavUser } from "@/components/nav-user"

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 grid h-(--header-height) shrink-0 grid-cols-[1fr_minmax(0,36rem)_1fr] items-center gap-4 bg-sidebar pr-2 pl-3 text-sidebar-foreground">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <CommandIcon className="size-5 shrink-0" />
          <span className="truncate text-base font-semibold">Acme Inc.</span>
        </div>
        <SidebarTrigger />
      </div>
      <div className="relative mx-auto w-full max-w-md">
        <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search"
          placeholder="Search..."
          className="h-8 bg-background pl-9"
        />
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Notifications"
          title="Notifications"
        >
          <BellIcon />
        </Button>
        <NavUser
          user={{
            name: "shadcn",
            email: "m@example.com",
            avatar: "/avatars/shadcn.jpg",
          }}
        />
      </div>
    </header>
  )
}
