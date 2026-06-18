// Minimal tapscript STACK SIMULATOR for dry-running covenant scripts off-chain before regtest.
// It executes the EXACT op array we feed bells.script.compile (opcodes as numbers + Buffer pushes),
// computing real bytes for the data ops (OP_CAT/SHA256/SIZE/DUP/SWAP/...). The crypto checks are
// modelled structurally: OP_CHECKSIGFROMSTACK (0xcc) pops [sig, msg, pubkey] and asserts msg == the
// expected real sighash (the whole point of the binding); OP_CHECKSIG pops [sig, pubkey] and is
// treated as valid (the spender always signs the REAL sighash). This catches stack-ordering and
// message-assembly bugs — the things that actually cost regtest cycles — without a full interpreter.
import * as bells from 'belcoinjs-lib';

const S = bells.crypto.sha256;
const O = bells.opcodes;
const NUM = bells.script.number;

// reverse map opcode-number -> name (for the ops we model)
const NAME = {};
for (const [k, v] of Object.entries(O)) NAME[v] = k;

const isTruthy = (b) => {
  if (!Buffer.isBuffer(b) || b.length === 0) return false;
  for (let i = 0; i < b.length; i++) {
    if (b[i] !== 0) return !(i === b.length - 1 && b[i] === 0x80); // 0x80 trailing = negative zero = false
  }
  return false;
};

// ops: array of (Buffer = push) | (number = opcode) | (0xcc = CSFS).
// initialStack: witness buffers, DEEPEST FIRST (same order as spendHex witnessData).
// expectedSighash: the Buffer that OP_CHECKSIGFROMSTACK's message arg must equal.
const MAX_ELEM = 520; // BIP-342 / consensus MAX_SCRIPT_ELEMENT_SIZE (N4 fix)
const guard = (b) => { if (b.length > MAX_ELEM) throw new Error(`element size ${b.length} > ${MAX_ELEM} (MAX_SCRIPT_ELEMENT_SIZE)`); return b; };

