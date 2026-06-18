// N9 TRANSFER LEAF (P1e-3) — byte-layout constants for the parent/grandparent reconstructions.
// Every constant here is MEASURED byte-for-byte against a real belcoinjs legacy tx serialization in
// p1e3_const.test.mjs (audit residual-risk #3: headers MUST be measured, never hand-guessed — a wrong
// constant either bricks honest spends or lets a boundary slide). The reconstructions are LEGACY form
// (NO segwit marker/flag/witness) because that is exactly what hash256 takes for the txid (residual #4).
//
// Parent/grandparent topology (FROZEN):
//   transfer tx  = version(4) ‖ vinCount(01) ‖ [vin0: outpoint(36) ‖ scriptSigLen(00) ‖ seq(4)]
//                  ‖ voutCount(03) ‖ tokenOut(43) ‖ stateOut(43) ‖ changeOut(var) ‖ locktime(4)
//   genesis mint = version(4) ‖ vinCount(02) ‖ [vin0=M: 36 ‖ 00 ‖ seq] ‖ [vin1=G: 36 ‖ 00 ‖ seq]
//                  ‖ voutCount(04) ‖ tokenNote(43) ‖ stateOut(43) ‖ feeOut(var) ‖ changeOut(var) ‖ locktime(4)
// WALLET CONSTRAINT: every covenant tx (mint + transfer) MUST use nSequence == 0xffffffff (no RBF) so these
// vin-tail constants hold; the canary + the wallet build txs with 0xffffffff.
import * as bells from 'belcoinjs-lib';
import { TAPSIGHASH_TAG } from './sighashParts.mjs';

export const STATE_VERSION = 0x01;
// canonical stateOut FRAME = value(8=0) ‖ scriptLen(0x22) ‖ OP_RETURN(0x6a) ‖ PUSH32(0x20)  (11B)
export const FRAME = Buffer.concat([Buffer.alloc(8, 0), Buffer.from([0x22, 0x6a, 0x20])]);

export const VERSION = Buffer.from([0x02, 0x00, 0x00, 0x00]);     // nVersion = 2, LE
export const SEQ = Buffer.from([0xff, 0xff, 0xff, 0xff]);         // nSequence = 0xffffffff (no RBF)
export const SCRIPTSIGLEN0 = Buffer.from([0x00]);                 // empty scriptSig (taproot/segwit input)
export const LOCKTIME0 = Buffer.from([0x00, 0x00, 0x00, 0x00]);   // nLockTime = 0
export const VOUT0_LE = Buffer.from([0x00, 0x00, 0x00, 0x00]);    // the note is out[0] (R1) -> outpoint vout = 0

// header = version ‖ vinCount
export const HDR_T = Buffer.concat([VERSION, Buffer.from([0x01])]);  // mono-input parent (continuation), 5B
export const HDR_G = Buffer.concat([VERSION, Buffer.from([0x02])]);  // 2-input parent (genesis mint), 5B

// vin tail (after an outpoint) = scriptSigLen(00) ‖ sequence(4)   5B
export const VINTAIL = Buffer.concat([SCRIPTSIGLEN0, SEQ]);

// continuation-parent mid, spliced AFTER vin0_outpoint: vin0-tail ‖ voutCount(transfer = 3 outputs)  6B
export const CONT_MID = Buffer.concat([VINTAIL, Buffer.from([0x03])]);

// genesis-parent mid, spliced AFTER vin0(=M) outpoint: M-tail ‖ G(const 36) ‖ G-tail ‖ voutCount(mint = 4)  47B
// G is baked HERE as a leaf constant — a genesis-shape reconstruction that hash-matches committedTxidP therefore
// PROVES the real parent consumed G at vin1 (closes the forged-genesis CRITICAL; no free "Gslot").
export const genMid = (G) => Buffer.concat([VINTAIL, G, VINTAIL, Buffer.from([0x04])]);

export const PREFIX = Buffer.concat([TAPSIGHASH_TAG, TAPSIGHASH_TAG, Buffer.from([0x00])]); // 65B
export const vti = (G) => Buffer.concat([Buffer.from([STATE_VERSION]), G]);                 // 0x01 ‖ token_id (37B)

// derived offsets (DERIVED from pinned sub-piece widths, never a baked opaque preLen — closes the H2 byte-offset class)
export const PRELEN_CONT = HDR_T.length + 36 + CONT_MID.length + 43;      // to start of stateOut_P = 90
export const prelenGen = (G) => HDR_G.length + 36 + genMid(G).length + 43; // to start of stateOut_P (genesis) = 131
