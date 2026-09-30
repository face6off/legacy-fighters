import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROSTER, clamp, attackDamage, selectCpu } from './game-data.js';

assert.equal(ROSTER.length, 14, 'The full expanded roster should be present');
assert.equal(new Set(ROSTER.map(f => f.id)).size, 14, 'Fighter IDs must be unique');
assert.equal(clamp(120, 0, 100), 100);
assert.equal(clamp(-5, 0, 100), 0);
assert.ok(attackDamage(ROSTER[0], 'heavy') > attackDamage(ROSTER[0], 'light'));
assert.ok(attackDamage(ROSTER[0], 'light', true) < attackDamage(ROSTER[0], 'light'));
assert.notEqual(selectCpu(ROSTER[0].id, () => 0).id, ROSTER[0].id);
assert.equal(new Set(ROSTER.map(f => [f.look.hairStyle, f.look.beard, f.look.width, f.look.height, f.look.gear, f.look.mark].join('|'))).size, ROSTER.length, 'Every fighter needs a unique visual identity');
const gameSource = readFileSync(new URL('./game.js', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
assert.ok(!gameSource.includes('portrait-face'), 'Selection portraits must keep faces free of markings');
assert.ok(!gameSource.includes('fillRect(12,-219'), 'Animated fighters must keep faces free of markings');
for (const fighter of ROSTER) {
  for (const stat of ['speed','power','defense','reach','stamina']) assert.ok(fighter[stat] >= 1 && fighter[stat] <= 10, `${fighter.name} ${stat} is valid`);
  assert.ok(fighter.look.hairStyle && fighter.look.gear, `${fighter.name} has complete appearance data`);
  assert.ok(!('label' in fighter.look), `${fighter.name} does not expose an appearance description`);
}
const stamina = Object.fromEntries(ROSTER.map(fighter => [fighter.id, fighter.stamina]));
assert.ok(stamina.brass > stamina.letsnot && stamina.letsnot > stamina.shake, 'Brass Lee has high stamina, Let’s Not is mid-range, and Shake A Take has low stamina');
assert.ok(gameSource.includes("['STAMINA',selected.stamina]"), 'The selection screen displays stamina');
assert.ok(gameSource.includes('f.stamina/f.maxStamina'), 'The fight HUD displays a stamina bar');
assert.equal(ROSTER.find(f => f.id === 'warrior').look.accessory, 'mask', 'The Warrior wears a mask');
assert.equal(ROSTER.find(f => f.id === 'kayess').look.accessory, 'bandana', 'Kayess Hi wears a bandana');
assert.equal(ROSTER.find(f => f.id === 'beib').style, 'Chain Grappler', 'Beib Medoff has a grappling identity');
assert.ok(pageSource.includes('id="updatesBtn"') && pageSource.includes('id="updatesDialog"'), 'The update log is accessible from the page');
assert.equal((pageSource.match(/class="update-entry/g) || []).length, 1, 'The update log contains one combined entry');
assert.ok(pageSource.includes('VERSION 1.01') && pageSource.includes('THE FIGHTER IDENTITY UPDATE'), 'The combined update is labelled Version 1.01');
console.log('Legacy Fighters: all tests passed.');
