import QRCode from "qrcode"

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

// Hypotrochoid rosettes and sine bands: the engraved "guilloché" of banknotes and cheques.
function rosette(cx: number, cy: number, R: number, r: number, d: number) {
  const period = (2 * Math.PI * r) / gcd(R, r)
  const steps = 1400
  let path = ""
  for (let i = 0; i <= steps; i++) {
    const t = (period * i) / steps
    const x = cx + (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t)
    const y = cy + (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t)
    path += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return path
}

function bands(y: number, count: number, width: number) {
  return Array.from({ length: count }, (_, k) => {
    let path = ""
    for (let x = 0; x <= width; x += 6) {
      const wave = 5 * Math.sin(x / 22 + k * 0.45) + 2 * Math.sin(x / 7 + k)
      path += `${x ? "L" : "M"}${x} ${(y + k * 2.6 + wave).toFixed(1)}`
    }
    return path
  })
}

const ROSETTES = [
  rosette(470, 120, 96, 37, 62),
  rosette(470, 120, 70, 27, 44),
  rosette(470, 120, 44, 17, 30),
]
const BANDS = bands(206, 12, 640)

function Micr({ kind }: { kind: "transit" | "onus" | "amount" }) {
  return (
    <svg viewBox="0 0 10 14" className="micr-glyph" aria-hidden>
      {kind === "transit" && (
        <>
          <rect x="0" y="1" width="2" height="12" />
          <rect x="5" y="1" width="5" height="4" />
          <rect x="5" y="9" width="5" height="4" />
        </>
      )}
      {kind === "onus" && (
        <>
          <rect x="0" y="1" width="3" height="10" />
          <rect x="5" y="1" width="2" height="10" />
          <rect x="0" y="12" width="10" height="2" />
        </>
      )}
      {kind === "amount" && (
        <>
          <rect x="0" y="1" width="3" height="12" />
          <rect x="5" y="4" width="2" height="6" />
          <rect x="8" y="1" width="2" height="12" />
        </>
      )}
    </svg>
  )
}

export async function HeroCheque() {
  const qr = await QRCode.toString("PIPPO CHEQUE No. 000417 (demo)", {
    type: "svg",
    margin: 0,
    color: { dark: "#14231c", light: "#00000000" },
  })
  return (
    <div
      className="cheque-stage"
      role="img"
      aria-label="A Pippo cheque for 25 USDC, payable to the bearer of the link"
    >
      <div className="cheque">
        <div className="cheque-stub">
          <span className="micr text-[1.5cqw] tracking-[0.2em]">
            No. 000417
          </span>
          <div className="cheque-qr" dangerouslySetInnerHTML={{ __html: qr }} />
          <span className="font-display text-[2.1cqw] leading-tight italic">
            Open the link
            <br />
            to spend
          </span>
          <span className="micr text-[1.4cqw] opacity-70">
            KEY · URL FRAGMENT
          </span>
        </div>

        <div className="cheque-body">
          <svg
            className="guilloche"
            viewBox="0 0 640 260"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden
          >
            {ROSETTES.map((d, i) => (
              <path key={i} d={d} />
            ))}
            {BANDS.map((d, i) => (
              <path key={`b${i}`} d={d} className="band" />
            ))}
          </svg>

          <div className="relative flex items-start justify-between">
            <span className="font-display text-[4.2cqw] leading-none italic">
              Pippo
            </span>
            <div className="micr text-right text-[1.45cqw] leading-relaxed tracking-[0.18em]">
              No. 000417
              <br />
              VALID UNTIL 18 · OCT · 2026
            </div>
          </div>

          <div className="relative mt-[3.2cqw] flex items-end gap-[2cqw]">
            <span className="micr shrink-0 text-[1.35cqw] tracking-[0.2em]">
              PAY TO THE
              <br />
              BEARER OF
            </span>
            <span className="cheque-line font-display text-[3cqw] italic">
              this link, whoever holds it
            </span>
            <span className="cheque-amount micr text-[2.6cqw]">
              $&nbsp;25.00
            </span>
          </div>

          <div className="relative mt-[2.2cqw] flex items-end gap-[1.5cqw]">
            <span className="cheque-line font-display text-[2.6cqw] italic">
              Twenty-five and 00/100
            </span>
            <span className="micr shrink-0 text-[1.5cqw] tracking-[0.2em]">
              USDC
            </span>
          </div>

          <div className="relative mt-[2.6cqw] flex items-end justify-between gap-[3cqw]">
            <div className="flex flex-col gap-[0.6cqw]">
              <span className="micr text-[1.3cqw] tracking-[0.2em] opacity-70">
                MEMO
              </span>
              <span className="font-display text-[2.2cqw] italic">
                any USDC address · 10 networks
              </span>
            </div>
            <div className="cheque-signature">
              <svg viewBox="0 0 250 64" aria-hidden>
                <path
                  pathLength={1}
                  d="M8 44 C 22 8, 40 6, 36 30 S 24 62, 50 46 S 78 12, 88 30 S 98 56, 118 36 C 128 26, 138 24, 148 38 S 168 52, 182 30 C 192 16, 204 26, 198 40 S 214 52, 242 22"
                />
              </svg>
              <span className="micr text-[1.2cqw] tracking-[0.2em] opacity-70">
                AUTHORISED SIGNATURE
              </span>
            </div>
          </div>

          <div className="micr relative mt-auto flex items-center gap-[1cqw] pt-[2cqw] text-[1.9cqw] tracking-[0.12em]">
            <Micr kind="transit" />
            10143
            <Micr kind="transit" />
            <span className="mx-[1cqw]">0x2e6e7c1c</span>
            <Micr kind="onus" />
            000417
            <Micr kind="amount" />
          </div>

          <div className="cheque-stamp" aria-hidden>
            <span className="text-[3.4cqw] leading-none">Escrowed</span>
            <span className="micr text-[1.2cqw] tracking-[0.3em]">
              CANNOT BOUNCE
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