export function runScript(ops, initialStack, expectedSighash) {
  const main = initialStack.map((b) => guard(Buffer.from(b)));
  const alt = [];
  const trace = [];
  let peak = main.length; // audit P: track peak concurrent stack item count (main+alt) vs the consensus MAX_STACK_SIZE=1000
  const pop = (op) => { if (!main.length) throw new Error(`stack underflow at ${op}`); return main.pop(); };
  // N5 fix: model CScriptNum arithmetic. popNum enforces the consensus ≤4-byte MINIMAL operand rule (throws on
  // a >4-byte or non-minimally-encoded operand — exactly the B4 a1/a2 + byte-limb-adder failure class).
  const popNum = (op) => NUM.decode(pop(op), 4, true);
  const pushNum = (n) => main.push(NUM.encode(n));
  const bool = (x) => main.push(x ? Buffer.from([1]) : Buffer.alloc(0));

  // OP_IF/OP_NOTIF/OP_ELSE/OP_ENDIF: a condition stack (Bitcoin-Core vfExec). We execute a normal op only when
  // every enclosing branch is taken. Flow-control ops are processed even inside a skipped branch (to track nesting).
  const condStack = [];
  const fExec = () => condStack.every((c) => c === true);

  for (let pc = 0; pc < ops.length; pc++) {
    if (main.length + alt.length > peak) peak = main.length + alt.length;
    const op = ops[pc];
    const name = op === 0xcc ? 'OP_CHECKSIGFROMSTACK' : (Buffer.isBuffer(op) ? null : NAME[op]);

    // --- flow control (always processed) ---
    if (name === 'OP_IF' || name === 'OP_NOTIF') {
      let v = false;
      if (fExec()) {
        const b = pop(name);
        // MINIMALIF (mandatory in tapscript): the bool must be EXACTLY empty (false) or 0x01 (true).
        if (!(b.length === 0 || (b.length === 1 && b[0] === 1))) throw new Error(`MINIMALIF non-minimal bool @${pc}: ${b.toString('hex')}`);
        v = b.length === 1;
        if (name === 'OP_NOTIF') v = !v;
      }
      condStack.push(v); trace.push(`${name}(${v})`); continue;
    }
    if (name === 'OP_ELSE') {
      if (!condStack.length) throw new Error(`OP_ELSE without OP_IF @${pc}`);
      condStack[condStack.length - 1] = !condStack[condStack.length - 1]; trace.push('OP_ELSE'); continue;
    }
    if (name === 'OP_ENDIF') {
      if (!condStack.length) throw new Error(`OP_ENDIF without OP_IF @${pc}`);
      condStack.pop(); trace.push('OP_ENDIF'); continue;
    }
    // --- inside a non-taken branch: skip everything else ---
    if (!fExec()) { trace.push(`skip(${name ?? 'push'})`); continue; }

    if (Buffer.isBuffer(op)) { main.push(guard(Buffer.from(op))); trace.push(`push(${op.length}B)`); continue; }
    // number literals OP_0 / OP_1..OP_16 / OP_1NEGATE
    if (name === 'OP_0' || name === 'OP_FALSE') { main.push(Buffer.alloc(0)); trace.push('OP_0'); continue; }
    if (name === 'OP_1NEGATE') { pushNum(-1); trace.push('OP_1NEGATE'); continue; }
    const lit = /^OP_(\d{1,2})$/.exec(name || '');
    if (lit && +lit[1] >= 1 && +lit[1] <= 16) { pushNum(+lit[1]); trace.push(name); continue; }
    switch (name) {
      case 'OP_TOALTSTACK': alt.push(pop(name)); break;
      case 'OP_FROMALTSTACK': if (!alt.length) throw new Error('alt underflow'); main.push(alt.pop()); break;
      case 'OP_DUP': { const a = pop(name); main.push(a, Buffer.from(a)); break; }
      case 'OP_DROP': pop(name); break;
      case 'OP_SWAP': { const b = pop(name), a = pop(name); main.push(b, a); break; }
      case 'OP_OVER': { const b = pop(name), a = pop(name); main.push(a, b, Buffer.from(a)); break; }
      case 'OP_ROT': { const c = pop(name), b = pop(name), a = pop(name); main.push(b, c, a); break; } // x1 x2 x3 -> x2 x3 x1
      case 'OP_TUCK': { const b = pop(name), a = pop(name); main.push(Buffer.from(b), a, b); break; } // x1 x2 -> x2 x1 x2
      case 'OP_2DUP': { const b = pop(name), a = pop(name); main.push(a, b, Buffer.from(a), Buffer.from(b)); break; } // x1 x2 -> x1 x2 x1 x2
      case 'OP_NIP': { const b = pop(name); pop(name); main.push(b); break; } // x1 x2 -> x2
      case 'OP_2DROP': { pop(name); pop(name); break; }
      // OP_PICK/OP_ROLL (PROVEN to execute at CONSENSUS on this build, not OP_SUCCESSx — canaries/pick_roll.test.mjs):
      // pop n; PICK copies the item n-back to the top, ROLL moves it. n=0 = top. Enables clean deep-register access.
      case 'OP_PICK': { const n = popNum(name); if (n < 0 || n >= main.length) throw new Error(`OP_PICK index ${n} out of range (depth ${main.length}) @${pc}`); main.push(Buffer.from(main[main.length - 1 - n])); break; }
      case 'OP_ROLL': { const n = popNum(name); if (n < 0 || n >= main.length) throw new Error(`OP_ROLL index ${n} out of range (depth ${main.length}) @${pc}`); main.push(main.splice(main.length - 1 - n, 1)[0]); break; }
      case 'OP_CAT': { const b = pop(name), a = pop(name); main.push(guard(Buffer.concat([a, b]))); break; }
      // --- CScriptNum arithmetic (operands enforced ≤4-byte minimal via popNum) ---
      case 'OP_ADD': { const b = popNum(name), a = popNum(name); pushNum(a + b); break; }
      case 'OP_SUB': { const b = popNum(name), a = popNum(name); pushNum(a - b); break; }
      case 'OP_1ADD': { pushNum(popNum(name) + 1); break; }
      case 'OP_1SUB': { pushNum(popNum(name) - 1); break; }
      case 'OP_NEGATE': { pushNum(-popNum(name)); break; }
      case 'OP_ABS': { pushNum(Math.abs(popNum(name))); break; }
      case 'OP_GREATERTHAN': { const b = popNum(name), a = popNum(name); bool(a > b); break; }
      case 'OP_GREATERTHANOREQUAL': { const b = popNum(name), a = popNum(name); bool(a >= b); break; }
      case 'OP_LESSTHAN': { const b = popNum(name), a = popNum(name); bool(a < b); break; }
      case 'OP_LESSTHANOREQUAL': { const b = popNum(name), a = popNum(name); bool(a <= b); break; }
      case 'OP_NUMEQUAL': { const b = popNum(name), a = popNum(name); bool(a === b); break; }
      case 'OP_NUMEQUALVERIFY': { const b = popNum(name), a = popNum(name); if (a !== b) throw new Error(`NUMEQUALVERIFY failed @${pc}: ${a} != ${b}`); break; }
      case 'OP_MIN': { const b = popNum(name), a = popNum(name); pushNum(Math.min(a, b)); break; }
      case 'OP_MAX': { const b = popNum(name), a = popNum(name); pushNum(Math.max(a, b)); break; }
      case 'OP_WITHIN': { const max = popNum(name), min = popNum(name), x = popNum(name); bool(x >= min && x < max); break; }
      case 'OP_BOOLAND': { const b = popNum(name), a = popNum(name); bool(a !== 0 && b !== 0); break; }
      case 'OP_BOOLOR': { const b = popNum(name), a = popNum(name); bool(a !== 0 || b !== 0); break; }
      case 'OP_SIZE': { const a = main[main.length - 1]; if (!a) throw new Error('SIZE empty'); main.push(NUM.encode(a.length)); break; }
      case 'OP_SHA256': main.push(S(pop(name))); break;
      case 'OP_HASH160': main.push(bells.crypto.hash160(pop(name))); break;
      case 'OP_HASH256': main.push(bells.crypto.hash256(pop(name))); break;
      case 'OP_EQUAL': { const b = pop(name), a = pop(name); main.push(a.equals(b) ? Buffer.from([1]) : Buffer.alloc(0)); break; }
      case 'OP_NOT': { const a = pop(name); main.push(isTruthy(a) ? Buffer.alloc(0) : Buffer.from([1])); break; }
      case 'OP_EQUALVERIFY': { const b = pop(name), a = pop(name); if (!a.equals(b)) throw new Error(`EQUALVERIFY failed @${pc}: ${a.toString('hex')} != ${b.toString('hex')}`); break; }
      case 'OP_VERIFY': { const a = pop(name); if (!isTruthy(a)) throw new Error(`VERIFY failed @${pc}`); break; }
      case 'OP_CHECKSIGFROMSTACK': {
        const pubkey = pop(name), msg = pop(name), sig = pop(name);
        if (expectedSighash && !msg.equals(expectedSighash)) throw new Error(`CSFS message != real sighash @${pc}: computed=${msg.toString('hex')} real=${expectedSighash.toString('hex')}`);
        if (sig.length !== 64 || pubkey.length !== 32) throw new Error(`CSFS bad sig/pubkey len @${pc}`);
        main.push(Buffer.from([1]));
        break;
      }
      case 'OP_CHECKSIG': {
        const pubkey = pop(name), sig = pop(name);
        // SIGHASH_DEFAULT = a bare 64-byte Schnorr sig; a non-default flag (e.g. ALL|ANYONECANPAY 0x81) appends a 1-byte
        // hash_type ⟹ 65 bytes, and BIP-341 forbids an appended hash_type of 0x00. (The sig itself is still modelled as valid.)
        const okSig = sig.length === 64 || (sig.length === 65 && sig[64] !== 0x00);
        if (!okSig || pubkey.length !== 32) throw new Error(`CHECKSIG bad len @${pc}`);
        main.push(Buffer.from([1]));
        break;
      }
      default: throw new Error(`unmodelled opcode ${name ?? op} @${pc}`);
    }
    trace.push(`${name} -> depth ${main.length}/${alt.length}`);
  }
  if (condStack.length) throw new Error('unbalanced OP_IF/OP_ENDIF (missing OP_ENDIF)');
  if (main.length + alt.length > peak) peak = main.length + alt.length;
  const ok = main.length === 1 && isTruthy(main[0]);
  return { ok, main, alt, trace, peakStack: peak };
}
