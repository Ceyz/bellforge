// P2-5 (mini) — the OPERAND-TO-OUTPUT SINGLE-SOURCE binding leaf for the divisible $BOUND split (GPT-build-review's #1 gate).
// Proves: Σ(M output amounts) == the input AND each output's amount_ser_j (the bytes that go into its stateOut) is built from
// the SAME gadget-welded (b_num, b_ser) limb pairs whose b_num feeds the conservation sum — so "adder sums A, state commits B"
// is impossible. Design = the workflow's POSITION-vs-FLAT synthesis realized with the PROVEN N9 OP_PICK convention: the witness
// is FLAT and never consumed during compute; every value is OP_PICKed at a computed depth; each (b_num, b_ser) pair is
// gadget-tied ONCE (limbConsistencyVerifyOps) so the byte appended to amount_ser_j == the value summed. The "state" of each
// output is, in this MINI, a committed amount_ser_j (witness); the full leaf (P2-5) replaces it with state_j→c6=sha_outputs.
//
// SCOPE (mini): conservation + single-source output binding, M (split degree) is a BUILD-TIME constant, N limbs. KEY-OWNED only
// (no owner arm here — pure binding proof). DEFERS: N9 lineage, the c6/sha_outputs bind, the script-owned arm, changeSPK const.
// scriptsim dry-runs all of this (arithmetic modelled); consensus is the final truth.
import * as bells from 'belcoinjs-lib';
import { limbConsistencyVerifyOps } from './amounts.mjs';
import { FRAME } from './p1e3Const.mjs';
import { TAPSIGHASH_TAG, CSFS_PUBKEY_SIG_PINS } from './sighashParts.mjs';

const O = bells.opcodes;
const OP_CSFS = 0xcc;
const enc = bells.script.number.encode;
const B = (...x) => Buffer.from(x);

// ----- P2-5 the c6 = sha_outputs reconstruction for the M-way split (the bind that ties amount_ser_j to the REAL on-chain
//   stateOut). FROZEN split topology (genesis-permanent), INTERLEAVED per note:
//     vout 2j   = tokenOut_j  = value_j ‖ 0x22 ‖ ownSPK           (the child covenant note, replicated)
//     vout 2j+1 = stateOut_j  = FRAME ‖ SHA256(0x01‖token_id‖amount_ser_j‖owner_j)   (its OP_RETURN state)
//     vout 2M   = changeOut   = changeValue ‖ 0x22 ‖ changeSPK    (changeSPK a LEAF CONST ≠ ownSPK — RED-3b fix)
//   c6 = SHA256( tokenOut_0 ‖ stateOut_0 ‖ … ‖ tokenOut_{M-1} ‖ stateOut_{M-1} ‖ changeOut ) == the real shaOutputs.
//   amount_ser_j is the single-source register from the binding leaf (NEVER a fresh witness copy). Reuses FRAME (p1e3Const).
// consts: { tokenId(36), ownSPK(34), changeSPK(34) } — build-time asserts |·| + changeSPK ≠ ownSPK.
export function splitC6Ops(M, { tokenId, ownSPK, changeSPK }) {
  if (!Buffer.isBuffer(tokenId) || tokenId.length !== 36) throw new Error('tokenId must be 36B');
  if (!Buffer.isBuffer(ownSPK) || ownSPK.length !== 34) throw new Error('ownSPK must be 34B');
  if (!Buffer.isBuffer(changeSPK) || changeSPK.length !== 34) throw new Error('changeSPK must be 34B');
  if (changeSPK.equals(ownSPK)) throw new Error('changeSPK MUST differ from ownSPK (RED-3b: token-valued change would inflate)');
  const VTI = Buffer.concat([B(0x01), tokenId]);          // 37B state prefix
  const vsOwn = Buffer.concat([B(0x22), ownSPK]);         // varslice(ownSPK) = 35B
  const vsChange = Buffer.concat([B(0x22), changeSPK]);   // varslice(changeSPK) = 35B
  // witness (deepest→top): [ changeValue(8), out0Value_{M-1}(8), owner_{M-1}(20), amount_ser_{M-1}(8), ...,
  //                          out0Value_0(8), owner_0(20), amount_ser_0(8) ]  — output 0 on top, processed first.
  const ops = [];
  for (let j = 0; j < M; j++) {
    // top: [.., out0Value_j, owner_j, amount_ser_j]  -> build piece_j = tokenOut_j ‖ stateOut_j
    ops.push(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);        // |amount_ser_j| == 8
    ops.push(VTI, O.OP_SWAP, O.OP_CAT);                   // VTI ‖ amount_ser_j
    ops.push(O.OP_SWAP, O.OP_SIZE, enc(20), O.OP_EQUALVERIFY, O.OP_CAT); // ‖ owner_j (|·|==20) -> state_j(65)
    ops.push(O.OP_SHA256, FRAME, O.OP_SWAP, O.OP_CAT);    // FRAME ‖ SHA256(state_j) = stateOut_j(43); stack [.., out0Value_j, stateOut_j]
    ops.push(O.OP_SWAP, O.OP_SIZE, enc(8), O.OP_EQUALVERIFY, vsOwn, O.OP_CAT); // out0Value_j ‖ 0x22‖ownSPK = tokenOut_j; stack [.., stateOut_j, tokenOut_j]
    ops.push(O.OP_SWAP, O.OP_CAT);                        // tokenOut_j ‖ stateOut_j = piece_j ; stack [.., piece_j]
    if (j === 0) ops.push(O.OP_TOALTSTACK);              // acc = piece_0 -> alt (keeps it off the remaining witness)
    else ops.push(O.OP_FROMALTSTACK, O.OP_SWAP, O.OP_CAT, O.OP_TOALTSTACK); // acc := acc ‖ piece_j -> alt
  }
  ops.push(O.OP_FROMALTSTACK);                            // acc back; stack [.., changeValue, acc]
  ops.push(O.OP_SWAP, O.OP_SIZE, enc(8), O.OP_EQUALVERIFY, vsChange, O.OP_CAT); // changeValue ‖ 0x22‖changeSPK = changeOut; stack [.., acc, changeOut]
  ops.push(O.OP_CAT);                                     // acc ‖ changeOut
  ops.push(O.OP_SHA256);                                  // c6 = sha_outputs
  return ops;
}

