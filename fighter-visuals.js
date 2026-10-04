import { ATTACKS, clamp } from './game-data.js';

export function hitPoseAngle(fighter) {
  if (fighter.throwType) return 0;
  if (fighter.state !== 'hurt') return fighter.ragAngle || 0;
  const progress = clamp(fighter.stateTime / fighter.hurtDuration, 0, 1);
  if (!fighter.knockdown) return fighter.hitDirection * fighter.hitLean * Math.sin(progress * Math.PI);
  let fall;
  if (progress < .28) fall = 1 - Math.pow(1 - progress / .28, 3);
  else if (progress < .7) fall = 1;
  else { const recovery = (progress - .7) / .3; fall = 1 - recovery * recovery * (3 - 2 * recovery); }
  return fighter.knockdownDirection * fall * 1.36;
}

// Advance presentation only. Damage and collision decisions remain on the host.
export function snapshotVisualState(snapshot, elapsed) {
  const age = Math.max(0, elapsed);
  const visual = { ...snapshot, stateTime: snapshot.stateTime + age,
    flash: Math.max(0, snapshot.flash - age), cooldown: Math.max(0, snapshot.cooldown - age),
    stepPhase: snapshot.stepPhase + Math.abs(snapshot.vx) * age * .045 };
  if (visual.throwType) {
    visual.throwTime += age;
    if (visual.throwTime > .92) { visual.throwType = null; visual.throwTime = 0; }
  }
  const duration = ATTACKS[visual.state]?.duration ?? (visual.state === 'hurt' ? visual.hurtDuration : Infinity);
  if (visual.stateTime > duration) {
    visual.state = 'idle'; visual.stateTime = 0; visual.knockdown = false; visual.ragAngle = 0;
  }
  visual.ragAngle = hitPoseAngle(visual);
  return visual;
}
