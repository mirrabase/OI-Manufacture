import { AppSidebar } from "@/components/app-sidebar"
import { ChatSidebar } from "@/components/chat-sidebar"
import { SiteHeader } from "@/components/site-header"
import {
  SidebarInset,
  SidebarProvider,
} from "@workspace/ui/components/sidebar"

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <SidebarProvider
      className="h-svh min-h-0 flex-col overflow-hidden"
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "48px",
        } as React.CSSProperties
      }
    >
      <SiteHeader />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AppSidebar variant="inset" collapsible="icon" />
        <SidebarInset className="md:my-2 md:mx-0">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="@container/main flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
              {children}
            </div>
          </div>
        </SidebarInset>
        <ChatSidebar />
      </div>
    </SidebarProvider>
  )
}
