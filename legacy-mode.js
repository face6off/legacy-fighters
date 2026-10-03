export const LEGACY_TOTAL_ROUNDS = 5;

const cloneFighter = fighter => ({ ...fighter, look: { ...fighter.look } });
const boundedStat = value => Math.max(1, Math.min(10, value));

function shuffled(items, random = Math.random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

export function createLegacyRun(selected, roster, random = Math.random) {
  const opponents = shuffled(roster.filter(fighter => fighter.id !== selected.id), random);
  return {
    playerId: selected.id,
    fighter: cloneFighter(selected),
    rivals: opponents.slice(0, LEGACY_TOTAL_ROUNDS - 1),
    finalBase: opponents[LEGACY_TOTAL_ROUNDS - 1],
    round: 1,
    inherited: []
  };
}

function strongestTrainableStat(fighter) {
  return ['speed', 'defense', 'stamina']
    .sort((left, right) => fighter[right] - fighter[left])
    .find(stat => fighter[stat] < 10) || 'stamina';
}

export function legacyRewardOptions(defeated) {
  const trait = strongestTrainableStat(defeated);
  const labels = { speed: 'Speed Instinct', defense: 'Defensive Read', stamina: 'Elite Conditioning' };
  return [
    {
      id: 'signature',
      title: defeated.move,
      type: 'INHERIT SIGNATURE',
      detail: `Replace your Legacy Move with ${defeated.move} and its matching technique.`
    },
    {
      id: 'impact',
      title: 'Impact Discipline',
      type: 'INHERIT OFFENSE',
      detail: 'Gain +1 Power and +1 Reach for every remaining fight.'
    },
    {
      id: 'trait',
      stat: trait,
      title: labels[trait],
      type: 'INHERIT TRAIT',
      detail: `Gain +1 ${trait[0].toUpperCase() + trait.slice(1)} and improved fight capacity.`
    }
  ];
}

export function applyLegacyReward(run, defeated, rewardId) {
  const choice = legacyRewardOptions(defeated).find(option => option.id === rewardId);
  if (!choice) return run;
  if (choice.id === 'signature') {
    run.fighter.move = defeated.move;
    run.fighter.special = defeated.special;
    run.fighter.legacy = defeated.legacy;
  } else if (choice.id === 'impact') {
    run.fighter.power = boundedStat(run.fighter.power + 1);
    run.fighter.reach = boundedStat(run.fighter.reach + 1);
  } else {
    run.fighter[choice.stat] = boundedStat(run.fighter[choice.stat] + 1);
  }
  run.inherited.push({ title: choice.title, type: choice.type, from: defeated.name });
  run.round += 1;
  return run;
}

export function buildCounterFighter(base, inheritedFighter) {
  const counter = cloneFighter(base);
  const stats = ['speed', 'power', 'defense', 'stamina'];
  const dominant = stats.sort((left, right) => inheritedFighter[right] - inheritedFighter[left])[0];

  counter.name = 'The Counter';
  counter.title = 'The Final Answer';
  counter.style = 'Adaptive Nemesis';
  counter.move = 'Legacy Breaker';
  counter.special = 'A calculated response built to dismantle the skills you inherited.';
  counter.counterBuild = true;
  counter.speed = boundedStat(Math.max(counter.speed, dominant === 'stamina' ? 10 : 9));
  counter.power = boundedStat(Math.max(counter.power, dominant === 'defense' ? 10 : 8));
  counter.defense = boundedStat(Math.max(counter.defense, dominant === 'power' ? 10 : 9));
  counter.stamina = boundedStat(Math.max(counter.stamina, dominant === 'speed' ? 10 : 9));
  counter.reach = boundedStat(Math.max(counter.reach, inheritedFighter.speed >= 9 ? 10 : 8));
  return counter;
}
