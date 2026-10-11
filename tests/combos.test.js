import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMBOS, comboPrefix, completedCombo, comboDamageScale, attackMotion } from '../combos.js';
import { ATTACKS, canStrike } from '../game-data.js';
test('all five combos have valid prefixes and distinct completed sequences', () => {
  assert.equal(COMBOS.length,5);
  for(const combo of COMBOS){
    for(let i=1;i<=combo.actions.length;i++)assert.ok(comboPrefix(combo.actions.slice(0,i)));
    assert.equal(completedCombo(combo.actions)?.name,combo.name);
  }
  for(const invalid of [['jab','kick'],['jab','jab','jab'],['kick','cross'],['jab','cross','heavyKick','jab']])assert.equal(comboPrefix(invalid),false);
});
test('later hits scale damage down and only combo strikes can hit inside heavy-move minimum range', () => {
  assert.ok(comboDamageScale(3)<comboDamageScale(2)&&comboDamageScale(2)<1);
  const attacker={x:500,facing:1,width:1,reach:6},target={x:620,width:1};
  assert.equal(canStrike(attacker,target,'cross'),false);
  assert.equal(canStrike({...attacker,combo:true},target,'cross'),true);
  assert.equal(canStrike({...attacker,combo:true},{x:400,width:1},'cross'),false);
});
test('regular moves anticipate, reach the opponent during their hit window, then recover', () => {
  for(const kind of ['jab','cross','kick','heavyKick']){
    const move=ATTACKS[kind];
    assert.equal(attackMotion(move,0).extension,0);
    assert.ok(attackMotion(move,move.startup*.4).windup>0);
    assert.equal(attackMotion(move,move.startup).extension,1);
    assert.equal(attackMotion(move,move.duration).extension,0);
  }
});
