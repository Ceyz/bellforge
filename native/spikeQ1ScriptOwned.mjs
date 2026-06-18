// ⚙️ Q1 FEASIBILITY SPIKE (throwaway, NOT a production brick) — the SCRIPT-OWNED auth hook for $BOUND DeFi composability.
// Answers GPT review round-1 Q1: can a token note delegate its spend authorization to a CONTROLLER covenant (a pool/vault)
// WITHOUT a token-owner signature, soundly, on Bellscoin tapscript?
//
// MECHANISM (the B1 introspection pattern with c4 COMPUTED): the note is spendable iff the spending tx is EXACTLY a 2-input
// tx [thisNote@0, controller@1] whose input[1].scriptPubKey == a committed controllerSPK. We reconstruct
//   c4 = shaScriptPubKeys = SHA256( varslice(spk0) ‖ varslice(controllerSPK) )   (the 2-input shaScriptPubKeys preimage)
// with controllerSPK PINNED as a leaf constant at vin1, fold it into the rebuilt tapscript sighash, and bind that to the
// REAL sighash via CSFS(rebuilt)+CHECKSIG(real) over the same ephemeral (sig,P). The binding forces the rebuilt c4 == the
// real shaScriptPubKeys ⟹ vinCount==2 AND input[1].spk == controllerSPK. There is NO owner key check: ANY ephemeral (sig,P)
// over the real sighash passes — authorization is DELEGATED to whatever spend conditions controllerSPK itself enforces.
//
// SCOPE: this isolates the auth hook ONLY. Conservation / replication / N9 lineage compose in the real P2-5 leaf. The
// dummy-UTXO defense (both GPT passes' #1 finding) lives in the CONTROLLER covenant, demonstrated in the test: a permissive
// controller ⟹ the note is stealable; a non-permissive controller (here key-owned; production = N9-style STATE LINEAGE, the
// same tech we already proved) ⟹ a dummy UTXO at controllerSPK cannot authorize. The token hook is controller-agnostic.
import * as bells from 'belcoinjs-lib';
import { TAPSIGHASH_TAG, CSFS_PUBKEY_SIG_PINS } from './sighashParts.mjs';

const O = bells.opcodes;
const OP_CHECKSIGFROMSTACK = 0xcc; // BIP-348 push variant
const B = (...x) => Buffer.from(x);

// ops array (for scriptsim) — controllerSPK is the 34-byte P2TR scriptPubKey of the controller, pinned at vin1.
export function scriptOwnedOps(controllerSPK) {
  if (!Buffer.isBuffer(controllerSPK) || controllerSPK.length !== 34) throw new Error('controllerSPK must be 34B (P2TR)');
  const prefix = Buffer.concat([TAPSIGHASH_TAG, TAPSIGHASH_TAG, B(0x00)]);     // tag‖tag‖epoch (65B)
  const vsliceCtrl = Buffer.concat([B(0x22), controllerSPK]);                  // varslice(controllerSPK), 35B
  return [
    O.OP_TOALTSTACK, O.OP_TOALTSTACK,                       // sig, P -> alt
    // main: [c1, c2, c3, spk0, c5, c6, c7, c8, c9]  (c9 top)
    O.OP_CAT, O.OP_CAT, O.OP_CAT, O.OP_CAT,                 // fold c5..c9 -> one blob
    // main: [c1, c2, c3, spk0, c5c9]
    O.OP_SWAP,                                              // [c1,c2,c3, c5c9, spk0]
    O.OP_SIZE, bells.script.number.encode(34), O.OP_EQUALVERIFY, // pin |spk0| == 34 (CAT1 length-shift guard)
    B(0x22), O.OP_SWAP, O.OP_CAT,                           // varslice(spk0) = 0x22 ‖ spk0
    vsliceCtrl, O.OP_CAT,                                   // ‖ varslice(controllerSPK)  (= the 2-input shaScriptPubKeys preimage)
    O.OP_SHA256,                                            // c4 = shaScriptPubKeys (controllerSPK PINNED at vin1)
    O.OP_SWAP, O.OP_CAT,                                    // c4 ‖ c5c9  = c4..c9
    O.OP_CAT, O.OP_CAT, O.OP_CAT,                           // prepend c3, c2, c1 -> full sighash message
    prefix, O.OP_SWAP, O.OP_CAT, O.OP_SHA256,               // SHA256(prefix ‖ message) = computed_sighash
    O.OP_FROMALTSTACK, O.OP_FROMALTSTACK,                   // P, sig
    ...CSFS_PUBKEY_SIG_PINS,                                // |P|==32, |sig|==64 (BIP-342 footgun)
    O.OP_DUP, O.OP_TOALTSTACK,                              // stash sig
    O.OP_OVER, O.OP_TOALTSTACK,                             // stash P
    O.OP_ROT, O.OP_ROT,                                    // [computed,P,sig] -> [sig,computed,P]
    OP_CHECKSIGFROMSTACK, O.OP_VERIFY,                     // CSFS: sig over computed_sighash under P
    O.OP_FROMALTSTACK, O.OP_FROMALTSTACK,                  // P, sig
    O.OP_SWAP, O.OP_CHECKSIG,                              // CHECKSIG: sig over the REAL sighash
  ];
}

export const buildScriptOwnedLeaf = (controllerSPK) => bells.script.compile(scriptOwnedOps(controllerSPK));
