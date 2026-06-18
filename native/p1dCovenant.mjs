// P1d-v1 conservation GATE (mono-input / mono-output) — the anti-inflation core, built by composing
// PROVEN primitives. Conservation is enforced BY CONSTRUCTION: the covenant proves the spent input's
// token amount via backtrace (P1c) and then BUILDS the output token-state from that SAME proven amount,
// binding it to the real tx output via sha_outputs + CSFS+CHECKSIG (B4 mechanism). There is no separate
// "output amount" witness to forge — any real output committing a different amount makes the reconstructed
// sha_outputs differ from the real one, so the shared (sig, P) cannot satisfy both CSFS (computed sighash)
// and CHECKSIG (real sighash) -> reject. (SECURITY_PLAN §7 P1d-v1; conservation-design workflow 2026-06-13.)
//
// Witness deepest->top (the array passed to spendHex, i.e. witnessData[0] = deepest):
//   [ sig, P, c1=pre_sh, c2=shaPrevouts, c3=shaAmounts, c4=shaScriptPubKeys, c5=shaSequences,
//     c7=mid, c8=leafHash, c9=post_sh, out1, out_owner, post, pre, amount_in_ser, owner_in ]
// (c6 = shaOutputs is COMPUTED in-script. c2=shaPrevouts is passed directly = the B4 canary shortcut;
//  the production guard MUST route c2 through P1b so the input prev-txid is itself bound.)
import * as bells from 'belcoinjs-lib';
import { TAPSIGHASH_TAG, CSFS_PUBKEY_SIG_PINS } from './sighashParts.mjs';

const O = bells.opcodes;
const N = bells.script.number;
const OP_CSFS = 0xcc;
export const STATE_VERSION = 0x01;
// canonical state output FRAME = value(8=00)‖scriptlen(0x22)‖OP_RETURN(0x6a)‖PUSH32(0x20)
export const FRAME = Buffer.concat([Buffer.alloc(8, 0), Buffer.from([0x22, 0x6a, 0x20])]);

