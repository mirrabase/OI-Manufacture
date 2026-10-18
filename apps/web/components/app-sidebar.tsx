"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BoxesIcon,
  ClipboardListIcon,
  GaugeIcon,
  LayoutDashboardIcon,
  LanguagesIcon,
  SunMoonIcon,
  Settings2Icon,
  UsersIcon,
} from "lucide-react"
import { useTheme } from "next-themes"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { useDashboardLanguage } from "@/components/manufacturing/dashboard-language-provider"

const groups = [
  {
    label: "Workspace",
    items: [
      { title: "Overview", url: "/-/overview", icon: LayoutDashboardIcon },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Requests", url: "/-/requests", icon: ClipboardListIcon },
      { title: "Materials", url: "/-/materials", icon: BoxesIcon },
      { title: "Equipment", url: "/-/equipment", icon: GaugeIcon },
    ],
  },
  {
    label: "Management",
    items: [
      { title: "Customers", url: "/-/customers", icon: UsersIcon },
    ],
  },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const { language, changeLanguage } = useDashboardLanguage()
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map(({ title, url, icon: Icon }) => (
                <SidebarMenuItem key={url}>
                  <SidebarMenuButton
                    tooltip={title}
                    isActive={pathname === url || pathname.startsWith(`${url}/`)}
                    render={<Link href={url} />}
                  >
                    <Icon />
                    <span>{title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="mt-auto border-t group-data-[collapsible=icon]:px-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Toggle theme (D)" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
              <SunMoonIcon />
              <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span>Toggle theme</span>
                <kbd className="rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">D</kbd>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <Select
              value={language}
              items={{ en: "English", id: "Bahasa" }}
              onValueChange={(value) => changeLanguage(String(value ?? "en") as "en" | "id")}
            >
              <SelectTrigger
                aria-label="Language"
                size="sm"
                className="h-9 w-full cursor-pointer justify-between rounded-none border-0 bg-transparent px-2 py-0 shadow-none hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-2! group-data-[collapsible=icon]:[&>svg:last-child]:hidden"
              >
                <LanguagesIcon className="size-4 shrink-0 text-sidebar-foreground" />
                <SelectValue className="text-sm font-medium group-data-[collapsible=icon]:hidden" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="id">Bahasa</SelectItem>
              </SelectContent>
            </Select>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Settings"
              isActive={pathname === "/-/settings" || pathname.startsWith("/-/settings/")}
              render={<Link href="/-/settings" />}
            >
              <Settings2Icon />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
