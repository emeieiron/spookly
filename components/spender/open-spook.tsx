"use client"

import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { spenderLinkFragment } from "@/lib/spender-link"

export function OpenSpook() {
  const id = useId()
  const [link, setLink] = useState("")
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      method="post"
      className="mt-10 flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        const fragment = spenderLinkFragment(link, window.location.origin)
        if (!fragment) {
          setError(
            "Paste the full Spook link from this Spookly site, including the part after #."
          )
          return
        }
        // Use the existing hashchange flow; no server submission or key storage.
        window.location.hash = fragment
      }}
    >
      <h1 className="text-xl font-semibold">Open a Spook</h1>
      <p className="text-sm text-muted-foreground">
        Paste the link shared with you to scan a payment code or enter an
        address.
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>Spook link</Label>
        <Input
          id={id}
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          required
          className="h-12 text-base"
          placeholder="https://…/spook#…"
          value={link}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : `${id}-help`}
          onChange={(event) => {
            setLink(event.target.value)
            setError(null)
          }}
        />
        {error && (
          <p
            id={`${id}-error`}
            role="alert"
            className="text-sm text-destructive"
          >
            {error}
          </p>
        )}
      </div>
      <Button type="submit" size="lg">
        Open Spook
      </Button>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        Keep the link private. Anyone with it can spend it. An internet
        connection is required.
      </p>
    </form>
  )
}
