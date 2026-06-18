// P2-1a CONSENSUS — the byte-limb consistency gadget ENFORCED at block-validation on a real bellsd node. Proves (a) the
// constructive b_ser↔b_num gadget rejects a DECOUPLED limb (the CAT20 re-entry point) at consensus, (b) OP_WITHIN/OP_LESSTHAN/
// OP_NUMEQUAL actually EXECUTE on Bellscoin tapscript (NOT OP_SUCCESSx — else the decoupled RED would be wrongly accepted).
// Differential: the off-chain `limbConsistent` reference PREDICTS accept/reject; the node must AGREE. Run (regtest up):
// node --test native/amounts_consensus.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { makeCovenant, fund, notMinable, spendHex, destSpk } from '../canaries/tap.mjs';
import { nodeReachable } from '../canaries/rpc.mjs';
import { limbConsistencyVerifyOps, limbSer, limbNum, limbConsistent } from './amounts.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP2-1a consensus SKIPPED — ${skip}\n`);

const O = bells.opcodes;
const cov = makeCovenant([...limbConsistencyVerifyOps(), O.OP_1]); // succeeds iff (b_num, b_ser) on the witness are consistent

// fund a fresh UTXO at the gadget leaf and attempt to spend it with witness [bNum, bSer]; returns whether it mined at consensus.
async function trySpend(bNum, bSer) {
  const u = await fund(cov, 1);
  const dest = await destSpk();
  const hex = spendHex({ fundTxid: u.fundTxid, vout: u.vout, valueSats: u.valueSats, feeSats: 20000, destSpk: dest, witnessData: [bNum, bSer], cov });
  return (await notMinable(hex)).mined;
}

test('P2-1a CONSENSUS: canonical limbs ACCEPT and decoupled/malformed limbs REJECT — the node agrees with the reference', { skip }, async () => {
  // GREEN — canonical (b_ser, b_num) for representative values incl. the guard-byte boundary (127/128) and the zero limb.
  for (const v of [0, 1, 127, 128, 200, 255]) {
    const bSer = limbSer(v), bNum = limbNum(v);
    assert.ok(limbConsistent(bSer, bNum), `reference: canonical v=${v} consistent`);
    const mined = await trySpend(bNum, bSer);
    assert.equal(mined, true, `CONSENSUS: canonical limb v=${v} must mine`);
    console.log(`  GREEN v=${v}: gadget accepts at consensus`);
  }

  // RED — DECOUPLED pairs (b_ser of v, b_num of w, v!=w): the summed value would diverge from the serialized byte = inflation.
  const decoupled = [[1, 255], [255, 1], [0, 1], [128, 129], [127, 128]];
  for (const [v, w] of decoupled) {
    const bSer = limbSer(v), bNum = limbNum(w);
    assert.equal(limbConsistent(bSer, bNum), false, `reference: decoupled ser=${v}/num=${w} inconsistent`);
    const mined = await trySpend(bNum, bSer);
    assert.equal(mined, false, `CONSENSUS: decoupled ser=${v}/num=${w} MUST be rejected (CAT20 re-entry closed)`);
    console.log(`  RED ser=${v}/num=${w}: rejected at block-validation`);
  }

  // RED — malformed reps the gadget must also reject at consensus.
  const malformed = [
    { bNum: limbNum(1), bSer: Buffer.alloc(2, 1), why: '|b_ser| != 1' },
    { bNum: Buffer.from([0x01, 0x00]), bSer: limbSer(1), why: 'non-minimal b_num (0x0100) -> OP_WITHIN throws' },
    { bNum: Buffer.from([0x80]), bSer: limbSer(128), why: 'b_num 0x80 decodes to -0, not 128' },
    { bNum: limbNum(0), bSer: Buffer.from([0x01]), why: 'b_num=0 but b_ser=0x01 (decoupled zero)' },
  ];
  for (const m of malformed) {
    const mined = await trySpend(m.bNum, m.bSer);
    assert.equal(mined, false, `CONSENSUS: malformed (${m.why}) MUST be rejected`);
    console.log(`  RED malformed (${m.why}): rejected at block-validation`);
  }
  console.log('\n✅ P2-1a: the b_ser↔b_num consistency gadget enforces at CONSENSUS — the CAT20 declared-sum re-entry is closed at the limb level.\n');
});
