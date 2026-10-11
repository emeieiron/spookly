"use client"

import jsQR from "jsqr"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"

const noSubscribe = () => () => {}

type Detector = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>
}
declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => Detector
  }
}

export function QrScanner({ onResult }: { onResult: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const done = useRef(onResult)
  const [error, setError] = useState<string | null>(null)
  // Assume support while server rendering so hydration doesn't swap the viewfinder out.
  const supported = useSyncExternalStore(
    noSubscribe,
    () => !!navigator.mediaDevices,
    () => true
  )

  useEffect(() => {
    done.current = onResult
  }, [onResult])

  useEffect(() => {
    if (!navigator.mediaDevices) return
    let stream: MediaStream | undefined
    let frame = 0
    let stopped = false
    const canvas = document.createElement("canvas")
    const context = canvas.getContext("2d", { willReadFrequently: true })
    const detector = window.BarcodeDetector
      ? new window.BarcodeDetector({ formats: ["qr_code"] })
      : null

    const scan = async () => {
      const element = video.current
      if (stopped || !element) return
      if (element.readyState >= 2) {
        let text: string | undefined
        if (detector) {
          text = (await detector.detect(element).catch(() => []))[0]?.rawValue
        } else if (context) {
          canvas.width = element.videoWidth
          canvas.height = element.videoHeight
          context.drawImage(element, 0, 0)
          text = jsQR(
            context.getImageData(0, 0, canvas.width, canvas.height).data,
            canvas.width,
            canvas.height
          )?.data
        }
        if (text && !stopped) {
          stopped = true
          done.current(text)
          return
        }
      }
      frame = requestAnimationFrame(scan)
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((media) => {
        if (stopped) return media.getTracks().forEach((t) => t.stop())
        stream = media
        if (video.current) {
          video.current.srcObject = media
          video.current.play().catch(() => {})
        }
        frame = requestAnimationFrame(scan)
      })
      .catch(() =>
        setError(
          "Camera access was blocked. Allow the camera, or enter the address instead."
        )
      )

    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // The viewfinder keeps its square even when the camera is unavailable, so the page never reflows.
  const problem = !supported
    ? "This browser can't use the camera. Enter the address instead."
    : error
  return (
    <div className="relative aspect-square w-full overflow-hidden bg-black">
      {problem ? (
        <p className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-white/80">
          {problem}
        </p>
      ) : (
        <>
          <video
            ref={video}
            playsInline
            muted
            className="size-full object-cover"
          />
          <div className="pointer-events-none absolute inset-[15%] border-2 border-white/80" />
        </>
      )}
    </div>
  )
}
