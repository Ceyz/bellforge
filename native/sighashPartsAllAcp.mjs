// SIGHASH_ALL|ANYONECANPAY (0x81) tapscript sighash decomposition — for the BUY pool leaf (the open input set).
// Under ACP the preimage DROPS sha_prevouts/amounts/scriptpubkeys/sequences and carries THIS input's own data inline; under
// ALL it commits sha_outputs (the WHOLE output set, pinning the layout). ⟹ the trader can add funding INPUTS freely but cannot
// rearrange/redirect OUTPUTS, and the input's own VALUE is INLINE so the covenant reads its old reserve `y` directly.
// ⚠️ This is 0x81, NOT the 0x83 SINGLE|ACP in sighashPartsAcp.mjs (which commits only output[inIndex] ⟹ FATAL hidden-output
// omission if used for a pool). Layout difference: sha_outputs is in the OUTPUTS position (before spend_type), and there is NO
// trailing single_output. Byte layout mirrors belcoinjs-lib hashForWitnessV1 (the ALL|ACP branch); verified node-exact by
// sighash_all_acp.test.mjs. Design: docs/DEFI_TOPOLOGY_DESIGN.md §"REVIEW ROUND 2" (Agent A pins).
import * as bells from 'belcoinjs-lib';
import { u32, i32, u64, varslice, TAPSIGHASH_TAG } from './sighashParts.mjs';

const S = bells.crypto.sha256;

// input: { txid, vout, value, spk, sequence } (the covenant's OWN spent input) ; outputs: [{ value, script }] (ALL tx outputs)
export function sighashComponentsAllAcp({ input, outputs }) {
  const inputData = Buffer.concat([
    Buffer.from(input.txid, 'hex').reverse(), u32(input.vout),   // outpoint (36)
    u64(input.value), varslice(input.spk), u32(input.sequence),  // amount (8) ‖ varslice(spk) ‖ nSequence (4)
  ]);
  const shaOutputs = S(Buffer.concat(outputs.map((o) => Buffer.concat([u64(o.value), varslice(o.script)]))));
  return { inputData, shaOutputs };
}

// Reassemble the ALL|ACP tapscript sighash from components (what the covenant rebuilds on-stack).
export function reassembleSighashAllAcp({ version = 2, locktime = 0, hashType = 0x81, inputData, shaOutputs, leafHash }) {
  const pre = Buffer.concat([Buffer.from([hashType]), i32(version), u32(locktime)]);          // hashType ‖ nVersion ‖ nLockTime
  const spendType = Buffer.from([0x02]);                                                      // ext_flag=1 (tapscript), no annex
  const post = Buffer.concat([Buffer.from([0x00]), Buffer.from([0xff, 0xff, 0xff, 0xff])]);   // key_version ‖ codesep
  // ALL ⟹ sha_outputs in the outputs position (before spend_type); ACP ⟹ inputData inline after spend_type; NO trailing single output.
  const message = Buffer.concat([pre, shaOutputs, spendType, inputData, leafHash, post]);
  return { message, pre, spendType, post, sighash: S(Buffer.concat([TAPSIGHASH_TAG, TAPSIGHASH_TAG, Buffer.from([0x00]), message])) };
}
