"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowDownIcon, ArrowUpIcon, SearchIcon } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { formatIDR, type CustomerRFQ } from "@/lib/customer-portal"
import { listenToManufacturerRequests } from "@/lib/firebase/customer-requests"

type RequestRecord = CustomerRFQ & { id: string }
type CustomerRecord = {
  id: string
  name: string
  email: string
  requests: RequestRecord[]
  unpaidQuotes: number
  paidOrders: number
  paidValue: number
  lastRequestAt: number
}
type SortKey = "Customer" | "Requests" | "Paid value" | "Last request"

const formatDate = (timestamp: number) =>
  new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })

function groupCustomers(requests: RequestRecord[]): CustomerRecord[] {
  const groups = new Map<string, CustomerRecord>()
  for (const request of requests) {
    const email = request.customer.email.trim().toLowerCase()
    const id = email
      ? `email:${email}`
      : `uid:${request.ownerUid || request.id}`
    const current = groups.get(id) ?? {
      id,
      name: request.customer.name || "Unnamed customer",
      email: request.customer.email,
      requests: [],
      unpaidQuotes: 0,
      paidOrders: 0,
      paidValue: 0,
      lastRequestAt: 0,
    }
    current.requests.push(request)
    if (request.quoteTotal) {
      if (request.paymentStatus === "Paid") {
        current.paidOrders++
        current.paidValue += request.quoteTotal
      } else {
        current.unpaidQuotes++
      }
    }
    current.lastRequestAt = Math.max(
      current.lastRequestAt,
      request.submittedAt ?? request.createdAt
    )
    groups.set(id, current)
  }
  return [...groups.values()]
    .map((customer) => ({
      ...customer,
      requests: customer.requests.sort(
        (left, right) =>
          (right.submittedAt ?? right.createdAt) -
          (left.submittedAt ?? left.createdAt)
      ),
    }))
    .sort((left, right) => right.lastRequestAt - left.lastRequestAt)
}

