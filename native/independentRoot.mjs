// audit Result-6 (2026-06-15) — an INDEPENDENT transferSPK re-derivation, a 2nd implementation that does NOT reuse the
// production helpers (buildTaptree / orderLeaves / balancedTree / the baked NUMS const / bells.payments.p2tr). It re-derives
// NUMS = SHA256(uncompressed G) from scratch, re-sorts the leaf set by its own tuple key, builds its own balanced TapTree
// with raw BIP-341 tagged hashes, and tweaks NUMS via secp directly. If it byte-agrees with the production root, the
// freeze's tree-construction + tweak are corroborated by a separate code path (the genesis out0==root proof is then not
// just "the enumerator agrees with itself"). The leaf SET/bytes are the one shared input — independently validated by
// coverageGaps(). Run via freeze_independent_root.test.mjs.
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';

const tagged = (tag, msg) => bells.crypto.taggedHash(tag, msg);
const B = (...x) => Buffer.from(x);

// independently re-derived NUMS: x = SHA256(0x04 ‖ Gx ‖ Gy) (the BIP-341 'H' point; dlog unknown ⇒ key-path dead).
const Gx = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const Gy = '483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8';
export const NUMS_INDEP = bells.crypto.sha256(Buffer.from('04' + Gx + Gy, 'hex'));

function compactSize(n) {
  if (n < 0xfd) return B(n);
  if (n <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = 0xfe; b.writeUInt32LE(n, 1); return b;
}
const varslice = (buf) => Buffer.concat([compactSize(buf.length), buf]);
const tapLeafHash = (leaf) => tagged('TapLeaf', Buffer.concat([B(0xc0), varslice(leaf)]));
const tapBranch = (a, b) => { const [x, y] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a]; return tagged('TapBranch', Buffer.concat([x, y])); };

// independent canonical order (re-stated from the freeze spec, NOT imported from leafIdKey). Includes the MERGE family: FAM.merge,
// GP.merge, the Mp='merge' sentinel (immediate parent IS a merge tx), and the side axis (the two merge-execution leaf instances).
const FAM = { 'root-split': 0, 'root-sendall': 1, split: 2, '1to1': 3, merge: 4 };
const GP = { genesis: 0, transfer: 1, split: 2, merge: 3 };
const mpNum = (mp) => mp === 'merge' ? 5 : (mp ?? 0);
const keyOf = (id) => [FAM[id.fam], mpNum(id.Mp), id.j ?? 0, id.M ?? 0, GP[id.gp] ?? 0, id.Mp_gp ?? 0, id.arm === 'script' ? 1 : 0, id.side ?? 0];

// independent balanced TapTree (split at ceil(n/2)) over the tapLeaf hashes → merkle root.
function balanced(hashes) {
  if (hashes.length === 1) return hashes[0];
  const mid = Math.ceil(hashes.length / 2);
  return tapBranch(balanced(hashes.slice(0, mid)), balanced(hashes.slice(mid)));
}

// leaves = [{ id, leaf:Buffer }] (from enumerateLeaves — the set being validated). Returns { merkleRoot, parity, spk }.
// audit R: this is the cryptographic-primitive cross-check — a SECOND secp256k1 (ecc.xOnlyPointAddTweak) recomputes the
// taptweak Q = lift_x(NUMS) + t·G independently of belcoinjs's payments.p2tr; the parity is exposed so a caller can assert
// the FROZEN control-block parity bit (cb[0]&1) matches (a belcoinjs parity/merkle bug would otherwise admit a key-path spend).
export function independentOutputKey(leaves, numsX = NUMS_INDEP) {
  const ordered = [...leaves].sort((a, b) => { const ka = keyOf(a.id), kb = keyOf(b.id); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return 0; });
  const merkleRoot = balanced(ordered.map((l) => tapLeafHash(l.leaf)));
  const t = tagged('TapTweak', Buffer.concat([numsX, merkleRoot]));
  const tw = ecc.xOnlyPointAddTweak(numsX, t);
  if (!tw || !tw.xOnlyPubkey) throw new Error('independent tweak failed (NUMS not a liftable x-only point?)');
  return { merkleRoot, parity: tw.parity, spk: Buffer.concat([B(0x51, 0x20), Buffer.from(tw.xOnlyPubkey)]) };
}
export const independentTransferSPK = (leaves, numsX = NUMS_INDEP) => independentOutputKey(leaves, numsX).spk;
