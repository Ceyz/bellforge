// SIGHASH_SINGLE|ANYONECANPAY (0x83) tapscript sighash decomposition — for the buyer-funded DEX
// sell-order covenant. Under ACP the preimage drops sha_prevouts/amounts/scriptpubkeys/sequences and
// instead carries THIS input's own data; under SINGLE it commits only output[inIndex]. So the buyer
// can add their own inputs/outputs freely; the covenant pins only output[its_index] (the seller payment).
// Byte layout mirrors belcoinjs-lib hashForWitnessV1 (the ACP/SINGLE branches).
import * as bells from 'belcoinjs-lib';
import { u32, i32, u64, varslice, TAPSIGHASH_TAG } from './sighashParts.mjs';

const S = bells.crypto.sha256;

// input: { txid, vout, value, spk, sequence } (the covenant's own funding input)
// singleOutput: { value, script } (the output at inIndex — the seller payment, constrained)
export function sighashComponentsAcp({ input, singleOutput }) {
  const inputData = Buffer.concat([
    Buffer.from(input.txid, 'hex').reverse(), u32(input.vout),
    u64(input.value), varslice(input.spk), u32(input.sequence),
  ]);
  const shaSingleOutput = S(Buffer.concat([u64(singleOutput.value), varslice(singleOutput.script)]));
  return { inputData, shaSingleOutput };
}

// Reassemble the SINGLE|ACP tapscript sighash from components (what the covenant rebuilds on-stack).
export function reassembleSighashAcp({ version = 2, locktime = 0, hashType = 0x83, inputData, shaSingleOutput, leafHash }) {
  const preA = Buffer.concat([Buffer.from([hashType]), i32(version), u32(locktime), Buffer.from([0x02])]); // +spendType
  const post = Buffer.concat([Buffer.from([0x00]), Buffer.from([0xff, 0xff, 0xff, 0xff])]);                // key_version‖codesep
  const message = Buffer.concat([preA, inputData, shaSingleOutput, leafHash, post]);
  return { message, preA, post, sighash: S(Buffer.concat([TAPSIGHASH_TAG, TAPSIGHASH_TAG, Buffer.from([0x00]), message])) };
}
