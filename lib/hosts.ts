// One deployment serves the landing site and the app on separate hosts; proxy.ts routes between them. In
// development both share one host with the app under /app, since Privy's embedded wallet needs HTTPS or localhost.
const dev = process.env.NODE_ENV === "development"
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || (dev ? "/" : "https://spookly.xyz")
export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || (dev ? "/app" : "https://app.spookly.xyz")

const absolute = (url: string) => (url.startsWith("/") ? null : new URL(url))
const app = absolute(APP_URL)
const site = absolute(SITE_URL)
// Where in-app navigation returns to: the app host's root, or /app when the app shares the site's host.
export const APP_HOME = app ? "/" : APP_URL

// App pages live under app/app/ and are served from the root of the app host.
const APP_PAGES = /^\/(?:send|receive|history|spooks)(?:\/|$)/
const underApp = (path: string) => path === "/app" || path.startsWith("/app/")

export type Route = { rewrite: string } | { redirect: string } | null

export function route(host: string, path: string): Route {
  if (app && host === app.host) {
    if (underApp(path))
      return { redirect: new URL(path.slice(4) || "/", app).href }
    if (path === "/" || APP_PAGES.test(path))
      return { rewrite: `/app${path === "/" ? "" : path}` }
    return null
  }
  if (app && site && (host === site.host || host === `www.${site.host}`)) {
    // Spook links keep their fragment across the redirect, so links shared from the site still open.
    const target = underApp(path)
      ? path.slice(4) || "/"
      : APP_PAGES.test(path) || path === "/spook"
        ? path
        : null
    return target ? { redirect: new URL(target, app).href } : null
  }
  // Hosts without an app subdomain, such as previews and local development, keep the app under /app.
  return APP_PAGES.test(path) ? { rewrite: `/app${path}` } : null
}

// Passkeys are scoped to the site's domain so one passkey opens links on the site and the app subdomain.
export function passkeyRpId(hostname: string) {
  const domain = site?.hostname
  return domain?.includes(".") &&
    (hostname === domain || hostname.endsWith(`.${domain}`))
    ? domain
    : hostname
}
