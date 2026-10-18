import Link from "next/link"
import { Button } from "@workspace/ui/components/button"

export default function PortalLoginPage() {
  return <main className="mx-auto grid min-h-[65svh] max-w-md content-center gap-5 px-4 text-center"><div><p className="text-sm font-medium text-primary">Customer portal</p><h1 className="mt-2 text-2xl font-semibold">No account needed</h1><p className="mt-2 text-sm text-muted-foreground">Upload a model and leave your contact details to request a quotation.</p></div><Button render={<Link href="/portal/quotes/new" />}>Upload a 3D model</Button></main>
}
