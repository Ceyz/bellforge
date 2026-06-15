import { useWallet } from '../wallet/WalletProvider'
import { ConnectWallet } from '../components/app/ConnectWallet'
import { PageHeader } from '../components/app/PageHeader'
import { PageItem } from '../components/ui/PageTransition'

const input =
  'w-full rounded-btn border border-ink-600 bg-ink-900 px-3 py-2.5 text-sm text-text-hi placeholder:text-text-lo transition focus:border-forge-500/50 focus:outline-none'
const label = 'mb-1.5 block text-xs font-medium text-text-mid'

export function Mint() {
  const { address } = useWallet()
  return (
    <>
      <PageItem>
        <PageHeader
          title="Mint"
          subtitle="Forge a new OP_CAT token — fixed supply at genesis, on-chain mint fee, anti-inflation enforced by its own covenant."
          status="live-regtest"
        />
      </PageItem>
      <PageItem className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <form className="space-y-5 rounded-card border border-ink-600 bg-ink-800/60 p-6" onSubmit={(e) => e.preventDefault()}>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className={label}>Token name</label>
              <input className={input} placeholder="Bellbound" />
            </div>
            <div>
              <label className={label}>Ticker</label>
              <input className={input} placeholder="BOUND" />
            </div>
            <div>
              <label className={label}>Total supply</label>
              <input className={input} placeholder="21000000" inputMode="numeric" />
            </div>
            <div>
              <label className={label}>Decimals</label>
              <input className={input} placeholder="8" inputMode="numeric" />
            </div>
          </div>
          <div>
            <label className={label}>Mint fee (BELLS)</label>
            <input className={input} placeholder="0.01" inputMode="decimal" />
          </div>
          <div className="pt-2">
            {!address ? (
              <ConnectWallet className="w-full" />
            ) : (
              <button
                type="button"
                disabled
                className="w-full cursor-not-allowed rounded-btn bg-ink-700 px-5 py-3 text-sm font-semibold text-text-lo"
              >
                Forge token — live at mainnet
              </button>
            )}
            <p className="mt-2.5 text-center text-xs text-text-lo">
              Minting goes live after the genesis freeze + external audit. This is a regtest preview.
            </p>
          </div>
        </form>

        <aside className="h-fit space-y-3 rounded-card border border-ink-600 bg-ink-800/60 p-6 text-sm text-text-mid">
          <h3 className="font-display text-text-hi">What the covenant guarantees</h3>
          <ul className="space-y-2">
            <li>Supply <span className="text-text-hi">fixed at genesis</span> — the minter is one-shot, then spent.</li>
            <li>Every transfer <span className="text-text-hi">conserves</span> the amount on-chain (no inflation).</li>
            <li>Owner-auth: only the holder’s key can move a note.</li>
            <li>Verifiable by anyone on a block explorer.</li>
          </ul>
          <p className="border-t border-ink-600 pt-3 text-xs text-text-lo">
            These hold as long as the covenant is correct — which the external audit verifies before mainnet.
          </p>
        </aside>
      </PageItem>
    </>
  )
}
