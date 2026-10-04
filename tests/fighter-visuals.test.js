import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotVisualState, hitPoseAngle, reconcileSnapshotVisuals } from '../fighter-visuals.js';

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


test('updates from the same animation cannot rewind it or replay a completed attack', () => {
  const current = { ...hurt, state: 'jab', stateTime: .25 };
  const packet = { ...hurt, state: 'jab', stateTime: .1, animationSequence: 7 };
  const first = reconcileSnapshotVisuals(current, packet, 0);
  assert.equal(first.stateTime, .25);
  Object.assign(current, first);
  const done = reconcileSnapshotVisuals(current, packet, .3);
  assert.equal(done.state, 'idle');
  Object.assign(current, done);
  assert.equal(reconcileSnapshotVisuals(current, { ...packet, stateTime: .2 }, 0).state, 'idle');
});

test('new attacks and repeated hits can restart even when their state name is unchanged', () => {
  const current = { ...hurt, stateTime: .2 };
  reconcileSnapshotVisuals(current, { ...hurt, animationSequence: 1 }, 0);
  const newHit = reconcileSnapshotVisuals(current, { ...hurt, health: 60, animationSequence: 2 }, 0);
  assert.equal(newHit.stateTime, 0);
  assert.equal(newHit.flash, .13);
  const attack = { ...hurt, state: 'jab', stateTime: .2 };
  reconcileSnapshotVisuals(attack, { ...attack, animationSequence: 3 }, 0);
  assert.equal(reconcileSnapshotVisuals(attack, { ...attack, stateTime: 0, animationSequence: 4 }, 0).stateTime, 0);
});

test('acknowledging a predicted attack preserves its progress, including after completion', () => {
  const current = { ...hurt, state: 'idle', stateTime: 0, predictedAttackState: 'jab', predictedAttackTime: .4 };
  const packet = { ...hurt, state: 'jab', stateTime: .05, animationSequence: 5 };
  assert.equal(reconcileSnapshotVisuals(current, packet, 0, true).state, 'idle');
});