export function CustomerWorkspace() {
  const [requests, setRequests] = useState<RequestRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [stage, setStage] = useState("all")
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>(
    { key: "Last request", direction: "desc" }
  )
  const [selectedId, setSelectedId] = useState("")

  useEffect(
    () =>
      listenToManufacturerRequests(
        (rows) => {
          setRequests(rows)
          setLoading(false)
          setError("")
        },
        (cause) => {
          setError(cause.message)
          setLoading(false)
        }
      ),
    []
  )

  const customers = useMemo(() => groupCustomers(requests), [requests])
  const unpaidQuoteCount = requests.filter(
    (request) => request.quoteTotal && request.paymentStatus !== "Paid"
  ).length
  const tabs = [
    {
      value: "all",
      label: "All customers",
      matches: (_customer: CustomerRecord) => true,
    },
    {
      value: "returning",
      label: "Returning",
      matches: (customer: CustomerRecord) => customer.requests.length > 1,
    },
    {
      value: "payment",
      label: "Awaiting payment",
      matches: (customer: CustomerRecord) => customer.unpaidQuotes > 0,
    },
  ]
  const selectedTab = tabs.find((tab) => tab.value === stage) ?? tabs[0]!
  const visibleCustomers = customers
    .filter(
      (customer) =>
        selectedTab.matches(customer) &&
        `${customer.name} ${customer.email} ${customer.requests.map((request) => `${request.id} ${request.product}`).join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase())
    )
    .sort((left, right) => {
      const a =
        sort.key === "Customer"
          ? left.name
          : sort.key === "Requests"
            ? left.requests.length
            : sort.key === "Paid value"
              ? left.paidValue
              : left.lastRequestAt
      const b =
        sort.key === "Customer"
          ? right.name
          : sort.key === "Requests"
            ? right.requests.length
            : sort.key === "Paid value"
              ? right.paidValue
              : right.lastRequestAt
      const comparison =
        typeof a === "string" && typeof b === "string"
          ? a.localeCompare(b)
          : Number(a) - Number(b)
      return sort.direction === "asc" ? comparison : -comparison
    })
  const selected = customers.find((customer) => customer.id === selectedId)

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 pb-6 md:px-6">
      <div>
        <h1 className="text-xl font-semibold">Customers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Customer profiles and order history from submitted requests.
        </p>
      </div>
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading customers…
        </p>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load customers: {error}
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Total customers", customers.length],
              ["Submitted requests", requests.length],
              [
                "Returning customers",
                customers.filter((customer) => customer.requests.length > 1)
                  .length,
              ],
              ["Unpaid quotations", unpaidQuoteCount],
            ].map(([label, value]) => (
              <Card key={label} size="sm">
                <CardHeader>
                  <CardDescription>{label}</CardDescription>
                  <CardTitle>{value}</CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>
          <Tabs
            value={stage}
            onValueChange={(value) => setStage(String(value ?? "all"))}
            className="gap-3"
          >
            <TabsList
              variant="line"
              className="h-auto min-h-10 w-full flex-wrap justify-start gap-x-1 gap-y-0 overflow-visible rounded-none border-b p-0"
            >
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="flex-none gap-1.5 px-3"
                >
                  {tab.label}
                  <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
                    {customers.filter(tab.matches).length}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={stage} className="gap-3">
              <div className="flex w-full min-w-0 items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Search customers"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search customers…"
                    className="h-9 pl-8"
                  />
                </div>
                <Select
                  value={sort.key}
                  onValueChange={(value) =>
                    setSort((current) => ({
                      ...current,
                      key: String(value ?? "Last request") as SortKey,
                    }))
                  }
                >
                  <SelectTrigger
                    aria-label="Sort customers"
                    className="h-9 w-40 shrink-0"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      [
                        "Last request",
                        "Customer",
                        "Requests",
                        "Paid value",
                      ] as const
                    ).map((key) => (
                      <SelectItem key={key} value={key}>
                        {key}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="shrink-0"
                  aria-label={
                    sort.direction === "desc"
                      ? "Sort descending"
                      : "Sort ascending"
                  }
                  title={
                    sort.direction === "desc"
                      ? "Sort descending"
                      : "Sort ascending"
                  }
                  onClick={() =>
                    setSort((current) => ({
                      ...current,
                      direction: current.direction === "desc" ? "asc" : "desc",
                    }))
                  }
                >
                  {sort.direction === "desc" ? (
                    <ArrowDownIcon />
                  ) : (
                    <ArrowUpIcon />
                  )}
                </Button>
              </div>
              <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
                {visibleCustomers.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    {requests.length
                      ? "No customers match this view."
                      : "Customers appear here after they submit a request."}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {[
                          "Customer",
                          "Email",
                          "Requests",
                          "Unpaid quotations",
                          "Paid orders",
                          "Paid value",
                          "Last request",
                        ].map((label) => (
                          <TableHead key={label}>{label}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleCustomers.map((customer) => (
                        <TableRow key={customer.id}>
                          <TableCell className="max-w-56 truncate">
                            <button
                              type="button"
                              className="truncate text-left font-medium underline-offset-4 hover:underline"
                              onClick={() => setSelectedId(customer.id)}
                            >
                              {customer.name}
                            </button>
                          </TableCell>
                          <TableCell className="max-w-64 truncate">
                            {customer.email}
                          </TableCell>
                          <TableCell>{customer.requests.length}</TableCell>
                          <TableCell>{customer.unpaidQuotes}</TableCell>
                          <TableCell>{customer.paidOrders}</TableCell>
                          <TableCell>{formatIDR(customer.paidValue)}</TableCell>
                          <TableCell>
                            {formatDate(customer.lastRequestAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
      {selected ? (
        <Sheet
          open
          onOpenChange={(open) => {
            if (!open) setSelectedId("")
          }}
        >
          <SheetContent className="overflow-y-auto data-[side=right]:w-[min(96vw,42rem)] data-[side=right]:sm:max-w-2xl">
            <SheetHeader>
              <SheetTitle>{selected.name}</SheetTitle>
              <SheetDescription>{selected.email}</SheetDescription>
            </SheetHeader>
            <div className="grid gap-4 px-4 pb-6">
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Requests</p>
                  <p className="font-semibold">{selected.requests.length}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Paid orders</p>
                  <p className="font-semibold">{selected.paidOrders}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Paid value</p>
                  <p className="font-semibold">
                    {formatIDR(selected.paidValue)}
                  </p>
                </div>
              </div>
              <h2 className="text-sm font-semibold">Request history</h2>
              {selected.requests.map((request) => (
                <div
                  key={request.id}
                  className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto] sm:items-start"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {request.product}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {request.id} ·{" "}
                      {formatDate(request.submittedAt ?? request.createdAt)} ·{" "}
                      {request.requirements.quantity} units
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        request.paymentStatus === "Paid"
                          ? "default"
                          : "secondary"
                      }
                    >
                      {request.status}
                      {request.quoteTotal
                        ? ` · ${request.paymentStatus ?? "Unpaid"}`
                        : ""}
                    </Badge>
                    {request.quoteTotal ? (
                      <span className="text-sm tabular-nums">
                        {formatIDR(request.quoteTotal)}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        No quotation
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </main>
  )
}