// Returns the op array (numbers + Buffers) — fed to BOTH bells.script.compile and the stack simulator.
// ownerAuth=true (P2-2): welds OWNER-AUTH into the conservation gate — the binding key P is forced to be the
// BACKTRACE-PROVEN input owner (`hash160(P)==owner_in`), so the SAME (sig,P) that introspects the sighash ALSO
// authorizes as the owner. Only the current owner's private key can spend (GPT-validated: P is no longer
// ephemeral, it IS the owner key; the spender keeps no useful freedom in P short of a hash160 preimage/the privkey).
export function p1dOps({ tokenId, preLen, committedTxid, ownerAuth = false }) {
  const VTI = Buffer.concat([Buffer.from([STATE_VERSION]), tokenId]);              // 0x01 ‖ token_id (37B)
  const prefix = Buffer.concat([TAPSIGHASH_TAG, TAPSIGHASH_TAG, Buffer.from([0x00])]); // 65B
  return [
    // ===== STAGE 1: P1c — prove the INPUT token amount (amount_in_ser), carry a copy to the alt stack =====
    // start (top->): owner_in, amount_in_ser, pre, post, ...
    O.OP_SIZE, N.encode(20), O.OP_EQUALVERIFY,   // pin |owner_in| == 20 (GPT nuance: canonical 65B state + P2-2)
    ...(ownerAuth ? [O.OP_DUP, O.OP_TOALTSTACK] : []), // P2-2: carry a copy of owner_in -> alt (for the owner-auth check)
    O.OP_SWAP,                                   // top=amount_in_ser, 2nd=owner_in
    O.OP_SIZE, N.encode(8), O.OP_EQUALVERIFY,    // pin |amount_in_ser| == 8  (CAT1)
    O.OP_DUP, Buffer.alloc(8, 0), O.OP_EQUAL, O.OP_NOT, O.OP_VERIFY, // reject zero-amount note (GPT)
    O.OP_DUP, O.OP_TOALTSTACK,                   // carry a copy of amount_in_ser -> alt (for STAGE 4)
    VTI, O.OP_SWAP, O.OP_CAT,                    // VTI ‖ amount_in_ser
    O.OP_SWAP, O.OP_CAT,                         // (VTI‖amount_in_ser) ‖ owner_in = input_state(65)
    O.OP_SHA256,                                 // stateHash_in
    FRAME, O.OP_SWAP, O.OP_CAT,                  // FRAME ‖ stateHash_in = stateOut_in(43)
    O.OP_SWAP,                                   // top=pre, 2nd=stateOut_in
    O.OP_SIZE, N.encode(preLen), O.OP_EQUALVERIFY, // pin |pre| (fixed input vout)
    O.OP_SWAP, O.OP_CAT,                         // pre ‖ stateOut_in
    O.OP_SWAP, O.OP_CAT,                         // (pre‖stateOut_in) ‖ post = prevTx
    O.OP_SHA256, O.OP_SHA256,                    // hash256(prevTx)
    committedTxid, O.OP_EQUALVERIFY,             // == committed prev-txid  (input amount now PROVEN; copy on alt)

    // ===== STAGE 4a: build the OUTPUT token-state from the PROVEN input amount + the recipient owner =====
    // start (top->): out_owner, out1, c9, c8, c7, c5, c4, c3, c2, c1, P, sig ; alt: [amtcopy]
    O.OP_SIZE, N.encode(20), O.OP_EQUALVERIFY,   // pin |out_owner| == 20  (CAT1)
    VTI, O.OP_FROMALTSTACK, O.OP_CAT,            // VTI ‖ amtcopy   (the proven input amount)
    O.OP_SWAP, O.OP_CAT,                         // (VTI‖amount) ‖ out_owner = out_state(65)
    O.OP_SHA256,                                 // stateHash_out
    FRAME, O.OP_SWAP, O.OP_CAT,                  // FRAME ‖ stateHash_out = out0(43)  (canonical OP_RETURN output)
    O.OP_SWAP, O.OP_CAT,                         // out0 ‖ out1
    O.OP_SHA256,                                 // c6 = sha_outputs = SHA256(out0 ‖ out1)

    // ===== STAGE 4b: assemble the BIP-342 sighash message (VERBATIM b4Covenant.mjs) =====
    O.OP_TOALTSTACK,                             // c6 -> alt
    O.OP_CAT, O.OP_CAT,                          // c7 ‖ c8 ‖ c9
    O.OP_FROMALTSTACK,                           // c6
    O.OP_SWAP, O.OP_CAT,                         // c6 ‖ (c7c8c9)
    O.OP_CAT, O.OP_CAT, O.OP_CAT, O.OP_CAT, O.OP_CAT, // prepend c5..c1 -> message
    prefix, O.OP_SWAP, O.OP_CAT, O.OP_SHA256,    // computed_sighash = SHA256(prefix ‖ message)

    // ===== STAGE 4c: bind computed==real (CSFS over computed + CHECKSIG over real, same sig+P) =====
    // here P, sig sit on the MAIN stack UNDER computed_sighash: (top->) cs, P, sig.
    O.OP_SWAP, O.OP_ROT,                         // -> (top->) sig, P, cs  == b4's post-FROMALTSTACK state
    ...CSFS_PUBKEY_SIG_PINS,                      // pin |P|==32, |sig|==64 at CONSENSUS (BIP-342 footgun; GPT)
    // P2-2 OWNER-AUTH: the binding key P must be the backtrace-proven input owner. Stack [cs, P, sig] (sig top);
    // OP_OVER copies P, hash160 it, compare to the carried owner_in. A non-owner key → EQUALVERIFY fail. (leaves [cs,P,sig])
    ...(ownerAuth ? [O.OP_OVER, O.OP_HASH160, O.OP_FROMALTSTACK, O.OP_EQUALVERIFY] : []),
    O.OP_DUP, O.OP_TOALTSTACK,                   // dup sig -> alt
    O.OP_OVER, O.OP_TOALTSTACK,                  // over = P -> alt
    O.OP_ROT, O.OP_ROT,                          // arrange [sig, cs(msg), P(pubkey)]
    OP_CSFS, O.OP_VERIFY,                        // CSFS over computed_sighash
    O.OP_FROMALTSTACK, O.OP_FROMALTSTACK,        // P, sig
    O.OP_SWAP, O.OP_CHECKSIG,                    // CHECKSIG over the REAL sighash
  ];
}

export const buildP1dScript = (consts) => bells.script.compile(p1dOps(consts));
// P2-2: the conservation gate WITH owner-auth welded in (binding key P == backtrace-proven owner).
export const p2dOps = (consts) => p1dOps({ ...consts, ownerAuth: true });
export const buildP2dScript = (consts) => bells.script.compile(p2dOps(consts));
