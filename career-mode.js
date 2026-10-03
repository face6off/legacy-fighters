export const CAREER_STAT_KEYS = Object.freeze(['speed','power','defense','stamina','reach']);
export const CAREER_BASE_STAT = 25;
export const CAREER_CREATION_POINTS = 10;
export const CAREER_POINTS_PER_LEVEL = 5;
export const CAREER_MAX_STAT = 100;
export const CAREER_MAX_STATS_LEVEL = 74;

export const CAREER_HAIR_STYLES = Object.freeze([
  ['bald','Bald'],['crew','Crew Cut'],['manbun','Man Bun'],['highfade','High Fade'],
  ['closecrop','Close Crop'],['sideswept','Side Swept'],['flat','Flat Top'],['spikes','Spikes'],
  ['sweptback','Swept Back'],['shaggyblond','Shaggy Blonde'],['blondcrew','Short Crew'],['shortcurl','Short Curls'],['mane','Long Mane'],['twists','Twists']
]);

export const CAREER_BEARD_STYLES = Object.freeze([
  ['none','Clean Shaven'],['goatee','Goatee'],['trim','Trim Beard'],['moustache','Moustache'],['full','Full Beard'],['stubble','Stubble']
]);

export const CAREER_BODY_TYPES = Object.freeze([
  {id:'lean',label:'Lean',width:.82,height:1.02},
  {id:'agile',label:'Agile',width:.88,height:1.13},
  {id:'long',label:'Long Frame',width:.89,height:1.16},
  {id:'striker',label:'Striker',width:.92,height:1.08},
  {id:'athletic',label:'Athletic',width:1.01,height:1.04},
  {id:'balanced',label:'Balanced',width:1.02,height:1.01},
  {id:'solid',label:'Solid',width:1.05,height:.98},
  {id:'grappler',label:'Grappler',width:1.08,height:1.02},
  {id:'brawler',label:'Brawler',width:1.08,height:1.04},
  {id:'power',label:'Power Build',width:1.14,height:1.09},
  {id:'powerhouse',label:'Powerhouse',width:1.14,height:1.08},
  {id:'heavy',label:'Heavyweight',width:1.16,height:1.03},
  {id:'tank',label:'Tank',width:1.29,height:1.08},
  {id:'giant',label:'Giant',width:1.34,height:1.22}
]);

const OPPONENT_FIRST = ['Ace','Blaze','Cruz','Dante','Echo','Flint','Jett','Knox','Mako','Nova','Rex','Rio','Storm','Talon','Vega','Wolf'];
const OPPONENT_LAST = ['Banks','Cross','Drake','Frost','Graves','Holt','King','Lane','Mercer','North','Price','Stone','Vale','West'];

const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const choice = (items,random=Math.random) => items[Math.min(items.length-1,Math.floor(random()*items.length))];
const clone = value => JSON.parse(JSON.stringify(value));

