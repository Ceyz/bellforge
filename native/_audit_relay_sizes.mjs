// Node-INDEPENDENT relay-standardness sizing of the frozen $BOUND taptree (no node, no funds). Prints the worst leaf bytes, the
// control-block size, and the per-leaf worst max-stack-ELEMENT (the 520B wall) across all 490 leaves. Run: node native/_audit_relay_sizes.mjs
import { buildTaptree, maxStackElement } from './freezeEnumerate.mjs';
import { freezeDeploy } from './p4/deploy.mjs';

const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const G = Buffer.alloc(36, 0xaa);
const feeOut = Buffer.concat([u64(100000n), Buffer.from([0x22]), p2tr(0x99)]);
const deploy = freezeDeploy({ tokenId: G, AMOUNT_0: 21_000_000n, OWNER_0: Buffer.alloc(20, 0x55), VALUE_0: 1_000_000n, feeOut, changeSpkLen: 34, arms: ['key', 'script'] });
const tree = buildTaptree(deploy.consts, { arms: ['key', 'script'] });

const cb = tree.controlBlockFor(tree.ordered[0].leaf);
let worstLeaf = { sz: 0 }, worstEl = { el: 0 };
for (const l of tree.ordered) {
  if (l.leaf.length > worstLeaf.sz) worstLeaf = { sz: l.leaf.length, id: l.id };
  const el = maxStackElement(l.id);
  if (el > worstEl.el) worstEl = { el, id: l.id };
}
const merge0 = tree.ordered.find((l) => l.id.fam === 'merge' && l.id.side === 0);
console.log(`frozen tree: ${tree.ordered.length} leaves, depth ${tree.depth}, control block ${cb.length}B (= 33 + 32·${tree.depth})`);
console.log(`worst leaf SCRIPT bytes: ${worstLeaf.sz}B  ${JSON.stringify(worstLeaf.id)}`);
console.log(`merge side0 leaf: ${merge0.leaf.length}B, maxStackElement ${maxStackElement(merge0.id)}B`);
console.log(`GLOBAL worst max-stack ELEMENT: ${worstEl.el}B (must be < 520)  ${JSON.stringify(worstEl.id)}`);
console.log(`520B wall margin: ${520 - worstEl.el}B`);
