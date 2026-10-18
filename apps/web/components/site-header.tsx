"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import { SidebarTrigger } from "@workspace/ui/components/sidebar"
import {
  BellIcon,
  Building2Icon,
  CheckIcon,
  ChevronsUpDownIcon,
  SearchIcon,
  ZapIcon,
} from "lucide-react"

import { NavUser } from "@/components/nav-user"
import { useManufacturerOrganization } from "@/components/manufacturing/organization-provider"
import { manufacturerAuth } from "@/lib/firebase/client"
import {
  listenToManufacturerNotifications,
  markManufacturerNotificationRead,
  type ManufacturerNotification,
} from "@/lib/firebase/notifications"

export function SiteHeader() {
  const router = useRouter()
  const organization = useManufacturerOrganization()
  const signedInUser = manufacturerAuth.currentUser
  const [notifications, setNotifications] = useState<ManufacturerNotification[]>([])
  const [notificationsLoading, setNotificationsLoading] = useState(true)
  const [notificationError, setNotificationError] = useState("")
  const [search, setSearch] = useState("")
  // shortcut: plan state is not stored yet; wire this label when subscription data exists.
  const plan = "FREE"
  const unreadCount = notifications.filter((notification) => !notification.readAt).length

  useEffect(() => {
    if (!signedInUser?.uid) {
      setNotifications([])
      setNotificationsLoading(false)
      return
    }
    setNotificationsLoading(true)
    return listenToManufacturerNotifications(
      organization.id,
      signedInUser.uid,
      (rows) => {
        setNotifications(rows)
        setNotificationsLoading(false)
        setNotificationError("")
      },
      (error) => {
        setNotificationsLoading(false)
        setNotificationError(error.message)
      }
    )
  }, [organization.id, signedInUser?.uid])

  function openNotification(notification: ManufacturerNotification) {
    if (!notification.readAt) {
      void markManufacturerNotificationRead(notification.id).catch((error: unknown) => {
        setNotificationError(error instanceof Error ? error.message : "Could not mark notification as read.")
      })
    }
    router.push(`/-/requests?rfq=${encodeURIComponent(notification.rfqId)}`)
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = search.trim()
    window.dispatchEvent(new CustomEvent("dashboard:search", { detail: value }))
    router.push(`/-/requests${value ? `?search=${encodeURIComponent(value)}` : ""}`)
  }

  return (
    <header className="sticky top-0 z-30 grid h-(--header-height) shrink-0 grid-cols-[1fr_minmax(0,36rem)_1fr] items-center gap-4 bg-sidebar pr-2 pl-3 text-sidebar-foreground">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ZapIcon
            className="size-5 shrink-0 fill-primary text-primary"
            aria-hidden="true"
          />
          <span className="text-muted-foreground/60" aria-hidden="true">
            /
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  className="h-8 min-w-0 gap-2 px-2 font-semibold data-[popup-open]:bg-muted"
                  aria-label={`Organization: ${organization.name}, plan: ${plan}`}
                />
              }
            >
              <span className="truncate">{organization.name}</span>
              <Badge
                variant="outline"
                className="h-[18px] rounded-md px-1.5 text-xs font-semibold leading-none tracking-wide text-muted-foreground"
              >
                {plan}
              </Badge>
              <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="font-semibold">
                  Organization
                </DropdownMenuLabel>
                <DropdownMenuItem>
                  <Building2Icon />
                  <span className="truncate">{organization.name}</span>
                  <CheckIcon className="ml-auto text-muted-foreground" />
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="font-semibold">
                  Plan
                </DropdownMenuLabel>
                <div className="flex items-center justify-between px-2 py-1.5 text-sm">
                  <span className="text-muted-foreground">Current plan</span>
                  <Badge
                    variant="outline"
                    className="h-[18px] rounded-md px-1.5 text-xs font-semibold leading-none tracking-wide text-muted-foreground"
                  >
                    {plan}
                  </Badge>
                </div>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <SidebarTrigger />
      </div>
      <form role="search" onSubmit={submitSearch} className="relative mx-auto w-full max-w-md">
        <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search requests, customers, or orders"
          type="search"
          placeholder="Search requests, customers, or orders…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-8 bg-background pl-9"
        />
        <button type="submit" className="sr-only">Search</button>
      </form>
      <div className="flex min-w-0 items-center justify-end gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="relative"
                aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
                title="Notifications"
              />
            }
          >
            <BellIcon />
            {unreadCount ? <span aria-hidden="true" className="absolute -top-1 -right-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none text-primary-foreground">{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center justify-between gap-3">
                <span>Notifications</span>
                {unreadCount ? <span className="text-xs font-normal text-muted-foreground">{unreadCount} unread</span> : null}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {notificationError ? <p role="alert" className="px-2 py-2 text-xs text-destructive">Notification issue: {notificationError}</p> : null}
            {notificationsLoading ? <p role="status" className="px-2 py-3 text-sm text-muted-foreground">Loading notifications…</p> : null}
            {!notificationsLoading && !notificationError && notifications.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">You’re all caught up.</p> : null}
            {notifications.map((notification) => {
              const createdAt = new Date(notification.createdAt)
              return <DropdownMenuItem key={notification.id} onClick={() => openNotification(notification)} className="items-start whitespace-normal px-2 py-2">
                <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${notification.readAt ? "bg-transparent" : "bg-primary"}`} />
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate font-medium">{notification.title}</span>
                    <time className="shrink-0 text-[11px] text-muted-foreground" dateTime={createdAt.toISOString()}>{createdAt.toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{notification.message}</span>
                  <span className="truncate text-[11px] text-muted-foreground">{notification.rfqId}</span>
                </span>
              </DropdownMenuItem>
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <NavUser
          user={{
            name: signedInUser?.displayName || signedInUser?.email?.split("@")[0] || organization.name,
            email: signedInUser?.email ?? "",
            avatar: signedInUser?.photoURL ?? undefined,
          }}
        />
      </div>
    </header>
  )
}
