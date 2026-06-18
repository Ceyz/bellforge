// P0 — FROZEN wire format for the native covenant token. The OP_RETURN token state, the canonical
// indexer event serialization, and the cumulative state-root. Everything (minter, transfer-guard,
// indexer, 2nd validator) MUST agree on these exact bytes. Every field is byte-length-pinned.
// (SECURITY_PLAN.md §0/§5; GPT review: freeze this BEFORE the covenant scripts.)
import * as bells from 'belcoinjs-lib';
const S = bells.crypto.sha256;

// L1 FIX (audit 2026-06-13): validate vout is a non-negative integer < 2^32 — `n >>> 0` silently aliased
// 2^32→0 and truncated floats, which (post-H1) would collide sort keys / token_ids.
const u32le = (n) => {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error(`u32 out of range / non-integer: ${n}`);
  const b = Buffer.alloc(4); b.writeUInt32LE(n); return b;
};
const pin = (buf, len, name) => {
  if (!Buffer.isBuffer(buf) || buf.length !== len) throw new Error(`${name} must be exactly ${len} bytes (got ${Buffer.isBuffer(buf) ? buf.length : typeof buf})`);
  return buf;
};

// --- amounts: SERIALIZATION form only (8-byte LE uint64). Arithmetic operands are a SEPARATE concern
//     handled covenant-side via chunked CScriptNum (P0b / amounts.mjs) — never reuse these 8 bytes as
//     an OP_ADD operand (that was the B4 prototype bug). Range capped < 2^63 to avoid int64 sign issues. ---
export const TOKEN_AMOUNT_MAX = (1n << 63n) - 1n;
// TOKEN_VALUE_MIN (audit G, 2026-06-15) — the SAT dust floor for a LIVE tokenOut. A note whose tokenOut carries fewer
// sats than this is consensus-valid but relay-dust-rejected, and (the KEY arm being strictly 1-input) can never be
// fee-topped-up ⇒ permanently relay-stranded. This is the OFF-CHAIN floor: the wallet builder must never emit a live
// output below it, and P4 flags any sub-floor live note as `stranded` (still counted for conservation, never served as
// freely spendable). 546 = a conservative Bitcoin/Bells dust floor (the on-node dust threshold measured ~330 for P2TR;
// 546 keeps margin across fee-rate/policy). If a HARD on-chain floor is chosen instead it must be baked into every live
// leaf (CHANGES the frozen root) and EXEMPT owner_type==BURN (else every burn locks ≥floor sats). See docs/AUDIT_AO_2026-06-15.md G/H.
export const TOKEN_VALUE_MIN = 546n;
export function encodeAmount(n) {
  // L1 FIX: a Number above 2^53 silently rounds, so the +1 would vanish — require an exact integer.
  if (typeof n !== 'bigint' && !Number.isSafeInteger(n)) throw new Error(`amount must be a bigint or a safe integer: ${n}`);
  const v = typeof n === 'bigint' ? n : BigInt(n);
  if (v < 0n || v > TOKEN_AMOUNT_MAX) throw new Error(`amount out of range [0, 2^63): ${v}`);
  const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b;
}
// M1 FIX (audit 2026-06-13): decode must be the exact inverse of encode — reject the sign-bit range [2^63, 2^64)
// that encodeAmount rejects, so a chain-committed out-of-range amount is malformed for ALL conformant indexers
// (not ingested by a lax one + rejected by a strict one = a §5 HALT-the-line divergence).
export function decodeAmount(buf) {
  pin(buf, 8, 'amount');
  const v = buf.readBigUInt64LE();
  if (v > TOKEN_AMOUNT_MAX) throw new Error(`amount out of range [0, 2^63): ${v}`);
  return v;
}

// --- token UTXO state (committed as a hash in the trailing OP_RETURN; the token address stays constant) ---
export const STATE_VERSION = 0x01;
// layout (FROZEN): version(1) ‖ token_id(36 = genesis outpoint) ‖ amount(8) ‖ owner(20 = hash160) = 65B
// token_id is 36B EVERYWHERE (state + events + tokenId()) — GPT A1 fix; 65B is still < 80B standard item.
export function encodeState({ tokenId, amount, owner }) {
  pin(tokenId, 36, 'token_id'); pin(owner, 20, 'owner');
  return Buffer.concat([Buffer.from([STATE_VERSION]), tokenId, encodeAmount(amount), owner]);
}
export function decodeState(buf) {
  pin(buf, 65, 'state'); // 1+36+8+20
  if (buf[0] !== STATE_VERSION) throw new Error(`bad state version ${buf[0]}`);
  return { tokenId: buf.subarray(1, 37), amount: decodeAmount(buf.subarray(37, 45)), owner: buf.subarray(45, 65) };
}
export const stateCommitment = (state) => S(pin(state, 65, 'state')); // 32-byte hash committed on-chain
// the OP_RETURN output script carrying a token state commitment
export function opReturnStateScript(state) {
  return bells.script.compile([bells.opcodes.OP_RETURN, stateCommitment(state)]);
}

