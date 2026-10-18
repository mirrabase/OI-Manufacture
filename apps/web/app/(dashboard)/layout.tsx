import { AppSidebar } from "@/components/app-sidebar"
import {
  ChatPanelProvider,
  ChatSidebar,
  DashboardChatPanel,
} from "@/components/chat-sidebar"
import { DashboardBreadcrumbs } from "@/components/dashboard-breadcrumbs"
import { SiteHeader } from "@/components/site-header"
import { ManufacturerOrganizationProvider } from "@/components/manufacturing/organization-provider"
import { DashboardLanguageProvider } from "@/components/manufacturing/dashboard-language-provider"
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
    <ManufacturerOrganizationProvider>
      <DashboardLanguageProvider>
        <SidebarProvider
          className="h-svh min-h-0 flex-col overflow-hidden"
          style={
            {
              "--sidebar-width": "240px",
              "--header-height": "48px",
            } as React.CSSProperties
          }
        >
          <SiteHeader />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <AppSidebar variant="inset" collapsible="icon" />
            <ChatPanelProvider>
              <SidebarInset className="min-w-0 md:mb-2 md:mx-0">
                <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                  <div className="@container/main flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto">
                    <DashboardBreadcrumbs />
                    {children}
                  </div>
                  <DashboardChatPanel />
                </div>
              </SidebarInset>
              <ChatSidebar />
            </ChatPanelProvider>
          </div>
        </SidebarProvider>
      </DashboardLanguageProvider>
    </ManufacturerOrganizationProvider>
  )
}
