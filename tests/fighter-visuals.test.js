import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotVisualState, hitPoseAngle } from '../fighter-visuals.js';

const hurt = { state: 'hurt', stateTime: 0, flash: .13, cooldown: .3, stepPhase: 0,
  vx: 100, health: 70, hurtDuration: .24, throwType: null, throwTime: 0,
  knockdown: false, ragAngle: 0, hitDirection: 1, hitLean: .2, knockdownDirection: 1 };

test('hit presentation advances during a delayed snapshot without changing authoritative health', () => {
  const original = structuredClone(hurt);
  const early = snapshotVisualState(hurt, .06), later = snapshotVisualState(hurt, .2);
  assert.ok(early.flash > 0 && early.flash < hurt.flash);
  assert.equal(later.flash, 0);
  assert.equal(later.health, 70);
  assert.ok(early.ragAngle > 0);
  assert.notEqual(early.ragAngle, later.ragAngle);
  assert.equal(snapshotVisualState(hurt, .3).state, 'idle');
  assert.equal(snapshotVisualState(hurt, .3).ragAngle, 0);
  assert.deepEqual(hurt, original);
});

test('throw and knockdown motion progresses and finishes while packets are delayed', () => {
  const thrown = { ...hurt, throwType: 'suplex', throwTime: .1, hurtDuration: .92 };
  assert.ok(Math.abs(snapshotVisualState(thrown, .2).throwTime - .3) < 1e-9);
  const finished = snapshotVisualState(thrown, 1);
  assert.equal(finished.throwType, null);
  assert.equal(finished.state, 'idle');
  const down = { ...hurt, knockdown: true, hurtDuration: .92 };
  assert.equal(snapshotVisualState(down, .4).ragAngle, 1.36);
  assert.ok(snapshotVisualState(down, .8).ragAngle < 1.36);
  assert.equal(snapshotVisualState(down, 1).knockdown, false);
});

test('a fresh hit restarts its flash after an older hit has expired', () => {
  assert.equal(snapshotVisualState(hurt, .3).flash, 0);
  assert.equal(snapshotVisualState({ ...hurt, health: 60 }, 0).flash, .13);
  assert.equal(hitPoseAngle({ ...hurt, throwType: 'suplex' }), 0);
});

test('delayed attack poses finish and cooldown expires without predicting damage', () => {
  const attack = { ...hurt, state: 'jab', flash: 0, cooldown: .2 };
  const projected = snapshotVisualState(attack, 1);
  assert.equal(projected.state, 'idle');
  assert.equal(projected.cooldown, 0);
  assert.equal(projected.health, attack.health);
  assert.equal(snapshotVisualState(attack, -.1).stateTime, 0);
});
