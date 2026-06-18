// P2-5 lineage-v2 — the FROZEN byte constants of a SPLIT PARENT tx, for the position-aware backtrace (reconstruct txP so the
// spent note's tokenOut_j @ vout 2j + stateOut_j @ 2j+1 are proven). MEASURED byte-exact against a real belcoinjs split-tx
// serialization (p1e3_split_const.test.mjs) — never hand-guessed. The split-parent header is 47B and INDEPENDENT of the parent
// degree M' (voutCount = 2M'+1 stays a 1-byte varint while M' < 126), so the needle offset |pre| = 47 + 86·j depends ONLY on j
// (the H2-safe boundary). M_MAX bound: assert 2*M_MAX+1 < 0xfd (M_MAX=4 → voutCount ∈ {5,7,9}, single-byte).
import { HDR_T, VINTAIL, LOCKTIME0 } from './p1e3Const.mjs';

const B = (...x) => Buffer.from(x);

export const HDR_S = HDR_T;                     // version(4) ‖ vinCount(1) = 5B (a split is spent mono-input, like a continuation)
export const SPLIT_PAIR_LEN = 86;              // tokenOut_k(8+1+34=43) ‖ stateOut_k(11+32=43)
export const TOKENOUT_LEN = 43;
export const STATEOUT_LEN = 43;
export const CHANGEOUT_LEN = 43;               // changeVal(8) ‖ 0x22 ‖ changeSPK(34) — FUND-CRITICAL: changeSPK MUST be 34B
export { LOCKTIME0 };

// voutCount byte for a split parent of degree M' (= 2M'+1); throws if it would need a multi-byte varint (M' >= 126).
export function splitVoutCount(Mp) {
  const v = 2 * Mp + 1;
  if (v >= 0xfd) throw new Error(`split voutCount ${v} is not a 1-byte varint (M' must be < 126; M_MAX=4)`);
  return B(v);
}
// SPLIT_MID = the bytes between vin0_outpoint and the first output = scriptSigLen(0) ‖ sequence ‖ voutCount = 6B.
export const splitMid = (Mp) => Buffer.concat([VINTAIL, splitVoutCount(Mp)]);
export const SPLIT_HEADER_LEN = HDR_S.length + 36 + 6; // 5 + 36 + 6 = 47 (indep of M')

// |pre| up to the start of tokenOut_j (the byte offset of the spent note's tokenOut at vout 2j).
export const splitPreLen = (j) => SPLIT_HEADER_LEN + j * SPLIT_PAIR_LEN; // 47 + 86j
// offsets within txP (for the const test + the audit)
export const tokenOutOffset = (j) => splitPreLen(j);          // tokenOut_j
export const stateOutOffset = (j) => splitPreLen(j) + TOKENOUT_LEN; // stateOut_j = tokenOut + 43
