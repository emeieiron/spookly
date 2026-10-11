import { Button } from "@/components/ui/button"

export function ExternalLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Button
      variant="link"
      size="xs"
      nativeButton={false}
      className="h-auto px-0 text-foreground"
      render={<a href={href} target="_blank" rel="noreferrer" />}
    >
      {children}
    </Button>
  )
}