// witness (deepest→top) for splitC6Ops: changeValue, then per output (MSB output deepest) [out0Value, owner, amount_ser].
export function splitC6Witness({ outs, changeValue }) {
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
  const w = [u64(changeValue)];
  for (let j = outs.length - 1; j >= 0; j--) w.push(u64(outs[j].value), outs[j].owner, outs[j].amountSer);
  return w;
}

// ----- P2-5 INTEGRATION — conservation + the c6=sha_outputs bind in ONE leaf, single-source. Each output amount is gadget-
//   tied; its b_num feeds Σ(outputs)==input AND its b_ser builds amount_ser_j → stateOut_j → the c6 preimage (ONE growing alt
//   register). Leaves c6 on the stack (the epilogue binds it to the real sighash; here a test reads it). -----
export function splitBindC6Ops(M, N, { tokenId, ownSPK, changeSPK }) {
  if (!Buffer.isBuffer(tokenId) || tokenId.length !== 36) throw new Error('tokenId must be 36B');
  if (!Buffer.isBuffer(ownSPK) || ownSPK.length !== 34) throw new Error('ownSPK must be 34B');
  if (!Buffer.isBuffer(changeSPK) || changeSPK.length !== 34) throw new Error('changeSPK must be 34B');
  if (changeSPK.equals(ownSPK)) throw new Error('changeSPK MUST differ from ownSPK (RED-3b)');
  const VTI = Buffer.concat([B(0x01), tokenId]), vsOwn = Buffer.concat([B(0x22), ownSPK]), vsChange = Buffer.concat([B(0x22), changeSPK]);
  // witness (deepest→top): changeValue(8); per output j: owner_j(20), value_j(8); per (j,i): out_num, out_ser; per i: tgt_num, tgt_ser.
  const changeAbs = 0;
  const ownerAbs = (j) => 1 + 2 * j;
  const valueAbs = (j) => 1 + 2 * j + 1;
  const base = 1 + 2 * M;
  const outNumAbs = (j, i) => base + (j * N + i) * 2;
  const outSerAbs = (j, i) => base + (j * N + i) * 2 + 1;
  const tgtNumAbs = (i) => base + (M * N + i) * 2;
  const tgtSerAbs = (i) => base + (M * N + i) * 2 + 1;
  const W = base + 2 * N * (M + 1);

  const ops = [];
  let depth = W;
  // emit a single op (number=opcode, Buffer=push) and track the MAIN-stack delta. Multi-op gadgets via emitSeq with a net delta.
  const DELTA = {
    [O.OP_0]: 1, [O.OP_1]: 1, [O.OP_DUP]: 1, [O.OP_SIZE]: 1, [O.OP_FROMALTSTACK]: 1,
    [O.OP_TOALTSTACK]: -1, [O.OP_DROP]: -1, [O.OP_VERIFY]: -1, [O.OP_CAT]: -1, [O.OP_ADD]: -1, [O.OP_SUB]: -1,
    [O.OP_GREATERTHANOREQUAL]: -1, [O.OP_LESSTHAN]: -1,
    [O.OP_EQUALVERIFY]: -2, [O.OP_NUMEQUALVERIFY]: -2,
    [O.OP_SWAP]: 0, [O.OP_SHA256]: 0, [O.OP_1ADD]: 0,
  };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  const gadget = () => { ops.push(...limbConsistencyVerifyOps()); depth -= 2; };   // consumes (b_num, b_ser)
  const reduceOne = [O.OP_DUP, enc(256), O.OP_GREATERTHANOREQUAL, O.OP_IF, enc(256), O.OP_SUB, O.OP_SWAP, O.OP_1ADD, O.OP_SWAP, O.OP_ENDIF]; // net 0

  // PHASE B — per output: build amount_ser_j (single-source) → stateOut_j/tokenOut_j → piece_j, accumulate the c6 preimage on alt.
  e(O.OP_0, O.OP_TOALTSTACK);                                  // c6preimage = empty (alt)
  for (let j = 0; j < M; j++) {
    e(O.OP_0);                                                 // acc = empty (amount_ser_j)
    for (let i = 0; i < N; i++) {
      pick(outNumAbs(j, i)); pick(outSerAbs(j, i)); gadget();  // weld (b_num, b_ser)
      pick(outSerAbs(j, i)); e(O.OP_CAT);                      // acc ‖ b_ser
    }
    e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);                    // |amount_ser_j| == 8
    e(VTI, O.OP_SWAP, O.OP_CAT);                               // VTI ‖ amount_ser_j
    pick(ownerAbs(j)); e(O.OP_SIZE, enc(20), O.OP_EQUALVERIFY, O.OP_CAT); // ‖ owner_j -> state_j(65)
    e(O.OP_SHA256, FRAME, O.OP_SWAP, O.OP_CAT);                // FRAME ‖ SHA256(state_j) = stateOut_j
    pick(valueAbs(j)); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY, vsOwn, O.OP_CAT); // value_j ‖ 0x22‖ownSPK = tokenOut_j; [.., stateOut_j, tokenOut_j]
    e(O.OP_SWAP, O.OP_CAT);                                    // tokenOut_j ‖ stateOut_j = piece_j
    e(O.OP_FROMALTSTACK, O.OP_SWAP, O.OP_CAT, O.OP_TOALTSTACK); // c6preimage ‖= piece_j
  }
  pick(changeAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY, vsChange, O.OP_CAT); // changeOut = changeValue ‖ 0x22‖changeSPK
  e(O.OP_FROMALTSTACK, O.OP_SWAP, O.OP_CAT, O.OP_SHA256);      // c6 = SHA256(c6preimage ‖ changeOut)

  // PHASE A — conservation Σ(outputs) == input (carry on alt; the c6 buffer sits on main, untouched by alt ops).
  e(O.OP_0, O.OP_TOALTSTACK);                                  // carry = 0
  for (let i = 0; i < N; i++) {
    pick(tgtNumAbs(i)); pick(tgtSerAbs(i)); gadget();
    e(O.OP_FROMALTSTACK);                                      // running = carry
    for (let j = 0; j < M; j++) { pick(outNumAbs(j, i)); e(O.OP_ADD); }
    e(O.OP_0, O.OP_SWAP);                                      // [carryOut=0, running]
    for (let k = 0; k < M - 1; k++) ops.push(...reduceOne);    // net 0
    if (i === N - 1) ops.push(O.OP_DUP, enc(128), O.OP_LESSTHAN, O.OP_VERIFY); // <2^63 (net 0)
    pick(tgtNumAbs(i)); e(O.OP_NUMEQUALVERIFY);                // r == tgt_num_i
    e(O.OP_TOALTSTACK);                                        // carryOut -> next carry
  }
  e(O.OP_FROMALTSTACK, O.OP_0, O.OP_NUMEQUALVERIFY);           // final carry-out == 0
  return ops; // c6 on the main-stack top (the epilogue binds it; the test reads it)
}