// --- state v2 (GENESIS-PERMANENT, frozen 2026-06-14) — adds version + owner_type so script-owned (pools), burn/lock and ROOT
//     can compose WITHOUT a new wire/leaf (the $BOUND divisible token's permanent state). owner_type is PER-NOTE (a child of a
//     split can be key-owned while its sibling is script-owned). layout: version(1=0x02) ‖ owner_type(1) ‖ token_id(36) ‖
//     amount(8) ‖ owner(20) = 66B. owner = hash160(P) for KEY, hash160(controllerSPK descriptor / pool_id+state_id) for SCRIPT.
export const STATE_VERSION_V2 = 0x02;
export const OwnerType = Object.freeze({ KEY: 0x00, SCRIPT: 0x01, BURN: 0x02 });
const isOwnerType = (t) => t === 0x00 || t === 0x01 || t === 0x02;
export function encodeStateV2({ ownerType, tokenId, amount, owner }) {
  pin(tokenId, 36, 'token_id'); pin(owner, 20, 'owner');
  if (!isOwnerType(ownerType)) throw new Error(`bad owner_type ${ownerType} (key=0/script=1/burn=2)`);
  return Buffer.concat([Buffer.from([STATE_VERSION_V2, ownerType]), tokenId, encodeAmount(amount), owner]); // 66B
}
export function decodeStateV2(buf) {
  pin(buf, 66, 'state v2'); // 1+1+36+8+20
  if (buf[0] !== STATE_VERSION_V2) throw new Error(`bad state v2 version ${buf[0]}`);
  if (!isOwnerType(buf[1])) throw new Error(`bad owner_type ${buf[1]}`);
  return { ownerType: buf[1], tokenId: buf.subarray(2, 38), amount: decodeAmount(buf.subarray(38, 46)), owner: buf.subarray(46, 66) };
}
export const stateCommitmentV2 = (state) => S(pin(state, 66, 'state v2'));
// the covenant builds state v2 on-stack as: 0x02 ‖ owner_type(witness, per note) ‖ token_id(leaf const) ‖ amount_ser ‖ owner.
// VTI_V2 = the leaf-constant prefix AFTER owner_type, i.e. token_id; the covenant CATs 0x02 ‖ owner_type ‖ token_id ‖ ...
export const STATE_V2_PREFIX = Buffer.from([STATE_VERSION_V2]); // 0x02 ; owner_type is witness; token_id is the leaf const

// --- token_id = the genesis (mint reveal) outpoint, canonical bytes (FROZEN): txid_internal(32) ‖ vout(4) ---
export function tokenId({ genesisTxidInternal, genesisVout }) {
  return Buffer.concat([pin(genesisTxidInternal, 32, 'genesis txid'), u32le(genesisVout)]); // 36 bytes
}

