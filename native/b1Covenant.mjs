// B1 introspection covenant — spendable ONLY if the spending tx's sha_outputs (CSFS-bound to
// the real tapscript sighash) equals a committed H_target. The keystone of the native token.
import * as bells from 'belcoinjs-lib';
import { TAPSIGHASH_TAG, u64, varslice, CSFS_PUBKEY_SIG_PINS } from './sighashParts.mjs';

const O = bells.opcodes;
const OP_CHECKSIGFROMSTACK = 0xcc; // BIP-348 push variant (proven by canary C2d)

// H_target = SHA256( serialized required outputs ) = the sha_outputs the spend must produce.
export function outputsHash(outputs) {
  return bells.crypto.sha256(Buffer.concat(outputs.map((o) => Buffer.concat([u64(o.value), varslice(o.script)]))));
}

// Witness the spender supplies (deepest→top): [c1..c9, P, sig] where
//   c1=pre(hashType‖nVersion‖nLockTime), c2=shaPrevouts, c3=shaAmounts, c4=shaScriptPubKeys,
//   c5=shaSequences, c6=shaOutputs, c7=mid(spendType‖inIndex), c8=leafHash, c9=post(key_version‖codesep)
// The script rebuilds the sighash message via 8×OP_CAT (right-to-left), checks c6==H_target,
// computes the sighash, and BINDS the witness to the real tx via CSFSV (over the rebuilt sighash)
// + CHECKSIG (over the node's real sighash) with the SAME sig+pubkey.
export function buildB1Script(hTarget) {
  const prefix = Buffer.concat([TAPSIGHASH_TAG, TAPSIGHASH_TAG, Buffer.from([0x00])]); // tag‖tag‖epoch (65B)
  return bells.script.compile([
    O.OP_TOALTSTACK, O.OP_TOALTSTACK,                 // sig, P -> altstack
    O.OP_CAT, O.OP_CAT,                               // c8‖c9, c7‖(c8c9)
    O.OP_OVER, hTarget, O.OP_EQUALVERIFY,             // assert c6 (sha_outputs) == H_target
    O.OP_CAT, O.OP_CAT, O.OP_CAT, O.OP_CAT, O.OP_CAT, O.OP_CAT, // c6..c1 -> full message
    prefix, O.OP_SWAP, O.OP_CAT, O.OP_SHA256,         // SHA256(prefix‖message) = computed_sighash
    O.OP_FROMALTSTACK, O.OP_FROMALTSTACK,             // P, sig back
    ...CSFS_PUBKEY_SIG_PINS,                           // pin |P|==32, |sig|==64 (consensus; BIP-342 footgun)
    O.OP_DUP, O.OP_TOALTSTACK,                        // stash a copy of sig
    O.OP_OVER, O.OP_TOALTSTACK,                       // stash a copy of P
    O.OP_ROT, O.OP_ROT,                               // [computed,P,sig] -> [sig,computed,P]
    OP_CHECKSIGFROMSTACK, O.OP_VERIFY,                // CSFS: sig over computed_sighash under P (push 1/0) + VERIFY
    O.OP_FROMALTSTACK, O.OP_FROMALTSTACK,             // P, sig
    O.OP_SWAP, O.OP_CHECKSIG,                         // CHECKSIG: sig over the REAL tapscript sighash -> 1
  ]);
}
