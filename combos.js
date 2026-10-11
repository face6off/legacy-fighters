export const COMBO_BUFFER_SECONDS = .35;
export const COMBOS = Object.freeze([
  { id:'one-two', name:'One-Two', actions:['jab','cross'] },
  { id:'triple-strike', name:'Triple Strike', actions:['jab','jab','cross'] },
  { id:'low-high', name:'Low-High', actions:['kick','jab','cross'] },
  { id:'double-kick', name:'Double Kick', actions:['kick','heavyKick'] },
  { id:'mixed-finish', name:'Mixed Finish', actions:['jab','cross','heavyKick'] },
]);
export function comboPrefix(actions) {
  return COMBOS.some(combo => actions.length <= combo.actions.length && actions.every((action,i) => combo.actions[i] === action));
}
export function completedCombo(actions) {
  return COMBOS.find(combo => actions.length === combo.actions.length && actions.every((action,i) => combo.actions[i] === action)) || null;
}
export function comboDamageScale(length) { return Math.pow(.86, Math.max(0, length - 1)); }
export function attackMotion(move, time) {
  const smooth = x => { const t=Math.max(0,Math.min(1,x)); return t*t*(3-2*t); };
  const anticipation = move.startup * .55;
  const extension = time < anticipation ? 0 : time <= move.activeEnd
    ? smooth((time-anticipation)/(move.startup-anticipation))
    : 1-smooth((time-move.activeEnd)/(move.duration-move.activeEnd));
  const windup = time < move.startup ? Math.sin(Math.PI*Math.min(1,time/move.startup)) : 0;
  const recovery = smooth((time-move.activeEnd)/(move.duration-move.activeEnd));
  return { extension, windup, recovery };
}
