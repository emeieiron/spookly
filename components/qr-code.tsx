"use client"

import QRCode from "qrcode"
import { useEffect, useState } from "react"

export function QrCode({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const [svg, setSvg] = useState("")
  useEffect(() => {
    QRCode.toString(text, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
    }).then(setSvg)
  }, [text])
  // Square from the first frame so the QR arriving a tick later doesn't move anything.
  return (
    <div
      className={`aspect-square [&>svg]:size-full ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
