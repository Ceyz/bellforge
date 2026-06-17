import { useWallet } from '../wallet/WalletProvider'
import { ConnectWallet } from '../components/app/ConnectWallet'
import { PageHeader } from '../components/app/PageHeader'
import { PageItem } from '../components/ui/PageTransition'
import { HonestBanner } from '../components/ui/HonestBanner'
import { ForgeButton } from '../components/juice/ForgeButton'
import { Crucible } from '../components/juice/Crucible'

const input =
  'input-forge w-full rounded-btn border border-ink-600 bg-ink-900 px-3 py-2.5 text-sm text-text-hi placeholder:text-text-lo'
const label = 'mb-1.5 block text-xs font-medium text-text-mid'

export function Deploy() {
  const { address } = useWallet()
  return (
    <>
      <PageItem>
        <PageHeader
          title="Deploy"
          subtitle="Deploy a new OP_CAT token — fix its supply at genesis, set an on-chain mint fee, and let its own covenant enforce anti-inflation. Holders mint their share afterwards from the token's page."
          status="soon"
        />
      </PageItem>
      <PageItem className="space-y-6">
        <HonestBanner>
          The forge below is a cosmetic preview — it moves no funds, and every number comes only from what you
          type. Deploying goes live after the genesis freeze + external audit.
        </HonestBanner>
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
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
              <ForgeButton idleLabel="Preview the forge" doneLabel="Token forged (preview)" />
            )}
          </div>
        </form>

        <aside className="h-fit space-y-3 rounded-card border border-ink-600 bg-ink-800/60 p-6 text-sm text-text-mid">
          <Crucible size={96} copy={<span className="font-micro text-[10px] tracking-[0.14em] text-forge-400">THE FORGE IS LIT</span>} />
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
        </div>
      </PageItem>
    </>
  )
}
