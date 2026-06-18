# Bellforge — DeFi forged on Bellscoin

Bellforge is a **covenant-secured DeFi stack** for Bellscoin's OP_CAT opcode bundle:
a divisible token (**$BOUND**), an on-chain AMM, and lending — all enforced by the
chain itself, not by an operator. This repository holds the web app
([bellforge.app](https://bellforge.app)) and the covenant engine.

> Bellscoin is the first Dogecoin-family chain to ship the `OP_CAT` / `OP_CHECKTEMPLATEVERIFY`
> / `OP_CHECKSIGFROMSTACK` / `OP_INTERNALKEY` bundle — a superset of Fractal's OP_CAT-only set.

## Status — honest by design

| Layer | Network | State |
|---|---|---|
| Rune trading | **mainnet** | ✅ **Live** — settles real value today |
| $BOUND token · AMM pools · lending | **regtest** | ✅ **Proven** — 118 covenant test files, green |
| Mainnet covenants | mainnet | ⛔ **Blocked on OP_CAT activation** |

`OP_CAT` is a **BIP9 (bit 2)** deployment on Bellscoin mainnet currently showing
**~0 miner signalling**. As plain BIP9 (no lock-in-on-timeout) it **fails at the
2026-12-25 timeout** unless ~95% of miners signal within a retarget period. Until it
activates, a covenant UTXO on mainnet is an `OP_SUCCESS` opcode = **anyone-can-spend**.

So nothing covenant-based ships to mainnet value before three gates clear: **OP_CAT
activation → an external audit → the permanent genesis freeze.** Every pre-mainnet
surface on the site is labelled accordingly.

## What's in this repo

```
/          the web app — React 19 + Vite + TypeScript + Tailwind (deployed to bellforge.app)
native/    the covenant engine — tapscript builders, a script simulator, the P4 indexer, 118 test files
```

## The covenant stack (`native/`)

- **$BOUND** — every transfer **BINDS** the amount rather than **DECLARING** it (the
  design lesson from the CAT20 inflation bug, where an indexer trusted a spender-declared
  amount). Conservation holds *by construction*, proven on a no-escape taptree.
- **AMM** — constant-product pools with the invariant `x'·y' ≥ x·y` enforced **on-chain**
  via emulated 64-bit multiply / compare (tapscript has no `OP_MUL` / `OP_DIV`).
- **Lending** — on-stack LTV, interest (rounded toward the pool), borrow / repay / liquidate.
- **P4 indexer** — a deterministic, reorg-safe **second validator** that re-derives the
  ledger from genesis and HALTs on any divergence.

## Run it

**Web app**
```bash
npm install
npm run dev        # http://localhost:5173
```

**Covenant test suite (118 files)**
```bash
cd native
npm install
npm test           # node --test --test-concurrency=1
```

## Security posture

- **BIND, don't DECLARE** — the cardinal rule.
- Covenant correctness rests on a byte-exact BIP-341 sighash (validated against
  `belcoinjs-lib`), a NUMS-pinned internal key (no key-path escape), and `|P|==32`
  pubkey pinning (a non-32-byte pubkey makes `CSFS`/`CHECKSIG` pass *without verifying*).
- **Covenants are regtest-only** until OP_CAT activates *and* an external audit clears
  *and* the genesis SPK is frozen. This repo is a pre-audit snapshot — read it as such.

## License

[MIT](LICENSE).
