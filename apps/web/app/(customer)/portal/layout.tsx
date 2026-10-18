import Link from "next/link"
import { BoxIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"

export default function CustomerPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/portal" className="flex items-center gap-2 font-semibold"><span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><BoxIcon className="size-4" /></span>OI Manufacture</Link>
          <nav aria-label="Customer portal" className="flex items-center gap-1 text-sm">
            <Link className="rounded-md px-3 py-2 hover:bg-muted" href="/portal">Home</Link>
            <Link className="rounded-md px-3 py-2 hover:bg-muted" href="/portal/quotes">Quotations</Link>
            <Link className="rounded-md px-3 py-2 hover:bg-muted" href="/portal/orders">Orders</Link>
          </nav>
          <Button render={<Link href="/portal/quotes/new" />}>Upload a model</Button>
        </div>
      </header>
      {children}
      <footer className="mx-auto max-w-6xl px-4 py-8 text-xs text-muted-foreground sm:px-6">OI Manufacture · Customer workspace</footer>
    </div>
  )
}
