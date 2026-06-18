// audit J (2026-06-15) — the GENESIS-LAUNCH ACTIVATION GATE. Pre-activation OP_CAT is anyone-can-spend, so the genesis
// mint MUST NOT be broadcast unless the TARGET chain shows the full bundle active on the EXPECTED Bells Core build.
// `freezeDeploy()` only derives the root + checks coverage; this is the fail-closed runbook precondition that wraps it.
// rpcFn is injectable for testing (default = the real JSON-RPC client). Throws (HALT) on any drift; returns the proof on PASS.
import { rpc } from '../../canaries/rpc.mjs';

// the consensus flags the covenant relies on (OP_CAT introspection, CSFS bind, INTERNALKEY/CTV bundle).
export const REQUIRED_SCRIPT_FLAGS = ['OP_CAT', 'CHECKSIGFROMSTACK', 'INTERNALKEY', 'DEFAULT_CHECK_TEMPLATE_VERIFY_HASH'];

export async function assertGenesisLaunchSafe({
  rpcFn = rpc,
  expectedSubversionPrefix = '/Bells:3.1.0',
  requiredScriptFlags = REQUIRED_SCRIPT_FLAGS,
  requireChain = null,           // e.g. 'main' to refuse a regtest/test node at real launch
} = {}) {
  const net = await rpcFn('getnetworkinfo', []);
  const sub = net && net.subversion;
  if (!sub || !sub.startsWith(expectedSubversionPrefix))
    throw new Error(`HALT genesis: node subversion ${JSON.stringify(sub)} does not start with ${expectedSubversionPrefix} (wrong/forked build — re-run sign-off on the exact binary)`);
  if (requireChain) {
    const bci = await rpcFn('getblockchaininfo', []);
    if (bci.chain !== requireChain) throw new Error(`HALT genesis: chain ${bci.chain} != required ${requireChain}`);
  }
  const dep = await rpcFn('getdeploymentinfo', []);
  const opcat = dep && dep.deployments && dep.deployments.opcat;
  const active = opcat && (opcat.active === true || (opcat.bip9 && opcat.bip9.status === 'active'));
  if (!active)
    throw new Error(`HALT genesis: OP_CAT bundle NOT active (deployments.opcat=${JSON.stringify(opcat)}) — pre-activation OP_CAT is anyone-can-spend`);
  const flags = (dep && dep.script_flags) || [];
  const missing = requiredScriptFlags.filter((f) => !flags.includes(f));
  if (missing.length)
    throw new Error(`HALT genesis: required script flags missing at tip: ${missing.join(', ')} (have: ${flags.join(', ')})`);
  return { subversion: sub, version: net.version, opcatActive: true, scriptFlags: flags };
}