// ----- THE FULL P2-5 mini split/transfer leaf — single-source binding + conservation WELDED to the N9 c6=sha_outputs bind.
//   Builds c6 (single-source) then FORCES c6 == the REAL shaOutputs via CSFS(computed)+CHECKSIG(real) over one (sig,P), with
//   key-owned owner-auth (hash160(P)==owner_in) + the BIP-342 |P|/|sig| pins. ownSPK is WITNESS, bound by c4=SHA256(0x22‖ownSPK)
//   ⟹ the child notes replicate to the REAL covenant SPK (self-replication, N9-style). Mono-input (vin0=the spent note):
//   c2=SHA256(noteOutpoint), c4=SHA256(varslice(ownSPK)). DEFERS (P2-6): N9 lineage (amount_in fed as a witness register here).
export function splitFullOps(M, N, { tokenId, changeSPK }) {
  if (!Buffer.isBuffer(tokenId) || tokenId.length !== 36) throw new Error('tokenId must be 36B');
  if (!Buffer.isBuffer(changeSPK) || changeSPK.length !== 34) throw new Error('changeSPK must be 34B');
  const VTI = Buffer.concat([B(0x01), tokenId]), vsChange = Buffer.concat([B(0x22), changeSPK]);
  const PREFIX = Buffer.concat([TAPSIGHASH_TAG, TAPSIGHASH_TAG, B(0x00)]);
  // witness (deepest→top): EPI head, changeValue, per-output (owner,value), per-(j,i) limb pairs, per-i target pairs.
  const ownerInAbs = 0, sigAbs = 1, pAbs = 2, c1Abs = 3, c3Abs = 4, c5Abs = 5, c7Abs = 6, c8Abs = 7, c9Abs = 8, outpointAbs = 9, ownSpkAbs = 10;
  const changeAbs = 11;
  const ownerAbs = (j) => 12 + 2 * j, valueAbs = (j) => 12 + 2 * j + 1;
  const base = 12 + 2 * M;
  const outNumAbs = (j, i) => base + (j * N + i) * 2, outSerAbs = (j, i) => base + (j * N + i) * 2 + 1;
  const tgtNumAbs = (i) => base + (M * N + i) * 2, tgtSerAbs = (i) => base + (M * N + i) * 2 + 1;
  const W = base + 2 * N * (M + 1);

  const ops = []; let depth = W;
  const DELTA = {
    [O.OP_0]: 1, [O.OP_1]: 1, [O.OP_DUP]: 1, [O.OP_SIZE]: 1, [O.OP_FROMALTSTACK]: 1,
    [O.OP_TOALTSTACK]: -1, [O.OP_DROP]: -1, [O.OP_VERIFY]: -1, [O.OP_CAT]: -1, [O.OP_ADD]: -1, [O.OP_SUB]: -1,
    [O.OP_GREATERTHANOREQUAL]: -1, [O.OP_LESSTHAN]: -1, [O.OP_EQUAL]: -1, [O.OP_CHECKSIG]: -1,
    [O.OP_EQUALVERIFY]: -2, [O.OP_NUMEQUALVERIFY]: -2, [OP_CSFS]: -2,
    [O.OP_SWAP]: 0, [O.OP_SHA256]: 0, [O.OP_1ADD]: 0, [O.OP_NOT]: 0, [O.OP_HASH160]: 0, [O.OP_ROT]: 0,
  };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  const gadget = () => { ops.push(...limbConsistencyVerifyOps()); depth -= 2; };
  const pins = () => { ops.push(...CSFS_PUBKEY_SIG_PINS); };   // net 0 (SIZE/EQUALVERIFY/SWAP)
  const reduceOne = [O.OP_DUP, enc(256), O.OP_GREATERTHANOREQUAL, O.OP_IF, enc(256), O.OP_SUB, O.OP_SWAP, O.OP_1ADD, O.OP_SWAP, O.OP_ENDIF];
  const vsOwn = () => { pick(ownSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY); e(B(0x22), O.OP_SWAP, O.OP_CAT); }; // -> 0x22‖ownSPK on top

  // PHASE B — single-source amount_ser_j → stateOut_j/tokenOut_j → c6 preimage (alt).
  e(O.OP_0, O.OP_TOALTSTACK);                                  // c6preimage = empty
  for (let j = 0; j < M; j++) {
    e(O.OP_0);                                                 // amount_ser_j acc
    for (let i = 0; i < N; i++) { pick(outNumAbs(j, i)); pick(outSerAbs(j, i)); gadget(); pick(outSerAbs(j, i)); e(O.OP_CAT); }
    e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);                    // |amount_ser_j|==8
    e(VTI, O.OP_SWAP, O.OP_CAT);                               // VTI ‖ amount_ser_j
    pick(ownerAbs(j)); e(O.OP_SIZE, enc(20), O.OP_EQUALVERIFY, O.OP_CAT, O.OP_SHA256, FRAME, O.OP_SWAP, O.OP_CAT); // -> stateOut_j
    pick(valueAbs(j)); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY); vsOwn(); e(O.OP_CAT); // tokenOut_j = value_j ‖ 0x22‖ownSPK ; stack [.., stateOut_j, tokenOut_j]
    e(O.OP_SWAP, O.OP_CAT);                                    // tokenOut_j ‖ stateOut_j = piece_j
    e(O.OP_FROMALTSTACK, O.OP_SWAP, O.OP_CAT, O.OP_TOALTSTACK); // c6preimage ‖= piece_j
  }
  pick(changeAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY, vsChange, O.OP_CAT);  // changeOut
  e(O.OP_FROMALTSTACK, O.OP_SWAP, O.OP_CAT, O.OP_SHA256);      // c6 = SHA256(c6preimage ‖ changeOut)

  // PHASE A — conservation Σ(outputs)==input.
  e(O.OP_0, O.OP_TOALTSTACK);
  for (let i = 0; i < N; i++) {
    pick(tgtNumAbs(i)); pick(tgtSerAbs(i)); gadget();
    e(O.OP_FROMALTSTACK);
    for (let j = 0; j < M; j++) { pick(outNumAbs(j, i)); e(O.OP_ADD); }
    e(O.OP_0, O.OP_SWAP);
    for (let k = 0; k < M - 1; k++) ops.push(...reduceOne);
    if (i === N - 1) ops.push(O.OP_DUP, enc(128), O.OP_LESSTHAN, O.OP_VERIFY);
    pick(tgtNumAbs(i)); e(O.OP_NUMEQUALVERIFY);
    e(O.OP_TOALTSTACK);
  }
  e(O.OP_FROMALTSTACK, O.OP_0, O.OP_NUMEQUALVERIFY);           // carry-out == 0 ; c6 is on top

  // PHASE C — bind c6 to the REAL sighash + owner-auth. (changeSPK ≠ ownSPK on-chain assert.)
  pick(ownSpkAbs); e(vsChange.subarray(1), O.OP_EQUAL, O.OP_NOT, O.OP_VERIFY); // ownSPK != changeSPK (RED-3b on-chain)
  e(O.OP_TOALTSTACK);                                          // stash c6
  pick(c1Abs);                                                 // c1
  pick(outpointAbs); e(O.OP_SIZE, enc(36), O.OP_EQUALVERIFY, O.OP_SHA256, O.OP_CAT); // ‖ c2(=SHA256(outpoint)); |outpoint|==36 PINNED (GPT round-3 audit-hardening; CSFS already forces it via c2==real shaPrevouts)
  pick(c3Abs); e(O.OP_CAT);                                    // ‖ c3
  vsOwn(); e(O.OP_SHA256, O.OP_CAT);                           // ‖ c4(=SHA256(0x22‖ownSPK))
  pick(c5Abs); e(O.OP_CAT);                                    // ‖ c5  -> left = c1..c5
  e(O.OP_FROMALTSTACK, O.OP_CAT);                              // left ‖ c6
  pick(c7Abs); e(O.OP_CAT); pick(c8Abs); e(O.OP_CAT); pick(c9Abs); e(O.OP_CAT); // ‖ c7‖c8‖c9 = message
  e(PREFIX, O.OP_SWAP, O.OP_CAT, O.OP_SHA256);                 // computed_sighash = SHA256(PREFIX ‖ message)
  pick(pAbs); pick(sigAbs); pins();                            // [computed, P, sig] ; |P|==32,|sig|==64
  e(O.OP_ROT, O.OP_ROT);                                       // -> [sig, computed, P]
  e(OP_CSFS, O.OP_VERIFY);                                     // CSFS: sig over computed under P  (forces computed == real ⟹ c6 == real shaOutputs)
  pick(pAbs); pick(sigAbs); e(O.OP_SWAP, O.OP_CHECKSIG, O.OP_VERIFY); // CHECKSIG: sig over the REAL sighash under P
  pick(pAbs); e(O.OP_HASH160); pick(ownerInAbs); e(O.OP_EQUALVERIFY); // owner-auth: hash160(P) == owner_in
  for (let k = 0; k < depth; k++) ops.push(O.OP_DROP);        // CLEANSTACK: drop all remaining (witness + leftovers)
  ops.push(O.OP_1);
  return { ops, W };
}
export const buildSplitFullLeaf = (M, N, consts) => bells.script.compile(splitFullOps(M, N, consts).ops);