// --- indexer canonical EVENT (for the cumulative state-root). FROZEN field order + encodings. ---
export const EventType = { MINT: 0x00, TRANSFER: 0x01, BURN: 0x02 };
// layout (FROZEN): type(1) ‖ token_id(36) ‖ txid_internal(32) ‖ vout(4) ‖ amount(8) ‖ owner(20)
export function encodeEvent({ type, tokenId: tid, txidInternal, vout, amount, owner }) {
  if (![0, 1, 2].includes(type)) throw new Error(`bad event type ${type}`);
  pin(tid, 36, 'event token_id'); pin(txidInternal, 32, 'event txid'); pin(owner, 20, 'event owner');
  return Buffer.concat([Buffer.from([type]), tid, txidInternal, u32le(vout), encodeAmount(amount), owner]);
}
// H1 FIX (audit 2026-06-13): canonical within-block ordering = LEXICOGRAPHIC over the FROZEN 101-byte event
// encoding (a genuine TOTAL order on in-preimage bytes). The old key (txIndex, outputIndex) was OFF-preimage —
// `txIndex` (a tx's block position) is not in encodeEvent, so two conformant indexers deriving it differently
// folded the same events into different roots (defeats the §5 "2nd-validator agrees" gate). Sorting the encoded
// buffers includes type/token_id/txid/vout/amount/owner, so distinct events never tie. Across blocks: chain order
// (fold block-by-block), so no block_height field is needed.
export function canonicalSort(eventBufs) {
  for (const b of eventBufs) pin(b, 101, 'event');
  return [...eventBufs].sort(Buffer.compare);
}
// cumulative state-root: H(prev ‖ H(event)). DOMAIN-SEPARATED seed (GPT P4 round-11, MED/HIGH): the empty-ledger root is
// H(RULESET_TAG), NOT 32 zero bytes — so a v2 with a different ruleset/wire starts from a DIFFERENT seed and can never
// reuse / collide a v1 root (the "v2 reuses an ambiguous v1 root" namespace hole). token_id is already folded into every
// event (per-token disambiguation inside the global root); this closes the cross-VERSION ambiguity. Bake now, pre-value.
// (Name kept `ZERO_ROOT` for import stability; its VALUE is the domain seed, not zeros.)
export const RULESET_TAG = Buffer.from('opcat-native-token/ruleset-v1', 'utf8');
export const ZERO_ROOT = S(RULESET_TAG);
export const foldEvent = (prevCumulative, eventBuf) => S(Buffer.concat([pin(prevCumulative, 32, 'prev root'), S(eventBuf)]));
export function stateRootOf(eventBufs, prev = ZERO_ROOT) {
  return eventBufs.reduce((root, e) => foldEvent(root, e), prev);
}

// --- malformed-tx outcome (FROZEN, GPT decision): invalid TRANSFER = FULL_IGNORE (no state change,
//     no credit, no burn). Explicit BURN ONLY via the distinct burn-guard. Minter/guard malformed = FULL_IGNORE. ---
export const Outcome = Object.freeze({ APPLY: 'apply', FULL_IGNORE: 'full_ignore', BURN: 'burn' });

// ====================================================================================================================
// --- EVENT v2 (P2-0 BRICK 0, the TIER-FULL ledger) — adds owner_type (mirrors encodeStateV2) + a closed event-type enum so a
//     split-child is NEVER folded as a plain transfer (the cumulative-root fork the critic flagged) + the ruleset-v2 seed (a v2
//     ledger can never reuse/collide a v1 root). The EventType byte is DERIVED from the matched recognizer, never a heuristic.
//     layout (FROZEN): type(1) ‖ owner_type(1) ‖ token_id(36) ‖ txid_internal(32) ‖ vout(4) ‖ amount(8) ‖ owner(20) = 102B.
export const EventTypeV2 = Object.freeze({ MINT: 0x00, TRANSFER: 0x01, SPLIT_CHILD: 0x02, MERGE: 0x03, BURN: 0x04 });
const isEventTypeV2 = (t) => t >= 0 && t <= 4;
export function encodeEventV2({ type, ownerType, tokenId: tid, txidInternal, vout, amount, owner }) {
  if (!isEventTypeV2(type)) throw new Error(`bad event v2 type ${type}`);
  if (!(ownerType === 0x00 || ownerType === 0x01 || ownerType === 0x02)) throw new Error(`bad event owner_type ${ownerType}`);
  pin(tid, 36, 'event token_id'); pin(txidInternal, 32, 'event txid'); pin(owner, 20, 'event owner');
  return Buffer.concat([Buffer.from([type, ownerType]), tid, txidInternal, u32le(vout), encodeAmount(amount), owner]); // 102B
}
export function canonicalSortV2(eventBufs) { for (const b of eventBufs) pin(b, 102, 'event v2'); return [...eventBufs].sort(Buffer.compare); }
// ruleset-v2 domain seed: the empty-ledger root + the noteSetDigest seed (critic[2]: the digest MUST be domain-seeded too, not
// 32 zeros, or a v1/v2 cross-version digest can collide). Bind the recognizer-set version into the tag (critic[12]).
export const RULESET_TAG_V2 = Buffer.from('opcat-native-token/ruleset-v2/recognizers-v1', 'utf8');
export const ZERO_ROOT_V2 = S(RULESET_TAG_V2);
export const foldEventV2 = (prev, eventBuf) => S(Buffer.concat([pin(prev, 32, 'prev root'), S(eventBuf)]));