function cleanHex(value,fallback){return /^#[0-9a-f]{6}$/i.test(value||'')?value:fallback;}
function randomColor(random=Math.random){return `#${[0,1,2].map(()=>Math.floor(38+random()*190).toString(16).padStart(2,'0')).join('')}`;}

export function totalCareerStatPointsAtLevel(level){
  return CAREER_STAT_KEYS.length*CAREER_BASE_STAT+CAREER_CREATION_POINTS+Math.max(0,Math.floor(level)-1)*CAREER_POINTS_PER_LEVEL;
}

export function xpForNextLevel(level){return 100+Math.max(0,Math.floor(level)-1)*35;}

export function createCareerProfile(input={}){
  const stats=Object.fromEntries(CAREER_STAT_KEYS.map(key=>[key,clamp(Math.floor(Number(input.stats?.[key])||CAREER_BASE_STAT),CAREER_BASE_STAT,CAREER_BASE_STAT+CAREER_CREATION_POINTS)]));
  const allocated=CAREER_STAT_KEYS.reduce((sum,key)=>sum+stats[key]-CAREER_BASE_STAT,0);
  if(allocated!==CAREER_CREATION_POINTS)throw new Error(`Allocate all ${CAREER_CREATION_POINTS} creation points.`);
  const bodyType=CAREER_BODY_TYPES.some(item=>item.id===input.appearance?.bodyType)?input.appearance.bodyType:'balanced';
  const hairStyle=CAREER_HAIR_STYLES.some(([id])=>id===input.appearance?.hairStyle)?input.appearance.hairStyle:'crew';
  const beard=CAREER_BEARD_STYLES.some(([id])=>id===input.appearance?.beard)?input.appearance.beard:'none';
  return {
    version:1,
    name:String(input.name||'Legacy Rookie').trim().slice(0,20)||'Legacy Rookie',
    level:1,xp:0,skillPoints:0,completedTournamentLevel:0,
    stats,
    appearance:{
      bodyType,hairStyle,beard,
      heightCm:clamp(Math.round(Number(input.appearance?.heightCm)||178),160,205),
      weightLb:clamp(Math.round(Number(input.appearance?.weightLb)||185),130,300),
      skin:cleanHex(input.appearance?.skin,'#b97a56'),hair:cleanHex(input.appearance?.hair,'#241914'),
      outfit:cleanHex(input.appearance?.outfit,'#3a52b8'),accent:cleanHex(input.appearance?.accent,'#ffd23f')
    }
  };
}

export function normalizeCareerProfile(profile){
  if(!profile||typeof profile!=='object')return null;
  const safe=clone(profile);
  safe.level=Math.max(1,Math.floor(Number(safe.level)||1));safe.xp=Math.max(0,Math.floor(Number(safe.xp)||0));safe.skillPoints=Math.max(0,Math.floor(Number(safe.skillPoints)||0));safe.completedTournamentLevel=Math.max(0,Math.floor(Number(safe.completedTournamentLevel)||0));
  safe.stats=Object.fromEntries(CAREER_STAT_KEYS.map(key=>[key,clamp(Math.floor(Number(safe.stats?.[key])||CAREER_BASE_STAT),CAREER_BASE_STAT,CAREER_MAX_STAT)]));
  const bodyType=CAREER_BODY_TYPES.some(item=>item.id===safe.appearance?.bodyType)?safe.appearance.bodyType:'balanced';
  const hairStyle=CAREER_HAIR_STYLES.some(([id])=>id===safe.appearance?.hairStyle)?safe.appearance.hairStyle:'crew';
  const beard=CAREER_BEARD_STYLES.some(([id])=>id===safe.appearance?.beard)?safe.appearance.beard:'none';
  safe.name=String(safe.name||'Legacy Rookie').trim().slice(0,20)||'Legacy Rookie';
  safe.appearance={...safe.appearance,bodyType,hairStyle,beard,heightCm:clamp(Math.round(Number(safe.appearance?.heightCm)||178),160,205),weightLb:clamp(Math.round(Number(safe.appearance?.weightLb)||185),130,300),skin:cleanHex(safe.appearance?.skin,'#b97a56'),hair:cleanHex(safe.appearance?.hair,'#241914'),outfit:cleanHex(safe.appearance?.outfit,'#3a52b8'),accent:cleanHex(safe.appearance?.accent,'#ffd23f')};
  return safe;
}

export function gainCareerXp(profile,amount){
  const next=normalizeCareerProfile(profile);if(!next)return {profile:null,levelsGained:0};
  next.xp+=Math.max(0,Math.round(amount));let levelsGained=0;
  while(next.xp>=xpForNextLevel(next.level)){next.xp-=xpForNextLevel(next.level);next.level+=1;next.skillPoints+=CAREER_POINTS_PER_LEVEL;levelsGained+=1;}
  return {profile:next,levelsGained};
}

export function spendCareerPoint(profile,stat){
  const next=normalizeCareerProfile(profile);
  if(!next||!CAREER_STAT_KEYS.includes(stat)||next.skillPoints<=0||next.stats[stat]>=CAREER_MAX_STAT)return next;
  next.stats[stat]+=1;next.skillPoints-=1;return next;
}

export function nextTournamentMilestone(profile){return Math.max(5,(normalizeCareerProfile(profile)?.completedTournamentLevel||0)+5);}
export function tournamentAvailable(profile){const safe=normalizeCareerProfile(profile);return Boolean(safe&&safe.level>=nextTournamentMilestone(safe));}

export function arenaOpponentLevel(playerLevel,random=Math.random){const roll=random();return Math.max(1,playerLevel+(roll<.78?0:roll<.94?1:2));}
export function tournamentOpponentLevel(playerLevel,isBoss=false,random=Math.random){return Math.max(1,playerLevel+(isBoss?(random()<.55?2:3):(random()<.62?1:2)));}

export function allocateStatsForLevel(level,random=Math.random,weights=null){
  const stats=Object.fromEntries(CAREER_STAT_KEYS.map(key=>[key,CAREER_BASE_STAT]));
  let points=Math.min(CAREER_STAT_KEYS.length*(CAREER_MAX_STAT-CAREER_BASE_STAT),CAREER_CREATION_POINTS+Math.max(0,Math.floor(level)-1)*CAREER_POINTS_PER_LEVEL);
  const activeWeights=weights||Object.fromEntries(CAREER_STAT_KEYS.map(key=>[key,1]));
  while(points>0){
    const available=CAREER_STAT_KEYS.filter(key=>stats[key]<CAREER_MAX_STAT);if(!available.length)break;
    const total=available.reduce((sum,key)=>sum+Math.max(.1,Number(activeWeights[key])||1),0);let roll=random()*total,selected=available[available.length-1];
    for(const key of available){roll-=Math.max(.1,Number(activeWeights[key])||1);if(roll<=0){selected=key;break;}}
    stats[selected]+=1;points-=1;
  }
  return stats;
}

export function fighterFromCareerProfile(profile){
  const safe=normalizeCareerProfile(profile);if(!safe)return null;
  const body=CAREER_BODY_TYPES.find(item=>item.id===safe.appearance.bodyType)||CAREER_BODY_TYPES[5];
  const weightScale=.86+((safe.appearance.weightLb-130)/170)*.24;
  const heightScale=.9+((safe.appearance.heightCm-160)/45)*.2;
  const rating=key=>safe.stats[key]/10;
  return {id:'career-player',name:safe.name,title:`Level ${safe.level} Prospect`,style:'Created Fighter',color:safe.appearance.outfit,accent:safe.appearance.accent,skin:safe.appearance.skin,hair:safe.appearance.hair,speed:rating('speed'),power:rating('power'),defense:rating('defense'),stamina:rating('stamina'),reach:rating('reach'),move:'Career Fighter',special:'Build this fighter through training and competition.',legacy:'none',allowLegacy:false,careerLevel:safe.level,look:{hairStyle:safe.appearance.hairStyle,beard:safe.appearance.beard,width:Number((body.width*weightScale).toFixed(3)),height:Number((body.height*heightScale).toFixed(3)),gear:'fightgloves',mark:'none'}};
}

export function generateCareerOpponent(level,random=Math.random){
  const body=choice(CAREER_BODY_TYPES,random),hairStyle=choice(CAREER_HAIR_STYLES,random)[0],beard=choice(CAREER_BEARD_STYLES,random)[0];
  const profile={name:`${choice(OPPONENT_FIRST,random)} ${choice(OPPONENT_LAST,random)}`,level,xp:0,skillPoints:0,completedTournamentLevel:0,stats:allocateStatsForLevel(level,random),appearance:{bodyType:body.id,hairStyle,beard,heightCm:160+Math.floor(random()*46),weightLb:130+Math.floor(random()*171),skin:randomColor(random),hair:randomColor(random),outfit:randomColor(random),accent:randomColor(random)}};
  const fighter=fighterFromCareerProfile(profile);fighter.id=`career-rival-${Math.floor(random()*1e9)}`;fighter.title=`Level ${level} Contender`;fighter.style='Generated Rival';fighter.careerLevel=level;return fighter;
}

export function generateCareerBoss(template,level,random=Math.random){
  const weights=Object.fromEntries(CAREER_STAT_KEYS.map(key=>[key,Number(template[key])||5]));
  const stats=allocateStatsForLevel(level,random,weights),rating=key=>stats[key]/10;
  return {...clone(template),id:`career-boss-${template.id}`,title:`Level ${level} Boss`,style:'Tournament Boss',speed:rating('speed'),power:rating('power'),defense:rating('defense'),stamina:rating('stamina'),reach:rating('reach'),allowLegacy:true,careerLevel:level};
}

export function careerFightXp(playerLevel,opponentLevel,{boss=false,tournament=false}={}){
  const base=55+Math.max(1,opponentLevel)*8,difference=Math.max(0,opponentLevel-playerLevel),difficultyMultiplier=1+difference*.22;
  return Math.round(base*difficultyMultiplier*(boss?2.5:tournament?1.15:1));
}
