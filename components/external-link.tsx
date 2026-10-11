import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// A real link styled as a shadcn link button, so it keeps link semantics.
export function ExternalLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        buttonVariants({ variant: "link", size: "xs" }),
        "h-auto px-0 text-foreground"
      )}
    >
      {children}
    </a>
  )
}
