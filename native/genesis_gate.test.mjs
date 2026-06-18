// audit J — the genesis-launch activation gate fails closed. Pure mock rpc (logic) + one live skip-guarded pass.
// Run: node --test native/genesis_gate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertGenesisLaunchSafe } from './p4/genesisGate.mjs';
import { nodeReachable, rpc } from '../canaries/rpc.mjs';

const ACTIVE = {
  getnetworkinfo: { subversion: '/Bells:3.1.0/', version: 30100 },
  getdeploymentinfo: { script_flags: ['OP_CAT', 'CHECKSIGFROMSTACK', 'INTERNALKEY', 'DEFAULT_CHECK_TEMPLATE_VERIFY_HASH', 'TAPROOT'], deployments: { opcat: { active: true, bip9: { status: 'active' } } } },
  getblockchaininfo: { chain: 'regtest' },
};
const mk = (over = {}) => async (method) => ({ ...ACTIVE, ...over }[method]);

test('J PASS: a fully-active expected build clears the gate', async () => {
  const r = await assertGenesisLaunchSafe({ rpcFn: mk() });
  assert.equal(r.opcatActive, true);
  assert.equal(r.subversion, '/Bells:3.1.0/');
});
test('J HALT: opcat inactive (pre-activation = anyone-can-spend)', async () => {
  await assert.rejects(assertGenesisLaunchSafe({ rpcFn: mk({ getdeploymentinfo: { script_flags: [], deployments: { opcat: { active: false } } } }) }), /not active/i);
});
test('J HALT: wrong subversion (forked / wrong build)', async () => {
  await assert.rejects(assertGenesisLaunchSafe({ rpcFn: mk({ getnetworkinfo: { subversion: '/Satoshi:27.0/' } }) }), /subversion/);
});
test('J HALT: a required script flag is missing at the tip', async () => {
  await assert.rejects(assertGenesisLaunchSafe({ rpcFn: mk({ getdeploymentinfo: { script_flags: ['OP_CAT', 'INTERNALKEY', 'DEFAULT_CHECK_TEMPLATE_VERIFY_HASH'], deployments: { opcat: { active: true } } } }) }), /script flags missing/);
});
test('J HALT: wrong chain when requireChain is set (refuse a test node at real launch)', async () => {
  await assert.rejects(assertGenesisLaunchSafe({ rpcFn: mk(), requireChain: 'main' }), /chain/);
});

const probe = await nodeReachable();
test('J (on-node): the live regtest node clears the gate', { skip: probe.up ? false : 'no regtest node' }, async () => {
  const r = await assertGenesisLaunchSafe({ rpcFn: rpc });
  assert.equal(r.opcatActive, true);
});
