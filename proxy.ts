import { NextResponse, type NextRequest } from "next/server"
import { route } from "@/lib/hosts"

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  // The Host header names the domain the visitor asked for; nextUrl can carry the server's bind address.
  const host = request.headers.get("host") ?? request.nextUrl.host
  const next = route(host, pathname)
  if (!next) return NextResponse.next()
  const url = new URL(
    "rewrite" in next ? next.rewrite : next.redirect,
    request.url
  )
  url.search = search
  return "rewrite" in next
    ? NextResponse.rewrite(url)
    : NextResponse.redirect(url, 308)
}

export const config = {
  // API routes, build output and public files are served the same on every host.
  matcher: ["/((?!api/|_next/|.*\\.[^/]+$).*)"],
}
