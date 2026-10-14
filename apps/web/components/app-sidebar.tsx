"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ActivityIcon,
  BoxesIcon,
  ChartNoAxesCombinedIcon,
  ClipboardListIcon,
  FileTextIcon,
  GaugeIcon,
  LayoutDashboardIcon,
  PackageIcon,
  Settings2Icon,
  UsersIcon,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar"

const groups = [
  {
    label: "Workspace",
    items: [
      { title: "Overview", url: "/-/overview", icon: LayoutDashboardIcon },
      { title: "RFQ Inbox", url: "/-/rfqs", icon: ClipboardListIcon },
      { title: "Quotations", url: "/-/quotations", icon: FileTextIcon },
      { title: "Orders", url: "/-/orders", icon: PackageIcon },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Production", url: "/-/production", icon: ActivityIcon },
      { title: "Materials", url: "/-/materials", icon: BoxesIcon },
      { title: "Equipment", url: "/-/equipment", icon: GaugeIcon },
    ],
  },
  {
    label: "Management",
    items: [
      { title: "Customers", url: "/-/customers", icon: UsersIcon },
      { title: "Analytics", url: "/-/analytics", icon: ChartNoAxesCombinedIcon },
      { title: "Settings", url: "/-/settings", icon: Settings2Icon },
    ],
  },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()

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
    </Sidebar>
  )
}
