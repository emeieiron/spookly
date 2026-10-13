import { monad } from "@/lib/chain"
import QRCode from "qrcode"
import { ArrowLeft, Clock, Link2 } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const qr = (text: string) =>
  QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M" })

// The app's two key screens, sized in container units so the pair scales as one picture.
export async function ProductMock() {
  const [link, payment] = await Promise.all([
    qr("SPOOKLY SPENDABLE LINK (demo)"),
    qr(`ethereum:0x0000000000000000000000000000000000000000@${monad.id}`),
  ])
  return (
    <div
      role="img"
      aria-label="Spookly's Spook screen showing a $25 spendable link, and the spend screen scanning a payment code"
      className="@container relative w-full select-none"
    >
      <div aria-hidden className="relative flex items-start gap-[6cqw]">
        <div className="mock-Spook flex w-[47cqw] flex-col gap-[2.5cqw]">
          <Caption n="1">Spook</Caption>
          <Screen title="Spookly" detail="0x5054…932B">
            <span className="flex items-center gap-[1.5cqw] text-[3.2cqw] font-semibold">
              <ArrowLeft className="size-[3.6cqw]" /> Spook
            </span>
            <div className="flex flex-col items-center gap-[1cqw]">
              <span className="text-[8cqw] leading-none font-semibold tabular-nums">
                $25.00
              </span>
              <span className="text-[2.4cqw] text-muted-foreground">
                until 18 Oct
              </span>
            </div>
            <div className="qr-print mx-auto">
              <div
                className="w-[28cqw] bg-white p-[1cqw] [&>svg]:size-full"
                dangerouslySetInnerHTML={{ __html: link }}
              />
            </div>
            <span
              className={cn(buttonVariants(), "h-[7cqw] w-full text-[2.2cqw]")}
            >
              Copy link
            </span>
            <span className="text-center text-[2.1cqw] text-muted-foreground">
              Anyone with this link can spend it.
            </span>
          </Screen>
        </div>

        <div className="mock-spend mt-[14cqw] flex w-[47cqw] flex-col gap-[2.5cqw]">
          <Caption n="2">Spend</Caption>
          <Screen title="Spookly Spook">
            <div className="flex items-baseline justify-between">
              <span className="text-[6cqw] leading-none font-semibold tabular-nums">
                $25.00
              </span>
              <span className="flex items-center gap-[0.8cqw] text-[2.1cqw] text-muted-foreground">
                <Clock className="size-[2.4cqw]" /> until 18 Oct
              </span>
            </div>
            <div className="relative grid aspect-square w-full place-items-center overflow-hidden bg-black">
              <div
                className="w-[16cqw] bg-white p-[0.8cqw] opacity-90 [&>svg]:size-full"
                dangerouslySetInnerHTML={{ __html: payment }}
              />
              <span className="viewfinder absolute inset-[7cqw]" />
              <span className="scan-line absolute inset-x-[7cqw] h-[0.4cqw]" />
            </div>
            <span className="text-center text-[2.2cqw] text-muted-foreground">
              Point at a USDC payment QR code
            </span>
            <span
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-[7cqw] w-full text-[2.2cqw]"
              )}
            >
              Enter address instead
            </span>
          </Screen>
        </div>

        <span className="mock-link absolute top-[44cqw] left-1/2 z-10 flex -translate-x-1/2 items-center gap-[1.2cqw] border bg-background px-[2.4cqw] py-[1.4cqw] font-mono text-[2.3cqw] shadow-lg">
          <Link2 className="size-[2.8cqw]" />
          …/Spook#q7Hk2…
        </span>
      </div>
    </div>
  )
}

function Caption({ n, children }: { n: string; children: string }) {
  return (
    <span className="flex items-center gap-[1.4cqw] text-[2.3cqw] font-semibold tracking-widest text-muted-foreground uppercase">
      <span className="grid size-[4cqw] place-items-center border font-mono text-foreground">
        {n}
      </span>
      {children}
    </span>
  )
}

function Screen({
  title,
  detail,
  children,
}: {
  title: string
  detail?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-[3cqw] border bg-card p-[3.6cqw] text-card-foreground shadow-2xl">
      <div className="flex items-center justify-between">
        <span className="text-[2.4cqw] font-semibold tracking-widest uppercase">
          {title}
        </span>
        {detail && (
          <span className="font-mono text-[2cqw] text-muted-foreground">
            {detail}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}
