// MAINNET (or regtest) OP_CAT smoke — READ-ONLY / NON-BROADCAST. Confirms OP_CAT is ACTIVE+ENFORCED (not anyone-can-spend) and that a
// covenant spend is RELAY-STANDARD, using ONLY testmempoolaccept (validates, never broadcasts) + sendtoaddress/generate (regtest self-fund).
// It NEVER calls sendrawtransaction/generateblock/submitblock and NEVER touches a WIF/seed. The disposable covenant is a minimal OP_CAT
// ENFORCEMENT canary: leaf = [OP_CAT, <committed a‖b>, OP_EQUAL]. A correct witness [a,b] passes ONLY if OP_CAT actually executes; a WRONG
// witness is rejected ONLY if OP_CAT is ENFORCED (pre-activation OP_CAT is OP_SUCCESSx ⟹ anyone-can-spend ⟹ the wrong witness would PASS).
// So: GREEN allowed + RED rejected  ==>  OP_CAT is active+enforced at the configured node's tip.
//
// USAGE
//   Regtest dry-run (proves the mechanics, self-funds):   node native/_audit_mainnet_smoke.mjs
//   Mainnet (operator): point the RPC at YOUR mainnet node, FUND the printed address yourself (your wallet/WIF — NOT this script), then:
//     BELLS_RPC_URL=http://127.0.0.1:<mainnet-rpc-port> BELLS_RPC_USER=… BELLS_RPC_PASS=… \
//     BELLS_SMOKE_FUND_TXID=<txid> BELLS_SMOKE_FUND_VOUT=<n> BELLS_SMOKE_FUND_VALUE=<sats> \
//     node native/_audit_mainnet_smoke.mjs
// (Operator does the broadcast/funding + final go/no-go. Claude prepares + validates only.)
import * as bells from 'belcoinjs-lib';
import { makeCovenant, WALLET, REGTEST } from '../canaries/tap.mjs';
import { rpc, nodeReachable, opcatActive } from '../canaries/rpc.mjs';

const O = bells.opcodes;
const B = (...x) => Buffer.from(x);
// the disposable enforcement canary: a=4B, b=4B, committed = a‖b (8B). leaf = [OP_CAT, committed, OP_EQUAL].
const a = B(0x01, 0x02, 0x03, 0x04), b = B(0x05, 0x06, 0x07, 0x08), committed = Buffer.concat([a, b]);
const bWrong = B(0xff, 0xff, 0xff, 0xff);
const cov = makeCovenant([O.OP_CAT, committed, O.OP_EQUAL]);   // P2TR(NUMS, leaf) — NUMS-dead internal key, script-path only

const DEST = Buffer.concat([B(0x51, 0x20), Buffer.alloc(32, 0x42)]);   // a throwaway P2TR sink (34B spk ⟹ clears the tx-size-small floor)
async function tmaSpend({ txid, vout, valueSats, witnessB, feeSats = 1000 }) {
  // build a script-path spend of the canary UTXO → one standard P2TR output (value = input − fee).
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(Buffer.from(txid, 'hex').reverse(), vout, 0xffffffff);
  tx.addOutput(DEST, Math.max(0, valueSats - feeSats));
  tx.ins[0].witness = [a, witnessB, cov.leaf, cov.controlBlock];
  const res = await rpc('testmempoolaccept', [[tx.toHex()]]);  // validates; does NOT broadcast
  const r = res[0];
  return { allowed: r.allowed === true, reason: r['reject-reason'] || r.vsize || '', vsize: r.vsize, hex: tx.toHex() };
}

const probe = await nodeReachable();
if (!probe.up) { console.log(`SMOKE: no node reachable (${probe.reason}). Set BELLS_RPC_URL to your node.`); process.exit(0); }
console.log(`\nOP_CAT SMOKE — node chain=${probe.chain}, blocks=${probe.blocks}`);

// (1) read-only activation check.
try {
  const dep = await opcatActive();
  const info = await rpc('getdeploymentinfo', []);
  const flags = info.script_flags || [];
  console.log(`  getdeploymentinfo: opcat deployment status=${dep.status} active=${dep.active}`);
  console.log(`  tip script_flags include OP_CAT=${flags.includes('OP_CAT')} CSFS=${flags.includes('CHECKSIGFROMSTACK')} CTV=${flags.includes('DEFAULT_CHECK_TEMPLATE_VERIFY_HASH')} INTERNALKEY=${flags.includes('INTERNALKEY')}`);
} catch (e) { console.log(`  (getdeploymentinfo unavailable: ${e.message})`); }

console.log(`  disposable OP_CAT canary address: ${cov.address}`);

// (2) get a funded UTXO of the canary: operator-provided (mainnet) or self-funded (regtest).
let utxo = null;
if (process.env.BELLS_SMOKE_FUND_TXID) {
  utxo = { txid: process.env.BELLS_SMOKE_FUND_TXID, vout: Number(process.env.BELLS_SMOKE_FUND_VOUT || 0), valueSats: Number(process.env.BELLS_SMOKE_FUND_VALUE || 0) };
  console.log(`  using operator-funded UTXO ${utxo.txid}:${utxo.vout} (${utxo.valueSats} sats)`);
} else if (probe.chain === 'regtest') {
  const fundTxid = await rpc('sendtoaddress', [cov.address, 0.01], { wallet: WALLET });   // regtest self-fund (sendtoaddress, NOT a covenant broadcast)
  const mineAddr = await rpc('getnewaddress', ['', 'bech32m'], { wallet: WALLET });
  await rpc('generatetoaddress', [1, mineAddr], { wallet: WALLET });
  const ftx = await rpc('getrawtransaction', [fundTxid, true]);
  const out = ftx.vout.find((o) => o.scriptPubKey.hex === cov.output.toString('hex'));
  utxo = { txid: fundTxid, vout: out.n, valueSats: Math.round(out.value * 1e8) };
  console.log(`  regtest self-funded UTXO ${utxo.txid}:${utxo.vout} (${utxo.valueSats} sats)`);
} else {
  console.log(`\n  → MAINNET: fund the address above with your wallet (your WIF — NOT this script), then re-run with`);
  console.log(`     BELLS_SMOKE_FUND_TXID=<txid> BELLS_SMOKE_FUND_VOUT=<n> BELLS_SMOKE_FUND_VALUE=<sats>`);
  process.exit(0);
}

// (3) the enforcement smoke: GREEN (correct witness) must be ALLOWED; RED (wrong witness) must be REJECTED.
const green = await tmaSpend({ ...utxo, witnessB: b });
const red = await tmaSpend({ ...utxo, witnessB: bWrong });
console.log(`\n  GREEN (correct [a,b]):  allowed=${green.allowed}  vsize=${green.vsize}  ${green.allowed ? '✓ relay-standard' : 'reason=' + green.reason}`);
console.log(`  RED   (wrong  [a,b']):  allowed=${red.allowed}   ${red.allowed ? '✗✗ OP_CAT NOT enforced (anyone-can-spend!)' : 'reason=' + red.reason}`);
const ok = green.allowed && !red.allowed;
console.log(`\n  VERDICT: ${ok ? '✅ OP_CAT is ACTIVE + ENFORCED and the covenant spend is RELAY-STANDARD' : '⛔ NOT confirmed — see above'}`);
