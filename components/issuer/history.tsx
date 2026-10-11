"use client"

import { useIssuer } from "./app"
import { Bar, ChequeRow, Page, PageTitle } from "./ui"

export function History() {
  const { wallet } = useIssuer()
  const closed = wallet?.book?.cheques.filter((c) => !c.active) ?? []
  return (
    <Page>
      <PageTitle title="History" />
      {!wallet ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Bar key={i} className="h-11" />
          ))}
        </div>
      ) : (
        <ul className="min-h-0 flex-1 [scrollbar-width:thin] divide-y overflow-y-auto border-t">
          {closed.map((c) => (
            <ChequeRow key={c.signer} cheque={c} now={wallet.checkedAt} />
          ))}
          {closed.length === 0 && (
            <li className="py-6 text-center text-xs text-muted-foreground">
              No past cheques
            </li>
          )}
        </ul>
      )}
    </Page>
  )
}