// build the binding leaf ops for split degree M, N limbs per amount. Witness layout (deepest→top), FLAT, never consumed:
//   abs 0..M-1            : committed_amount_ser_j  (the per-output "state" amount, N-byte LE buffer)
//   abs M + (j*N+i)*2 (+1): out_j_num_i, out_j_ser_i   (output j, limb i — gadget-tied pair)
//   abs M + (M*N+i)*2 (+1): tgt_num_i, tgt_ser_i       (the input/target limb pair)
export function splitBindMiniOps(M, N) {
  if (!Number.isInteger(M) || M < 2 || M > 8) throw new Error(`M must be 2..8: ${M}`);
  if (!Number.isInteger(N) || N < 1 || N > 8) throw new Error(`N must be 1..8: ${N}`);
  const W = M + 2 * N * (M + 1);                       // total witness items
  const committedAbs = (j) => j;
  const outNumAbs = (j, i) => M + (j * N + i) * 2;
  const outSerAbs = (j, i) => M + (j * N + i) * 2 + 1;
  const tgtNumAbs = (i) => M + (M * N + i) * 2;
  const tgtSerAbs = (i) => M + (M * N + i) * 2 + 1;

  const ops = [];
  let depth = W;                                      // current main-stack depth (the flat witness)
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; }; // copy witness[abs] to top
  const push = (...x) => { for (const o of x) ops.push(o); };
  const reduceOne = [O.OP_DUP, enc(256), O.OP_GREATERTHANOREQUAL, O.OP_IF, enc(256), O.OP_SUB, O.OP_SWAP, O.OP_1ADD, O.OP_SWAP, O.OP_ENDIF];

  // PHASE 1 — per output: build amount_ser_j from gadget-tied b_ser limbs, assert == committed_amount_ser_j.
  for (let j = 0; j < M; j++) {
    push(O.OP_0); depth += 1;                         // acc = empty (amount_ser_j accumulator)
    for (let i = 0; i < N; i++) {
      pick(outNumAbs(j, i)); pick(outSerAbs(j, i));   // copies: [.., acc, num, ser]
      push(...limbConsistencyVerifyOps()); depth -= 2; // WELD num<->ser to one v∈[0,255] (aborts on divergence) -> [.., acc]
      pick(outSerAbs(j, i));                           // [.., acc, ser]
      push(O.OP_CAT); depth -= 1;                      // acc ‖ ser  (LSB→MSB = LE) -> [.., acc']
    }
    push(O.OP_SIZE, enc(N), O.OP_EQUALVERIFY);         // |amount_ser_j| == N  (net depth 0)
    pick(committedAbs(j));                             // [.., amount_ser_j, committed_j]
    push(O.OP_EQUALVERIFY); depth -= 2;                // amount_ser_j == committed_j  -> [..]  (binding: state value == built value)
  }

  // PHASE 2 — conservation: Σ_j out_j_num_i + carry == tgt_num_i per limb (LSB→MSB), carry-out==0, top<2^(8N−1).
  push(O.OP_0, O.OP_TOALTSTACK);                       // carry = 0 on alt (net depth 0)
  for (let i = 0; i < N; i++) {
    pick(tgtNumAbs(i)); pick(tgtSerAbs(i));            // gadget-tie the target limb
    push(...limbConsistencyVerifyOps()); depth -= 2;
    push(O.OP_FROMALTSTACK); depth += 1;               // running = carry
    for (let j = 0; j < M; j++) { pick(outNumAbs(j, i)); push(O.OP_ADD); depth -= 1; } // running += each output's b_num (gadget-tied ∈[0,255])
    push(O.OP_0, O.OP_SWAP); depth += 1;               // [carryOut=0, running]
    for (let k = 0; k < M - 1; k++) push(...reduceOne); // reduce: r<256, carryOut=floor(running/256)≤M−1
    if (i === N - 1) push(O.OP_DUP, enc(128), O.OP_LESSTHAN, O.OP_VERIFY); // MSB: r<128 ⟹ amount < 2^(8N−1)
    pick(tgtNumAbs(i)); push(O.OP_NUMEQUALVERIFY); depth -= 2; // r == tgt_num_i (Σ outputs == input at limb i)
    push(O.OP_TOALTSTACK); depth -= 1;                 // carryOut -> next carry
  }
  push(O.OP_FROMALTSTACK, O.OP_0, O.OP_NUMEQUALVERIFY); // final carry-out == 0 (no overflow)  (net depth 0)

  // CLEANSTACK: drop the W flat-witness originals (all values were PICKed, never consumed), leave exactly [1].
  for (let k = 0; k < W; k++) push(O.OP_DROP);
  push(O.OP_1);
  return ops;
}
export const buildSplitBindMiniLeaf = (M, N) => bells.script.compile(splitBindMiniOps(M, N));

// witness builder (deepest→top). outs = M output amounts (bigint); target = Σ outs (the input). N limbs.
const limbsN = (v, N) => { const x = BigInt(v); const a = []; for (let i = 0; i < N; i++) a.push(Number((x >> BigInt(8 * i)) & 0xffn)); return a; };
const serN = (v, N) => Buffer.from(limbsN(v, N));
export function splitBindMiniWitness(outs, N, { committedOverride, targetOverride } = {}) {
  const M = outs.length;
  const target = targetOverride !== undefined ? BigInt(targetOverride) : outs.reduce((a, b) => a + BigInt(b), 0n);
  const w = [];
  for (let j = 0; j < M; j++) w.push((committedOverride && committedOverride[j] !== undefined) ? serN(committedOverride[j], N) : serN(outs[j], N)); // committed_amount_ser_j
  const tl = limbsN(target, N);
  const ol = outs.map((v) => limbsN(v, N));
  for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) w.push(enc(ol[j][i]), Buffer.from([ol[j][i]]));
  for (let i = 0; i < N; i++) w.push(enc(tl[i]), Buffer.from([tl[i]]));
  return w;
}
