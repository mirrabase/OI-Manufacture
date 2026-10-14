"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Fragment } from "react"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"

function formatSegment(segment: string) {
  if (segment === "dashboard") return "Overview"
  return segment
    .split("-")
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ")
}

export function DashboardBreadcrumbs() {
  const pathname = usePathname()
  const segments = pathname.split("/").filter(Boolean)
  const pageSegments = segments[0] === "-" ? segments.slice(1) : segments

  return (
    <div className="sticky top-0 z-20 flex min-h-10 shrink-0 items-center bg-background px-3">
      <Breadcrumb>
        <BreadcrumbList className="gap-2.5">
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/-/" />}>Your work</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator>/</BreadcrumbSeparator>
          {pageSegments.length === 0 ? (
            <BreadcrumbItem>
              <BreadcrumbPage>Home</BreadcrumbPage>
            </BreadcrumbItem>
          ) : (
            pageSegments.map((segment, index) => {
              const isCurrentPage = index === pageSegments.length - 1
              const href = `/${segments
                .slice(0, index + (segments[0] === "-" ? 2 : 1))
                .join("/")}`

              return (
                <Fragment key={`${segment}-${index}`}>
                  <BreadcrumbItem>
                    {isCurrentPage ? (
                      <BreadcrumbPage>{formatSegment(segment)}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink render={<Link href={`${href}/`} />}>
                        {formatSegment(segment)}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {!isCurrentPage ? (
                    <BreadcrumbSeparator>/</BreadcrumbSeparator>
                  ) : null}
                </Fragment>
              )
            })
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  )
}
