// P2-1 — OWNER-AUTH primitive (the fund-safety keystone: conservation ≠ ownership).
// A token note's state commits owner = hash160(owner_xonly_pubkey). To authorize a spend, the spender must
// REVEAL P_owner (hash160(P_owner) == the committed owner) AND sign the spend with it (CHECKSIG over the real
// tapscript sighash). Knowing the pubkey (public) is NOT enough — you need the owner's PRIVATE key. This is the
// branch P1d/P1e lack, which is why those covenants are stealable until this composes in. (SECURITY_PLAN §7 P2.)
//
// In the full token, `owner` comes from the BACKTRACE-proven input state (P1c). This isolated primitive commits
// it as a leaf constant to prove the auth mechanism alone (like P1d isolated conservation). Plain CHECKSIG over the
// node-computed tapscript sighash — no CSFS/introspection needed; the owner signs the actual spend.
// Witness (deepest→top): [sig (64B, SIGHASH_DEFAULT), P_owner (32B x-only)].
import * as bells from 'belcoinjs-lib';

const O = bells.opcodes;
const N = bells.script.number;

export function buildOwnerAuthScript(committedOwner) { // committedOwner = hash160(P_owner), 20B
  if (!Buffer.isBuffer(committedOwner) || committedOwner.length !== 20) throw new Error('committedOwner must be 20B hash160');
  return bells.script.compile([
    O.OP_SWAP,                                       // [P_owner, sig] sig on top
    O.OP_SIZE, N.encode(64), O.OP_EQUALVERIFY,       // |sig| == 64 (SIGHASH_DEFAULT — owner commits to ALL outputs)
    O.OP_SWAP,                                       // [sig, P_owner] back
    O.OP_DUP,                                        // sig, P_owner, P_owner
    O.OP_SIZE, N.encode(32), O.OP_EQUALVERIFY,       // |P_owner| == 32 (pubkey-size pin; hash160 also pins it)
    O.OP_HASH160, committedOwner, O.OP_EQUALVERIFY,  // hash160(P_owner) == committed owner
    O.OP_CHECKSIG,                                   // sig over the real tapscript sighash by the owner key
  ]);
}
