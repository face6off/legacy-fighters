import { hitPoseAngle, snapshotVisualState } from './fighter-visuals.js';
import { multiplayerRequest } from './multiplayer-client.js';
import { ROSTER, STAGES, ATTACKS, clamp, attackDamage, shouldKnockdown, canStrike, selectCpu, resolveFacingDirection } from './game-data.js';
import { LEGACY_TOTAL_ROUNDS, createLegacyRun, legacyRewardOptions, applyLegacyReward, buildCounterFighter } from './legacy-mode.js';
import { CAREER_STAT_KEYS, CAREER_BASE_STAT, CAREER_CREATION_POINTS, CAREER_MAX_STAT, CAREER_HAIR_STYLES, CAREER_BEARD_STYLES, CAREER_BODY_TYPES, xpForNextLevel, createCareerProfile, normalizeCareerProfile, gainCareerXp, spendCareerPoint, nextTournamentMilestone, tournamentAvailable, arenaOpponentLevel, tournamentOpponentLevel, fighterFromCareerProfile, generateCareerOpponent, generateCareerBoss, careerFightXp } from './career-mode.js';

const $ = s => document.querySelector(s);
const rosterEl = $('#roster');
const detailEl = $('#fighterDetail');
const gameShell = $('#gameShell');
const introGate = $('#introGate');
const enterGameBtn = $('#enterGameBtn');
const titleMusic = $('#titleMusic');
const startScreen = $('#startScreen');
const modeScreen = $('#modeScreen');
const multiplayerScreen = $('#multiplayerScreen');
const careerSlotsScreen = $('#careerSlotsScreen');
const careerCreatorScreen = $('#careerCreatorScreen');
const careerHubScreen = $('#careerHubScreen');
const selectScreen = $('#selectScreen');
const stageScreen = $('#stageScreen');
const stageGrid = $('#stageGrid');
const gameScreen = $('#gameScreen');
const canvas = $('#game');
let ctx = canvas.getContext('2d');
const portraitCache = new WeakMap();
const roundBanner = $('#roundBanner');
const resultDialog = $('#resultDialog');
const leaveMatchDialog = $('#leaveMatchDialog');
const legacyRewardDialog = $('#legacyRewardDialog');
const keys = new Set();
const touchActions = new Set();
const DEFAULT_KEYBINDS={left:'a',right:'d',shove:'e',jab:'f',cross:'g',block:'h',kick:'j',heavyKick:'k',special:'r'};
const CONTROL_META={
  left:{label:'Move left',description:'Retreat or advance'},right:{label:'Move right',description:'Advance or retreat'},
  shove:{label:'Shove',description:'Break apart overlapping fighters'},
  jab:{label:'Jab',description:'Fast straight punch'},cross:{label:'Power punch',description:'Slower high-damage punch'},
  kick:{label:'Quick kick',description:'Fast long-range strike'},heavyKick:{label:'Power kick',description:'Heavy knockback strike'},
  block:{label:'Block',description:'Hold to guard while moving'},special:{label:'Legacy move',description:'Use when the gold meter is full'}
};
const DEFAULT_SETTINGS={masterVolume:80,musicVolume:65,effectsVolume:85,screenShake:80,fluidMotion:true,keybinds:DEFAULT_KEYBINDS};
const loadSettings=()=>{try{const saved=JSON.parse(localStorage.getItem('legacyFightersSettings')||'{}');return {...DEFAULT_SETTINGS,...saved,keybinds:{...DEFAULT_KEYBINDS,...saved.keybinds}};}catch{return structuredClone(DEFAULT_SETTINGS);}};
let settings=loadSettings(),rebindingAction=null,settingsPausedGame=false;
const stageImages = Object.fromEntries(STAGES.map(stage => {
  const image = new Image();
  image.src = stage.image;
  return [stage.id, image];
}));

let selected = ROSTER[0], selectedStage = STAGES[0];
let player, cpu, particles = [], sparks = [], shake = 0;
let running = false, paused = false, last = 0, timer = 60, startDelay = 0;
let audioEnabled = true, audioContext;
let introStarted=false,menuRevealed=false,introFrame=0;
let gameMode='classic',challengeRound=1,challengeQueue=[],challengePlayerId=null,legacyRun=null;
const CAREER_STORAGE_KEY='legacyFightersCareerV1',CAREER_SLOT_COUNT=3;
let activeCareerSlot=1; migrateLegacyCareerSave();
let careerProfile=loadCareerProfile(),careerRun=null,creatorStats=Object.fromEntries(CAREER_STAT_KEYS.map(key=>[key,CAREER_BASE_STAT]));
const NETWORK_TICK_MS=40,ROOM_SESSION_KEY='legacyFightersMultiplayerRoom:' + String(window.LEGACY_FIGHTERS_CONFIG?.multiplayerApiUrl || '').trim();
const network={
  code:null,token:null,role:null,room:null,pollTimer:0,syncPending:false,syncQueued:false,
  nextSyncAt:0,inputSequence:0,attackSequence:0,attackAction:null,remoteAttackSequence:0,
  snapshotSequence:0,lastSnapshotSequence:0,targets:null,snapshotReceivedAt:0,resultShown:false,pendingFinalSnapshot:null,
  consecutiveErrors:0,pingMs:0,pingSamples:0,guestAck:0,stageSelectDismissed:false
};

const TITLE_LEAD_SECONDS=2;
const TITLE_TRACKS=[
  {src:'assets/audio/title-theme.mp3?v=1.81.0',drop:15},
  {src:'assets/audio/quebec.mp3?v=1.81.0',drop:24.65},
  {src:'assets/audio/love-scars-2.mp3?v=1.81.0',drop:11.95},
  {src:'assets/audio/zoom.mp3?v=1.81.0',drop:12.05},
  {src:'assets/audio/heatin-up.mp3?v=1.81.0',drop:14.75},
  {src:'assets/audio/whoopty-doo.mp3?v=1.81.0',drop:10.4},
  {src:'assets/audio/ttg.mp3?v=1.81.0',drop:11.7}
];
const INTRO_TRACK_STORAGE_KEY='legacyFightersLastIntroTrackV1';
let activeIntroTrack=null,activeIntroStart=0,introPlaybackStartedAt=0;
let lastPlaylistIndex=-1,playlistAdvancePending=false,playlistAdvanceQueued=false,playlistRetryTimer=0,playlistWatchdogTimer=0,playlistTrackGeneration=0;
function titleVolume(){return audioEnabled*(settings.masterVolume/100)*(settings.musicVolume/100);}
function applyTitleVolume(){titleMusic.volume=titleVolume();}
function revealTitleScreen(){
  if(menuRevealed)return;
  menuRevealed=true;cancelAnimationFrame(introFrame);applyTitleVolume();
  gameShell.classList.remove('intro-hidden');$('#updatesBtn').classList.remove('intro-hidden');
  requestAnimationFrame(()=>gameShell.classList.add('intro-reveal'));
  introGate.classList.add('revealing');document.body.classList.remove('intro-pending');
  setTimeout(()=>{introGate.hidden=true;gameShell.classList.remove('intro-reveal');},650);
}
function syncTitleReveal(){
  if(menuRevealed)return;
  const drop=activeIntroTrack?.drop||0;
  const progress=clamp((titleMusic.currentTime-activeIntroStart)/TITLE_LEAD_SECONDS,0,1);
  titleMusic.volume=titleVolume()*(.35+.65*progress);
  const introElapsed=(performance.now()-introPlaybackStartedAt)/1000;
  if(titleMusic.currentTime>=drop||introElapsed>=2.5){revealTitleScreen();return;}
  introFrame=requestAnimationFrame(syncTitleReveal);
}
function chooseRandomTitleTrack(){
  let previous=lastPlaylistIndex;
  if(previous<0){const saved=localStorage.getItem(INTRO_TRACK_STORAGE_KEY),stored=saved===null?-1:Number(saved);if(Number.isInteger(stored)&&stored>=0&&stored<TITLE_TRACKS.length)previous=stored;}
  const available=TITLE_TRACKS.map((_,index)=>index).filter(index=>index!==previous);
  const next=available[Math.floor(Math.random()*available.length)]??0;
  lastPlaylistIndex=next;
  localStorage.setItem(INTRO_TRACK_STORAGE_KEY,String(next));
  return TITLE_TRACKS[next];
}
function seekTitleMusic(time){
  return new Promise((resolve,reject)=>{
    const target=Math.min(Math.max(0,time),Math.max(0,titleMusic.duration-.1));
    let settled=false;
    const cleanup=()=>{titleMusic.removeEventListener('seeked',done);titleMusic.removeEventListener('error',failed);clearTimeout(timeout);};
    const done=()=>{if(settled)return;settled=true;cleanup();resolve();};
    const failed=()=>{if(settled)return;settled=true;cleanup();reject(new Error('Unable to seek intro track'));};
    const timeout=setTimeout(()=>Math.abs(titleMusic.currentTime-target)<.2?done():failed(),3000);
    titleMusic.addEventListener('seeked',done,{once:true});titleMusic.addEventListener('error',failed,{once:true});
    titleMusic.currentTime=target;
    if(Math.abs(titleMusic.currentTime-target)<.05)setTimeout(done,0);
  });
}
async function startAudioIntro(){
  if(introStarted)return;
  introStarted=true;introGate.classList.add('starting');
  try{
    activeIntroTrack=chooseRandomTitleTrack();activeIntroStart=Math.max(0,activeIntroTrack.drop-TITLE_LEAD_SECONDS);
    playlistTrackGeneration+=1;titleMusic.pause();titleMusic.src=activeIntroTrack.src;titleMusic.load();
    await waitForPlaylistTrack();
    titleMusic.volume=0;await titleMusic.play();titleMusic.pause();
    await seekTitleMusic(activeIntroStart);await titleMusic.play();
    if(Math.abs(titleMusic.currentTime-activeIntroStart)>.35){titleMusic.pause();await seekTitleMusic(activeIntroStart);await titleMusic.play();}
    titleMusic.volume=titleVolume()*.35;introPlaybackStartedAt=performance.now();syncTitleReveal();
  }catch{revealTitleScreen();}
}
function waitForPlaylistTrack(){
  if(titleMusic.readyState>=2)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timeout);titleMusic.removeEventListener('canplay',ready);titleMusic.removeEventListener('error',failed);};
    const ready=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(new Error('Track unavailable'));};
    const timeout=setTimeout(failed,8000);
    titleMusic.addEventListener('canplay',ready,{once:true});titleMusic.addEventListener('error',failed,{once:true});
  });
}
function armPlaylistWatchdog(){
  clearTimeout(playlistWatchdogTimer);playlistWatchdogTimer=0;
  if(!introStarted||!audioEnabled)return;
  const generation=playlistTrackGeneration,finite=Number.isFinite(titleMusic.duration)&&titleMusic.duration>0;
  const remaining=finite?Math.max(.25,titleMusic.duration-titleMusic.currentTime):12;
  playlistWatchdogTimer=setTimeout(()=>{
    playlistWatchdogTimer=0;
    if(generation!==playlistTrackGeneration||!introStarted||!audioEnabled)return;
    const atEnd=titleMusic.ended||(Number.isFinite(titleMusic.duration)&&titleMusic.duration-titleMusic.currentTime<.45);
    if(atEnd)playRandomTitleTrack();else armPlaylistWatchdog();
  },Math.max(1000,(remaining+1.25)*1000));
}
function handleTitlePlaying(){
  if(playlistRetryTimer){clearTimeout(playlistRetryTimer);playlistRetryTimer=0;}
  armPlaylistWatchdog();
}
function queuePlaylistRecovery(){
  if(!introStarted||!audioEnabled||playlistRetryTimer)return;
  playlistRetryTimer=setTimeout(()=>{playlistRetryTimer=0;playRandomTitleTrack();},450);
}
async function playRandomTitleTrack(){
  if(!introStarted||!audioEnabled)return;
  if(playlistAdvancePending){playlistAdvanceQueued=true;return;}
  playlistAdvancePending=true;
  playlistAdvanceQueued=false;
  clearTimeout(playlistWatchdogTimer);playlistWatchdogTimer=0;
  try{
    const nextTrack=chooseRandomTitleTrack();playlistTrackGeneration+=1;titleMusic.pause();titleMusic.autoplay=true;titleMusic.src=nextTrack.src;titleMusic.load();
    await waitForPlaylistTrack();
    if(!audioEnabled)return;
    titleMusic.currentTime=0;applyTitleVolume();await titleMusic.play();
  }catch{queuePlaylistRecovery();}
  finally{
    playlistAdvancePending=false;
    if(playlistAdvanceQueued){playlistAdvanceQueued=false;setTimeout(playRandomTitleTrack,0);}
  }
}

function saveSettings(){localStorage.setItem('legacyFightersSettings',JSON.stringify(settings));}
function careerSlotKey(slot=activeCareerSlot){return `${CAREER_STORAGE_KEY}:slot:${slot}`;}
function escapeHtml(value){return String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));}
function migrateLegacyCareerSave(){const old=localStorage.getItem(CAREER_STORAGE_KEY);if(old&&!localStorage.getItem(careerSlotKey(1))){localStorage.setItem(careerSlotKey(1),old);localStorage.removeItem(CAREER_STORAGE_KEY);}}
function loadCareerProfile(slot=activeCareerSlot){try{return normalizeCareerProfile(JSON.parse(localStorage.getItem(careerSlotKey(slot))||'null'));}catch{return null;}}
function saveCareerProfile(){if(careerProfile)localStorage.setItem(careerSlotKey(),JSON.stringify(careerProfile));}
function displayKey(key){return key===' '?'SPACE':key.length===1?key.toUpperCase():key.toUpperCase();}
function actionHeld(action){return touchActions.has(action)||keys.has(settings.keybinds[action]);}
function actionFromKey(key){return Object.keys(settings.keybinds).find(action=>settings.keybinds[action]===key);}
function showOnly(screen){[startScreen,modeScreen,multiplayerScreen,careerSlotsScreen,careerCreatorScreen,careerHubScreen,selectScreen,stageScreen,gameScreen].forEach(item=>item.classList.toggle('hidden',item!==screen));if(screen!==gameScreen)$('#pauseMenu').classList.add('hidden');$('#pingCounter').classList.toggle('hidden',!(screen===gameScreen&&gameMode==='multiplayer'));window.scrollTo({top:0,behavior:'smooth'});}

function renderControlHelp(){
  const entries=Object.entries(CONTROL_META);
  $('#controlGrid').innerHTML=entries.map(([action,meta])=>`<div><kbd>${displayKey(settings.keybinds[action])}</kbd><strong>${meta.label}</strong><small>${meta.description}</small></div>`).join('');
  $('#gameFooter').innerHTML=[['left','right','MOVE'],['shove',null,'SHOVE'],['jab',null,'JAB'],['cross',null,'POWER PUNCH'],['kick',null,'KICK'],['heavyKick',null,'POWER KICK'],['block',null,'BLOCK'],['special',null,'LEGACY MOVE']].map(([a,b,label])=>`<span><kbd>${displayKey(settings.keybinds[a])}</kbd>${b?`<kbd>${displayKey(settings.keybinds[b])}</kbd>`:''} ${label}</span>`).join('');
}

function renderSettings(){
  for(const id of ['masterVolume','musicVolume','effectsVolume','screenShake']){$(`#${id}`).value=settings[id];$(`#${id}Value`).value=`${settings[id]}%`;}
  $('#fluidMotion').checked=settings.fluidMotion;
  $('#keybindGrid').innerHTML=Object.entries(CONTROL_META).map(([action,meta])=>`<div class="keybind-row"><span>${meta.label}</span><button class="keybind-button ${rebindingAction===action?'listening':''}" data-bind="${action}">${rebindingAction===action?'PRESS A KEY':displayKey(settings.keybinds[action])}</button></div>`).join('');
  document.querySelectorAll('[data-bind]').forEach(button=>button.addEventListener('click',()=>{rebindingAction=button.dataset.bind;renderSettings();}));
  renderControlHelp();
}

function openSettings(){rebindingAction=null;if(running&&!paused){togglePause();settingsPausedGame=true;}renderSettings();$('#settingsDialog').showModal();}
function closeSettings(){if(settingsPausedGame&&running&&paused)togglePause();settingsPausedGame=false;rebindingAction=null;$('#settingsDialog').close();}

function chooseMode(mode){
  if(mode==='multiplayer'){openMultiplayer();return;}
  if(mode==='career'){openCareerMode();return;}
  gameMode=mode;challengeRound=1;challengeQueue=[];challengePlayerId=null;legacyRun=null;
  $('#fightBtn').textContent=mode==='challenge'?'BEGIN THE CHALLENGE':mode==='legacy'?'FORGE YOUR LEGACY':'ENTER THE ARENA';
  $('#selectBackBtn').textContent='BACK TO MODES';
  $('#selectHint').textContent=mode==='legacy'?'Choose your foundation fighter. Victories will let you inherit new skills before the final counter-fight.':mode==='challenge'?'Choose a fighter for the full escalating roster challenge.':'Select a fighter. Your rival will be chosen from the remaining roster.';
  showOnly(selectScreen);
}

const CAREER_STAT_LABELS={speed:'SPEED',power:'POWER',defense:'DEFENSE',stamina:'STAMINA',reach:'REACH'};
function careerPointsRemaining(){return CAREER_CREATION_POINTS-CAREER_STAT_KEYS.reduce((sum,key)=>sum+creatorStats[key]-CAREER_BASE_STAT,0);}
function careerDraftProfile(){
  return {name:$('#careerNameInput').value||'Legacy Rookie',level:1,xp:0,skillPoints:0,completedTournamentLevel:0,stats:{...creatorStats},appearance:{hairStyle:$('#careerHairSelect').value||'crew',beard:$('#careerBeardSelect').value||'none',bodyType:$('#careerBodySelect').value||'balanced',heightCm:Number($('#careerHeightInput').value)||178,weightLb:Number($('#careerWeightInput').value)||185,skin:$('#careerSkinColor').value,hair:$('#careerHairColor').value,outfit:$('#careerOutfitColor').value,accent:$('#careerAccentColor').value}};
}
// Render portraits once with the combat rig so every build and accessory stays aligned.
function fighterPortrait(data){
  if(portraitCache.has(data))return portraitCache.get(data);
  const portrait=document.createElement('canvas');portrait.width=320;portrait.height=340;
  const combatContext=ctx;
  try {
    // Canvas drawing is synchronous; always restore the combat target before returning.
    ctx=portrait.getContext('2d');
    ctx.scale(1.35,1.35);
    const fighter=new Fighter(data,320/2/1.35,1);fighter.y=325;fighter.stepPhase=0;
    drawFighter(fighter,0);
  } finally {ctx=combatContext;}
  const image=portrait.toDataURL();portraitCache.set(data,image);return image;
}
function renderPortrait(element,data){
  element.replaceChildren();
  const image=document.createElement('img');image.className='portrait-image';image.alt='';image.src=fighterPortrait(data);
  element.append(image);
}

function applyCareerPortrait(element,fighter){
  if(!element||!fighter)return;
  renderPortrait(element.querySelector('.portrait'),fighter);
  element.className=`career-portrait fighter-card look-${fighter.look.hairStyle} beard-${fighter.look.beard} accessory-none gear-${fighter.look.gear}`;
  for(const [name,value] of [['--color',fighter.color],['--accent',fighter.accent],['--skin',fighter.skin],['--hair',fighter.hair],['--body-scale',fighter.look.width],['--height-scale',fighter.look.height]])element.style.setProperty(name,value);
}
function renderCareerCreatorStats(){
  const remaining=careerPointsRemaining();$('#careerCreationPoints').textContent=remaining;
  $('#careerCreationStats').innerHTML=CAREER_STAT_KEYS.map(key=>`<div class="career-stat-row"><strong>${CAREER_STAT_LABELS[key]}</strong><div class="career-stat-meter"><i style="width:${creatorStats[key]}%"></i></div><span class="career-stat-value">${creatorStats[key]}</span><span class="career-stat-controls"><button data-creator-stat="${key}" data-delta="-1" ${creatorStats[key]<=CAREER_BASE_STAT?'disabled':''} aria-label="Remove one ${key} point">−</button><button data-creator-stat="${key}" data-delta="1" ${remaining<=0?'disabled':''} aria-label="Add one ${key} point">+</button></span></div>`).join('');
  document.querySelectorAll('[data-creator-stat]').forEach(button=>button.addEventListener('click',()=>{const key=button.dataset.creatorStat,delta=Number(button.dataset.delta);if(delta>0&&careerPointsRemaining()<=0)return;if(delta<0&&creatorStats[key]<=CAREER_BASE_STAT)return;creatorStats[key]+=delta;renderCareerCreatorStats();renderCareerCreatorPreview();}));
}
function renderCareerCreatorPreview(){
  const draft=careerDraftProfile(),fighter=fighterFromCareerProfile(draft);applyCareerPortrait($('#careerCreatorPortrait'),fighter);$('#careerPreviewName').textContent=(draft.name||'Legacy Rookie').toUpperCase();$('#careerHeightValue').value=`${draft.appearance.heightCm} cm`;$('#careerWeightValue').value=`${draft.appearance.weightLb} lb`;
}
function renderCareerCreator(){
  $('#careerHairSelect').innerHTML=CAREER_HAIR_STYLES.map(([id,label])=>`<option value="${id}">${label}</option>`).join('');
  $('#careerBeardSelect').innerHTML=CAREER_BEARD_STYLES.map(([id,label])=>`<option value="${id}">${label}</option>`).join('');
  $('#careerBodySelect').innerHTML=CAREER_BODY_TYPES.map(type=>`<option value="${type.id}">${type.label}</option>`).join('');
  $('#careerHairSelect').value='crew';$('#careerBeardSelect').value='none';$('#careerBodySelect').value='balanced';$('#careerCreatorMessage').textContent='';
  renderCareerCreatorStats();renderCareerCreatorPreview();
}
function createCareerFighter(){
  $('#careerCreatorMessage').textContent='';
  try{careerProfile=createCareerProfile(careerDraftProfile());saveCareerProfile();beep(280,.12,'square');renderCareerHub();showOnly(careerHubScreen);}
  catch(error){$('#careerCreatorMessage').textContent=error.message;beep(58,.09,'square');}
}
function renderCareerSlots(){
  const slots=Array.from({length:CAREER_SLOT_COUNT},(_,index)=>{const slot=index+1,profile=loadCareerProfile(slot);return {slot,profile};});
  $('#careerSaveSlots').innerHTML=slots.map(({slot,profile})=>profile?`<article class="career-save-slot" data-career-slot="${slot}" role="button" tabindex="0"><span>SAVE ${slot} · LEVEL ${profile.level}</span><strong>${escapeHtml(profile.name)}</strong><small>${profile.xp} XP toward the next level · ${profile.skillPoints} skill points available</small><button class="slot-delete" data-delete-career-slot="${slot}">DELETE SAVE</button></article>`:`<article class="career-save-slot empty" data-career-slot="${slot}" role="button" tabindex="0"><span>SAVE ${slot}</span><strong>NEW FIGHTER</strong><small>Create a separate Start Your Legacy career.</small></article>`).join('');
  document.querySelectorAll('[data-career-slot]').forEach(card=>{const open=()=>selectCareerSlot(Number(card.dataset.careerSlot));card.addEventListener('click',open);card.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}});});
  document.querySelectorAll('[data-delete-career-slot]').forEach(button=>button.addEventListener('click',event=>{event.stopPropagation();const slot=Number(button.dataset.deleteCareerSlot);if(confirm(`Delete Save ${slot}? This career cannot be recovered.`)){localStorage.removeItem(careerSlotKey(slot));if(activeCareerSlot===slot)careerProfile=null;renderCareerSlots();}}));
}
function selectCareerSlot(slot){
  activeCareerSlot=clamp(slot,1,CAREER_SLOT_COUNT);careerProfile=loadCareerProfile();careerRun=null;
  if(!careerProfile){creatorStats=Object.fromEntries(CAREER_STAT_KEYS.map(key=>[key,CAREER_BASE_STAT]));showOnly(careerCreatorScreen);renderCareerCreator();return;}
  renderCareerHub();showOnly(careerHubScreen);
}
function openCareerMode(){
  gameMode='career';careerRun=null;renderCareerSlots();showOnly(careerSlotsScreen);
}
function renderCareerUpgradeStats(){
  $('#careerUpgradeStats').innerHTML=CAREER_STAT_KEYS.map(key=>`<div class="career-stat-row"><strong>${CAREER_STAT_LABELS[key]}</strong><div class="career-stat-meter"><i style="width:${careerProfile.stats[key]}%"></i></div><span class="career-stat-value">${careerProfile.stats[key]}</span><span class="career-stat-controls"><button data-upgrade-stat="${key}" ${careerProfile.skillPoints<=0||careerProfile.stats[key]>=CAREER_MAX_STAT?'disabled':''} aria-label="Spend one skill point on ${key}">+</button></span></div>`).join('');
  document.querySelectorAll('[data-upgrade-stat]').forEach(button=>button.addEventListener('click',()=>{careerProfile=spendCareerPoint(careerProfile,button.dataset.upgradeStat);saveCareerProfile();renderCareerHub();beep(310,.045,'square');}));
}
function renderCareerHub(){
  if(!careerProfile)return;
  const fighter=fighterFromCareerProfile(careerProfile),needed=xpForNextLevel(careerProfile.level),milestone=nextTournamentMilestone(careerProfile),available=tournamentAvailable(careerProfile);
  applyCareerPortrait($('#careerHubPortrait'),fighter);$('#careerHubName').textContent=careerProfile.name.toUpperCase();$('#careerHubLevel').textContent=`LEVEL ${careerProfile.level}`;$('#careerLevelLabel').textContent=`LEVEL ${careerProfile.level}`;$('#careerXpLabel').textContent=`${careerProfile.xp} / ${needed} XP`;$('#careerXpFill').style.width=`${Math.min(100,careerProfile.xp/needed*100)}%`;$('#careerHeightLabel').textContent=`${careerProfile.appearance.heightCm} CM`;$('#careerWeightLabel').textContent=`${careerProfile.appearance.weightLb} LB`;$('#careerSkillPoints').textContent=careerProfile.skillPoints;
  $('#careerTournamentStatus').textContent=available?`LEVEL ${milestone} TOURNAMENT READY`:`UNLOCKS AT LEVEL ${milestone}`;$('#careerTournamentBtn').disabled=!available;
  renderCareerUpgradeStats();
}
function buildCareerTournament(){
  const milestone=nextTournamentMilestone(careerProfile),baseLevel=careerProfile.level,opponents=[];
  for(let round=0;round<3;round++){const level=tournamentOpponentLevel(baseLevel,false);const rival=generateCareerOpponent(level);rival.title=`Level ${level} Tournament Rival`;rival.style=`Tournament Round ${round+1}`;opponents.push(rival);}
  const bossLevel=tournamentOpponentLevel(baseLevel,true),bossTemplate=ROSTER[Math.floor(Math.random()*ROSTER.length)];opponents.push(generateCareerBoss(bossTemplate,bossLevel));
  return {type:'tournament',milestone,round:0,opponents,stageId:'ring'};
}
function startCareerActivity(type){
  if(!careerProfile)return;
  if(type==='tournament'&&!tournamentAvailable(careerProfile)){renderCareerHub();return;}
  if(type==='dojo'){const rival=generateCareerOpponent(careerProfile.level);rival.title=`Level ${careerProfile.level} Sparring Partner`;careerRun={type,round:0,opponents:[rival],stageId:'octagon'};}
  else if(type==='arena'){const level=arenaOpponentLevel(careerProfile.level),rival=generateCareerOpponent(level);rival.title=`Level ${level} Arena Rival`;careerRun={type,round:0,opponents:[rival],stageId:'toronto'};}
  else careerRun=buildCareerTournament();
  startCareerMatch();
}
function startCareerMatch(){
  if(!careerProfile||!careerRun)return;
  gameMode='career';const rival=careerRun.opponents[careerRun.round],playerData=fighterFromCareerProfile(careerProfile),difference=Math.max(0,(rival.careerLevel||careerProfile.level)-careerProfile.level),difficulty=careerRun.type==='dojo'?.72:Math.min(1.2,1+difference*.055+(careerRun.type==='tournament'?.03:0));
  selectedStage=STAGES.find(stage=>stage.id===careerRun.stageId)||STAGES[0];player=new Fighter(playerData,310,1);cpu=new Fighter(rival,970,-1,true,difficulty);particles=[];sparks=[];timer=60;startDelay=2.3;running=true;paused=false;last=performance.now();showOnly(gameScreen);if(resultDialog.open)resultDialog.close();$('#pauseBtn').classList.remove('hidden');setLegacyControlEnabled(false);
  const boss=careerRun.type==='tournament'&&careerRun.round===3,label=careerRun.type==='dojo'?'DOJO PRACTICE':careerRun.type==='arena'?`ARENA · LEVEL ${rival.careerLevel}`:boss?`TOURNAMENT BOSS · LEVEL ${rival.careerLevel}`:`TOURNAMENT ${careerRun.round+1}/3 · LEVEL ${rival.careerLevel}`;
  $('#modeBadge').textContent=label;announce(boss?'BOSS FIGHT':careerRun.type==='dojo'?'SPARRING':careerRun.type==='arena'?'ARENA FIGHT':`TOURNAMENT ${careerRun.round+1}`,850);setTimeout(()=>announce('FIGHT!',650),950);requestAnimationFrame(loop);
}
function continueCareerTournament(){careerRun.round+=1;resultDialog.close();startCareerMatch();}
function restartCareerActivity(){
  resultDialog.close();if(!careerRun){openCareerMode();return;}
  if(careerRun.type==='tournament'){if(tournamentAvailable(careerProfile)){careerRun=buildCareerTournament();startCareerMatch();}else{renderCareerHub();showOnly(careerHubScreen);}return;}
  startCareerActivity(careerRun.type);
}

function setLegacyControlEnabled(enabled){const button=document.querySelector('[data-action="special"]');if(button)button.disabled=!enabled;}

function renderRoster() {
  rosterEl.innerHTML = ROSTER.map(f => `
    <button class="fighter-card ${f.id === selected.id ? 'selected' : ''} look-${f.look.hairStyle} beard-${f.look.beard} accessory-${f.look.accessory || 'none'} gear-${f.look.gear}" data-id="${f.id}" style="--color:${f.color};--accent:${f.accent};--skin:${f.skin};--hair:${f.hair};--body-scale:${f.look.width};--height-scale:${f.look.height}">
      <span class="portrait" aria-hidden="true"><img class="portrait-image" src="${fighterPortrait(f)}" alt="" /></span>
      <span class="card-shade"></span>
      <span class="card-info"><span>${f.style}</span><strong>${f.name}</strong></span>
    </button>`).join('');
  rosterEl.querySelectorAll('.fighter-card').forEach(card => card.addEventListener('click', () => {
    selected = ROSTER.find(f => f.id === card.dataset.id);
    renderRoster(); renderDetail(); beep(250, .04, 'square');
  }));
}

function renderDetail() {
  detailEl.innerHTML = `
    <div class="detail-name">${selected.name}<small>${selected.title} · ${selected.style}</small></div>
    <div class="stats">
      ${[['SPEED',selected.speed],['POWER',selected.power],['DEFENSE',selected.defense],['STAMINA',selected.stamina]].map(([n,v]) => `<div class="stat"><span>${n}</span><div class="bar"><i style="width:${v*10}%"></i></div></div>`).join('')}
    </div>
    <div class="move"><strong>${selected.move}</strong><span>${selected.special}</span></div>`;
}

function renderStages() {
  stageGrid.innerHTML = STAGES.map(stage => `
    <button class="stage-card stage-${stage.id} ${stage.id === selectedStage.id ? 'selected' : ''}" data-stage="${stage.id}">
      <span class="stage-art" aria-hidden="true" style="background-image:linear-gradient(180deg,rgba(6,8,16,.02),rgba(6,8,16,.22)),url('${stage.image}')"></span>
      <span class="stage-info"><strong>${stage.name}</strong><small>${stage.subtitle}</small></span>
    </button>`).join('');
  stageGrid.querySelectorAll('.stage-card').forEach(card => card.addEventListener('click', () => {
    selectedStage = STAGES.find(stage => stage.id === card.dataset.stage);
    renderStages();
    $('#stageFightBtn').textContent = `FIGHT AT ${selectedStage.name.toUpperCase()}`;
    beep(220, .04, 'square');
  }));
}

function showStageSelect() {
  showOnly(stageScreen);
  renderStages();
  $('#stageFightBtn').textContent = `FIGHT AT ${selectedStage.name.toUpperCase()}`;
  $('#stageBackBtn').classList.remove('hidden');$('#stageBackBtn').textContent=gameMode==='multiplayer'?'BACK TO ROOM':'BACK TO FIGHTERS';
}

function networkMessage(message='',error=false){
  const element=$('#multiplayerMessage');element.textContent=message;element.classList.toggle('error',error);
}
function networkIndicator(state,label){
  const element=$('#networkStatus');element.className=`network-status ${state}`;element.querySelector('span').textContent=label;
}
function saveRoomSession(){
  if(network.code&&network.token&&network.role)localStorage.setItem(ROOM_SESSION_KEY,JSON.stringify({code:network.code,token:network.token,role:network.role}));
}
function clearRoomSession(){localStorage.removeItem(ROOM_SESSION_KEY);}
function stopRoomPoll(){clearTimeout(network.pollTimer);network.pollTimer=0;}
function resetNetworkState(){
  stopRoomPoll();Object.assign(network,{code:null,token:null,role:null,room:null,syncPending:false,syncQueued:false,nextSyncAt:0,inputSequence:0,attackSequence:0,attackAction:null,remoteAttackSequence:0,snapshotSequence:0,lastSnapshotSequence:0,targets:null,snapshotReceivedAt:0,resultShown:false,pendingFinalSnapshot:null,consecutiveErrors:0,pingMs:0,pingSamples:0,guestAck:0,stageSelectDismissed:false});
}
function updatePing(roundTrip){
  if(!Number.isFinite(roundTrip))return;
  network.pingMs=network.pingSamples?network.pingMs*.72+roundTrip*.28:roundTrip;network.pingSamples+=1;
  const value=Math.round(network.pingMs),element=$('#pingCounter');element.textContent=`PING ${value} MS`;element.classList.toggle('warn',value>130);element.classList.toggle('bad',value>220);
}
function fighterName(id){return ROSTER.find(fighter=>fighter.id===id)?.name||'NO FIGHTER LOCKED';}
async function roomRequest(action,payload={}){
  return multiplayerRequest(`/${network.code}`,{method:'POST',headers:{'Content-Type':'application/json','x-room-token':network.token||''},body:JSON.stringify({action,...payload})});
}
async function fetchRoom(){
  const data=await multiplayerRequest(`/${network.code}`,{headers:{'x-room-token':network.token||''}});
  return data.room;
}
function renderRoom(room){
  network.room=room;$('#multiplayerSetup').classList.add('hidden');$('#multiplayerRoomPanel').classList.remove('hidden');$('#roomCodeDisplay').textContent=room.code;
  $('#hostSlot').classList.toggle('waiting',!room.hostConnected);$('#guestSlot').classList.toggle('waiting',!room.guestConnected);
  $('#hostSlotStatus').textContent=room.hostConnected?'CONNECTED':'RECONNECTING';$('#guestSlotStatus').textContent=room.guestConnected?'CONNECTED':'WAITING FOR PLAYER';
  $('#hostFighterStatus').textContent=room.hostReady?`${fighterName(room.hostFighter).toUpperCase()} · LOCKED IN`:'CHOOSING FIGHTER';
  $('#guestFighterStatus').textContent=room.guestReady?`${fighterName(room.guestFighter).toUpperCase()} · LOCKED IN`:room.guestConnected?'CHOOSING FIGHTER':'NO FIGHTER LOCKED';
  const localReady=room.role==='host'?room.hostReady:room.guestReady,bothReady=room.hostReady&&room.guestReady,primary=$('#multiplayerPrimaryBtn');
  primary.disabled=false;
  if(!room.guestConnected){primary.disabled=true;primary.textContent='WAITING FOR OPPONENT';}
  else if(!localReady)primary.textContent='CHOOSE FIGHTER';
  else if(bothReady&&room.role==='host')primary.textContent='CHOOSE ARENA';
  else if(bothReady){primary.disabled=true;primary.textContent='HOST IS CHOOSING ARENA';}
  else{primary.disabled=true;primary.textContent='WAITING FOR OPPONENT';}
  networkIndicator(room.hostConnected&&(room.guestConnected||room.role==='guest')?'online':'connecting',room.guestConnected?'BOTH PLAYERS CONNECTED':'ROOM ONLINE · WAITING');
}
function routeRoomState(room){
  renderRoom(room);
  if(['waiting','selecting'].includes(room.status)&&network.resultShown){network.resultShown=false;if(resultDialog.open)resultDialog.close();showOnly(multiplayerScreen);}
  if(room.status==='fighting'&&room.hostFighter&&room.guestFighter&&room.stageId&&!running){startMultiplayerMatch(room);return;}
  if(room.status==='finished'&&room.snapshot?.ended&&!network.resultShown){startMultiplayerMatch(room);return;}
  if(room.hostReady&&room.guestReady&&room.role==='host'&&!network.stageSelectDismissed&&!running&&!resultDialog.open&&stageScreen.classList.contains('hidden')){showStageSelect();}
}
function scheduleRoomPoll(delay=650){
  stopRoomPoll();if(!network.code||running)return;
  network.pollTimer=setTimeout(refreshRoom,delay);
}
async function refreshRoom(){
  if(!network.code||running)return;
  try{const room=await fetchRoom();network.consecutiveErrors=0;routeRoomState(room);networkMessage('');scheduleRoomPoll();}
  catch(error){network.consecutiveErrors+=1;networkIndicator(network.consecutiveErrors>3?'error':'reconnecting',network.consecutiveErrors>3?'CONNECTION LOST':'RECONNECTING');networkMessage(error.message,true);if(network.consecutiveErrors<8)scheduleRoomPoll(900);}
}
async function createMultiplayerRoom(){
  networkMessage('CREATING PRIVATE ROOM…');$('#createRoomBtn').disabled=true;
  try{
    const data=await multiplayerRequest('',{method:'POST'});
    resetNetworkState();network.code=data.room.code;network.token=data.token;network.role='host';saveRoomSession();renderRoom(data.room);networkMessage('Share this code with your friend.');scheduleRoomPoll(350);
  }catch(error){networkMessage(error.message,true);}finally{$('#createRoomBtn').disabled=false;}
}
async function joinMultiplayerRoom(){
  const code=$('#joinCodeInput').value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);if(code.length!==6){networkMessage('Enter the full six-character room code.',true);return;}
  networkMessage('JOINING ROOM…');$('#joinRoomBtn').disabled=true;
  try{
    const data=await multiplayerRequest(`/${code}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'join'})});
    resetNetworkState();network.code=data.room.code;network.token=data.token;network.role='guest';saveRoomSession();renderRoom(data.room);networkMessage('Connected. Choose your fighter.');scheduleRoomPoll(350);
  }catch(error){networkMessage(error.message,true);}finally{$('#joinRoomBtn').disabled=false;}
}
async function restoreMultiplayerRoom(){
  let saved;try{saved=JSON.parse(localStorage.getItem(ROOM_SESSION_KEY)||'null');}catch{return false;}
  if(!saved?.code||!saved?.token||!['host','guest'].includes(saved.role))return false;
  network.code=saved.code;network.token=saved.token;network.role=saved.role;
  try{const room=await fetchRoom();routeRoomState(room);networkMessage('Reconnected to your room.');scheduleRoomPoll();return true;}
  catch{resetNetworkState();clearRoomSession();return false;}
}
async function openMultiplayer(){
  gameMode='multiplayer';showOnly(multiplayerScreen);$('#multiplayerSetup').classList.remove('hidden');$('#multiplayerRoomPanel').classList.add('hidden');networkMessage('');
  if(network.code){renderRoom(network.room||{code:network.code,role:network.role,hostConnected:true,guestConnected:false,hostReady:false,guestReady:false});scheduleRoomPoll(50);return;}
  await restoreMultiplayerRoom();
}
function openMultiplayerSelect(){
  if(!network.room?.guestConnected)return;
  gameMode='multiplayer';$('#fightBtn').textContent='LOCK IN FIGHTER';$('#selectBackBtn').textContent='BACK TO ROOM';$('#selectHint').textContent='Choose your online fighter. Your selection locks when you confirm.';showOnly(selectScreen);
}
async function lockMultiplayerFighter(){
  $('#fightBtn').disabled=true;
  try{const data=await roomRequest('selection',{fighter:selected.id});showOnly(multiplayerScreen);routeRoomState(data.room);networkMessage('Fighter locked. Waiting for the room to finish selecting.');scheduleRoomPoll(300);}
  catch(error){networkMessage(error.message,true);}finally{$('#fightBtn').disabled=false;}
}
async function startMultiplayerFromStage(){
  $('#stageFightBtn').disabled=true;
  try{const data=await roomRequest('start',{stageId:selectedStage.id});routeRoomState(data.room);}
  catch(error){networkMessage(error.message,true);showOnly(multiplayerScreen);scheduleRoomPoll();}finally{$('#stageFightBtn').disabled=false;}
}
async function leaveMultiplayerRoom(destination=modeScreen){
  const hadRoom=Boolean(network.code);if(hadRoom)roomRequest('leave').catch(()=>{});
  running=false;paused=false;keys.clear();touchActions.clear();resetNetworkState();clearRoomSession();if(resultDialog.open)resultDialog.close();showOnly(destination);
}
async function resetMultiplayerRoom(){
  try{const data=await roomRequest('reset');running=false;network.resultShown=false;network.targets=null;if(resultDialog.open)resultDialog.close();showOnly(multiplayerScreen);routeRoomState(data.room);networkMessage('Choose fighters for the rematch.');scheduleRoomPoll(250);}
  catch(error){networkMessage(error.message,true);showOnly(multiplayerScreen);}
}

class Fighter {
  constructor(data, x, facing, isCpu=false, difficulty=1) {
    this.data=data; this.x=x; this.y=560; this.facing=facing; this.isCpu=isCpu;
    this.difficulty=difficulty;this.maxHealth=isCpu?Math.round(100+Math.max(0,difficulty-1)*70):100;this.health=this.maxHealth; this.meter=data.allowLegacy===false?0:20; this.maxStamina=65+data.stamina*5; this.stamina=this.maxStamina; this.staminaDelay=0;
    this.vx=0; this.state='idle'; this.stateTime=0; this.cooldown=0; this.hitDone=false; this.flash=0; this.blocking=false; this.aiWait=0;this.throwType=null;this.throwTime=0;
    this.ai=isCpu?createCpuProfile(data,difficulty):null;this.aiPlan='observe';this.aiPlanTime=0;this.aiReaction=0;this.aiAware=false;
    this.remoteControlled=false;this.remoteInput={};
    this.hurtDuration=.3;this.ragAngle=0;this.hitLean=.16;this.hitDirection=1;this.knockdown=false;this.knockdownDirection=1;this.stepPhase=Math.random()*Math.PI*2;this.shoveRoll=1;
  }
  attack(kind) {
    const move=ATTACKS[kind];
    if (!move || this.cooldown>0 || this.state==='hurt' || this.blocking || startDelay>0) return false;
    if (kind==='special' && (this.data.allowLegacy===false || this.meter<100)) return false;
    if(this.stamina<move.stamina){if(!this.isCpu)beep(52,.08,'square');return false;}
    this.stamina-=move.stamina;this.staminaDelay=move.duration+.18;
    this.state=kind; this.stateTime=0; this.hitDone=false;if(kind==='shove')this.shoveRoll=Math.random();
    this.cooldown=move.cooldown;
    if(kind==='special') { this.meter=0; flashScreen(); beep(95,.18,'sawtooth'); }
    else beep(kind==='heavyKick'?92:kind==='kick'?130:kind==='cross'?115:190,.05,'square');
    return true;
  }
  isAttacking(){return Boolean(ATTACKS[this.state]);}
  isActive(){const move=ATTACKS[this.state];return Boolean(move&&!this.hitDone&&this.stateTime>=move.startup&&this.stateTime<=move.activeEnd);}
  update(dt, opponent) {
    this.stateTime += dt; this.cooldown=Math.max(0,this.cooldown-dt); this.flash=Math.max(0,this.flash-dt);this.staminaDelay=Math.max(0,this.staminaDelay-dt);
    this.stepPhase+=Math.abs(this.vx)*dt*.045;
    if(this.state==='hurt'||this.throwType)this.ragAngle=hitPoseAngle(this);
    else this.ragAngle*=Math.pow(.001,dt);
    if(this.throwType){this.throwTime+=dt;if(this.throwTime>.92){this.throwType=null;this.throwTime=0;}}
    if (this.isCpu) this.think(dt, opponent);
    const held=action=>this.remoteControlled?Boolean(this.remoteInput?.[action]):actionHeld(action);
    const attacking=this.isAttacking();
    let movementDirection=0;
    if (!attacking && this.state!=='hurt') {
      this.blocking = (this.isCpu ? this.blocking : held('block')) && this.stamina>0;
      this.state = this.blocking ? 'block' : Math.abs(this.vx)>.1 ? 'walk' : 'idle';
    }
    if (!this.isCpu && !attacking && this.state!=='hurt' && startDelay<=0) {
      movementDirection=(held('right')?1:0)-(held('left')?1:0);
      const desired=movementDirection*(170+this.data.speed*10)*(this.blocking?.45:1);
      this.vx+=(desired-this.vx)*Math.min(1,dt*13);
    }
    if(this.isCpu&&!attacking&&this.state!=='hurt'&&startDelay<=0)movementDirection=Math.sign(this.vx);
    if(!this.isCpu&&(attacking||this.state==='hurt'))this.vx*=Math.pow(.035,dt);
    if (this.blocking){if(this.isCpu)this.vx*=.62;this.stamina=Math.max(0,this.stamina-dt*7);this.staminaDelay=.22;}
    else if(!attacking&&this.state!=='hurt'&&this.staminaDelay<=0)this.stamina=Math.min(this.maxStamina,this.stamina+(8+this.data.stamina*1.55)*dt);
    this.x=clamp(this.x+this.vx*dt,90,1190);if(this.isCpu)this.vx*=Math.pow(.14,dt);
    if(!attacking&&this.state!=='hurt'&&startDelay<=0)this.facing=resolveFacingDirection(this,opponent,movementDirection);
    const duration=ATTACKS[this.state]?.duration??(this.state==='hurt'?this.hurtDuration:99);
    if(this.stateTime>duration && (attacking||this.state==='hurt')) { const wasHurt=this.state==='hurt';this.state='idle';this.stateTime=0;if(wasHurt){this.knockdown=false;this.ragAngle=0;} }
  }
  think(dt, opponent) {
    if(startDelay>0 || this.state==='hurt' || this.isAttacking()) return;
    this.aiWait-=dt;this.aiPlanTime-=dt;this.aiReaction=Math.max(0,this.aiReaction-dt);
    const dx=opponent.x-this.x,dist=Math.abs(dx),toward=Math.sign(dx)||this.facing,threat=opponent.isAttacking()&&dist<245,cpuPace=Math.min(1.25,this.difficulty);
    if(threat&&!this.aiAware){this.aiAware=true;this.aiReaction=this.ai.reactionMin+Math.random()*(this.ai.reactionMax-this.ai.reactionMin);}
    if(!threat){this.aiAware=false;this.aiReaction=0;}
    if(threat&&this.aiReaction>0)return;
    if(this.aiWait>0)return;
    if(dist<46&&this.stamina>=ATTACKS.shove.stamina){this.facing=toward;this.attack('shove');this.aiWait=.18;return;}
    if(threat&&this.stamina>14&&Math.random()<this.ai.guard){this.blocking=true;this.vx=-toward*(35+this.ai.evasion*70);this.aiWait=.16+Math.random()*.12;return;}
    this.blocking=false;
    if(this.stamina<this.maxStamina*.2){this.aiPlan='recover';this.aiPlanTime=.5+Math.random()*.45;}
    if(this.aiPlanTime<=0){const roll=Math.random();this.aiPlan=roll<this.ai.pressure?'pressure':roll<this.ai.pressure+this.ai.evasion?'circle':'observe';this.aiPlanTime=.45+Math.random()*1.05;}
    const ideal=128+this.data.reach*4+(this.ai.rangeBias*25);
    if(this.aiPlan==='recover'){this.vx=-toward*(105+this.data.speed*5)*cpuPace;this.aiWait=.14;return;}
    if(dist>ideal+22){this.vx=toward*(122+this.data.speed*8)*cpuPace;this.aiWait=.11+Math.random()*.08;return;}
    if(dist<ideal-28&&(this.aiPlan==='circle'||Math.random()<this.ai.evasion)){this.vx=-toward*(105+this.data.speed*6)*cpuPace;this.aiWait=.13+Math.random()*.12;return;}
    this.vx=this.aiPlan==='pressure'?toward*45:0;
    const strikeBody={x:this.x,facing:this.facing,width:this.data.look.width,reach:this.data.reach},targetBody={x:opponent.x,width:opponent.data.look.width};
    const powerPunchReady=canStrike(strikeBody,targetBody,'cross'),powerKickReady=canStrike(strikeBody,targetBody,'heavyKick');
    const roll=Math.random(),specialChance=this.meter>=100?this.ai.special:0;
    if(roll<specialChance)this.attack('special');
    else if(roll<specialChance+this.ai.kicks*.45)this.attack(powerKickReady&&Math.random()>=.58?'heavyKick':'kick');
    else if(roll<specialChance+this.ai.kicks*.45+this.ai.power*.38)this.attack(powerPunchReady?'cross':Math.random()<.7?'jab':'kick');
    else this.attack(Math.random()<.7?'jab':'kick');
    this.aiWait=.18+Math.random()*.34;
  }
}

function createCpuProfile(data,difficulty=1){
  if(data.counterBuild){
    return {pressure:.7,evasion:.38,guard:.82,kicks:.58,power:.72,special:.34,rangeBias:.42,reactionMin:.1/difficulty,reactionMax:.22/difficulty};
  }
  const fast=data.speed>=8,defensive=data.defense>=8,powerful=data.power>=9,kicker=['spinKick','roundhouse','counterKick'].includes(data.legacy);
  const boost=Math.max(0,difficulty-1);
  return {pressure:clamp((powerful?.68:fast?.56:.46)+boost*.18,0,0.86),evasion:clamp((fast?.34:.2)+boost*.08,0,.46),guard:clamp((defensive?.72:.46)+boost*.18,0,.84),kicks:kicker?.78:.42,power:powerful?.72:.45,special:.2+data.power*.012+boost*.08,rangeBias:(data.reach-6)/4,reactionMin:(defensive?.16:.22)/difficulty,reactionMax:(defensive?.31:.43)/difficulty};
}

function controlledFighter(){return gameMode==='multiplayer'&&network.role==='guest'?cpu:player;}
function performLocalAttack(action){
  const fighter=controlledFighter(),started=fighter?.attack(action);
  if(started&&gameMode==='multiplayer'){
    network.attackSequence+=1;network.attackAction=action;syncNetwork(true);
  }
  return started;
}
function localNetworkInput(){return {left:actionHeld('left'),right:actionHeld('right'),block:actionHeld('block'),attackAction:network.attackAction,attackSequence:network.attackSequence};}
function fighterSnapshot(f){
  return {x:f.x,vx:f.vx,facing:f.facing,health:f.health,maxHealth:f.maxHealth,stamina:f.stamina,maxStamina:f.maxStamina,meter:f.meter,state:f.state,stateTime:f.stateTime,cooldown:f.cooldown,blocking:f.blocking,flash:f.flash,hurtDuration:f.hurtDuration,ragAngle:f.ragAngle,hitLean:f.hitLean,hitDirection:f.hitDirection,knockdown:f.knockdown,knockdownDirection:f.knockdownDirection,throwType:f.throwType,throwTime:f.throwTime,stepPhase:f.stepPhase};
}
function createNetworkSnapshot(ended=false,winner=null){return {player:fighterSnapshot(player),cpu:fighterSnapshot(cpu),timer,startDelay,ended,winner,guestAck:network.room?.guestSequence||0,serverTime:Date.now()};}
function applySnapshotFighter(f,target,dt,localPrediction=false,preserveAction=false,snapshotAge=0){
  if(!target)return;target=snapshotVisualState(target,snapshotAge);const blend=Math.min(1,dt*(localPrediction?8:15));
  f.x+=(target.x-f.x)*blend;f.vx+=(target.vx-f.vx)*blend;f.health+=(target.health-f.health)*Math.min(1,dt*18);f.stamina+=(target.stamina-f.stamina)*Math.min(1,dt*14);f.meter+=(target.meter-f.meter)*Math.min(1,dt*14);
  if(!preserveAction){f.state=target.state;f.stateTime=target.stateTime;}
  for(const field of ['facing','maxHealth','maxStamina','cooldown','blocking','flash','hurtDuration','ragAngle','hitLean','hitDirection','knockdown','knockdownDirection','throwType','throwTime','stepPhase'])if(target[field]!==undefined)f[field]=target[field];
}
function acceptNetworkSnapshot(snapshot,sequence){
  if(!snapshot||sequence<=network.lastSnapshotSequence)return;
  network.lastSnapshotSequence=sequence;network.snapshotReceivedAt=performance.now();network.targets={player:snapshot.player,cpu:snapshot.cpu};network.timerTarget=snapshot.timer;network.guestAck=Math.max(network.guestAck,snapshot.guestAck||0);startDelay=snapshot.startDelay;
  if(snapshot.ended&&!network.resultShown){applySnapshotFighter(player,snapshot.player,1);applySnapshotFighter(cpu,snapshot.cpu,1);timer=snapshot.timer;showMultiplayerResult(snapshot.winner);}
}
function applyGuestNetworkFrame(dt){
  const snapshotAge=Math.max(0,(performance.now()-network.snapshotReceivedAt)/1000);
  if(network.targets){const pendingLocalAction=network.guestAck<network.inputSequence&&network.targets.cpu.state!=='hurt'&&(cpu.isAttacking()||cpu.state==='block');applySnapshotFighter(player,network.targets.player,dt,false,false,snapshotAge);applySnapshotFighter(cpu,network.targets.cpu,dt,true,pendingLocalAction,snapshotAge);}
  if(Number.isFinite(network.timerTarget)){network.timerTarget=Math.max(0,network.timerTarget-dt);timer+=(network.timerTarget-timer)*Math.min(1,dt*8);}
  const local=cpu,attacking=local.isAttacking();
  if(!attacking&&local.state!=='hurt'&&startDelay<=0){
    const axis=(actionHeld('right')?1:0)-(actionHeld('left')?1:0);local.blocking=actionHeld('block')&&local.stamina>0;const desired=axis*(170+local.data.speed*10)*(local.blocking?.45:1);local.vx+=(desired-local.vx)*Math.min(1,dt*13);local.x=clamp(local.x+local.vx*dt,90,1190);local.facing=resolveFacingDirection(local,player,axis);if(!axis)local.vx*=Math.pow(.08,dt);if(!network.targets)local.state=local.blocking?'block':Math.abs(local.vx)>.1?'walk':'idle';
  }
  for(const fighter of [player,cpu])if(fighter.isAttacking()||fighter.state==='hurt'){
    fighter.stateTime+=dt;
    const duration=ATTACKS[fighter.state]?.duration??fighter.hurtDuration;
    if(fighter.stateTime>duration){fighter.state='idle';fighter.stateTime=0;fighter.knockdown=false;fighter.ragAngle=0;}
  }
}
async function syncNetwork(force=false){
  if(gameMode!=='multiplayer'||!network.code||!network.token)return;
  if(network.syncPending){network.syncQueued=network.syncQueued||force;return;}
  network.syncPending=true;network.inputSequence+=1;
  const payload={input:localNetworkInput(),sequence:network.inputSequence};
  if(network.role==='host'){
    const snapshot=network.pendingFinalSnapshot||(running?createNetworkSnapshot():null);
    if(snapshot){network.snapshotSequence+=1;payload.snapshot=snapshot;payload.snapshotSequence=network.snapshotSequence;}
  }
  const requestStarted=performance.now();try{
    const data=await roomRequest('sync',payload),room=data.room;network.room=room;network.consecutiveErrors=0;networkIndicator('online','LIVE · SYNCHRONIZED');
    updatePing(performance.now()-requestStarted);
    if(network.role==='host'){
      const input=room.guestInput||{};cpu.remoteInput=input;
      if(input.attackSequence>network.remoteAttackSequence){network.remoteAttackSequence=input.attackSequence;if(input.attackAction)cpu.attack(input.attackAction);}
      if(network.pendingFinalSnapshot)network.pendingFinalSnapshot=null;
    }else acceptNetworkSnapshot(room.snapshot,room.snapshotSequence);
  }catch(error){network.consecutiveErrors+=1;networkIndicator(network.consecutiveErrors>3?'error':'reconnecting',network.consecutiveErrors>3?'CONNECTION INTERRUPTED':'RECONNECTING');}
  finally{network.syncPending=false;if(network.syncQueued){network.syncQueued=false;syncNetwork(true);}}
}
function startMultiplayerMatch(room){
  stopRoomPoll();gameMode='multiplayer';network.room=room;network.resultShown=false;network.targets=null;network.lastSnapshotSequence=0;network.snapshotSequence=room.snapshotSequence||0;network.nextSyncAt=0;
  network.inputSequence=(network.role==='host'?room.hostSequence:room.guestSequence)||0;
  network.attackSequence=(network.role==='host'?room.hostInput:room.guestInput)?.attackSequence||0;
  network.remoteAttackSequence=(network.role==='host'?room.guestInput:room.hostInput)?.attackSequence||0;
  const hostData=ROSTER.find(f=>f.id===room.hostFighter),guestData=ROSTER.find(f=>f.id===room.guestFighter),stage=STAGES.find(item=>item.id===room.stageId);
  if(!hostData||!guestData||!stage){networkMessage('The room has invalid match data.',true);showOnly(multiplayerScreen);return;}
  selectedStage=stage;player=new Fighter(hostData,310,1,false);cpu=new Fighter(guestData,970,-1,false);player.remoteControlled=network.role==='guest';cpu.remoteControlled=network.role==='host';
  particles=[];sparks=[];timer=60;startDelay=2.3;running=true;paused=false;last=performance.now();showOnly(gameScreen);if(resultDialog.open)resultDialog.close();$('#pauseBtn').classList.add('hidden');setLegacyControlEnabled(true);
  if(room.snapshot){applySnapshotFighter(player,room.snapshot.player,1);applySnapshotFighter(cpu,room.snapshot.cpu,1);timer=room.snapshot.timer;startDelay=room.snapshot.startDelay;acceptNetworkSnapshot(room.snapshot,room.snapshotSequence);}
  if(room.status==='finished'){draw();return;}
  $('#modeBadge').textContent=`ONLINE ROOM ${room.code} · ${network.role.toUpperCase()}`;announce('ONLINE ROUND',850);setTimeout(()=>announce('FIGHT!',650),950);syncNetwork(true);requestAnimationFrame(loop);
}
function showMultiplayerResult(winner){
  if(network.resultShown)return;network.resultShown=true;running=false;const localSide=network.role,draw=winner==='draw',won=winner===localSide;
  $('#resultTitle').textContent=draw?'DRAW':won?'VICTORY':'DEFEAT';$('#resultKicker').textContent='ONLINE MATCH COMPLETE';
  $('#resultText').textContent=draw?`${player.data.name} and ${cpu.data.name} finish level.`:winner==='host'?`${player.data.name} defeated ${cpu.data.name}.`:`${cpu.data.name} defeated ${player.data.name}.`;
  $('#nextRoundBtn').classList.add('hidden');$('#rematchBtn').classList.remove('hidden');$('#rematchBtn').textContent='PLAY AGAIN';$('#rosterBtn').textContent='LEAVE ROOM';setTimeout(()=>{if(network.resultShown&&!resultDialog.open)resultDialog.showModal();},350);scheduleRoomPoll();
}
function endMultiplayerHostMatch(){
  if(network.role!=='host')return;const winner=player.health===cpu.health?'draw':player.health>cpu.health?'host':'guest';running=false;network.pendingFinalSnapshot=createNetworkSnapshot(true,winner);showMultiplayerResult(winner);syncNetwork(true);
}

function canConnect(attacker,target){
  if(attacker.state==='shove'){
    const distance=Math.abs(target.x-attacker.x),bodyContact=38*(attacker.data.look.width+target.data.look.width);
    if(distance<=bodyContact*.55)return attacker.shoveRoll<.9;
    return distance<=bodyContact+ATTACKS.shove.reach;
  }
  return canStrike(
    {x:attacker.x,facing:attacker.facing,width:attacker.data.look.width,reach:attacker.data.reach},
    {x:target.x,width:target.data.look.width},
    attacker.state
  );
}

function resolveCombat(){
  const pending=[];
  if(player.isActive()&&canConnect(player,cpu))pending.push([player,cpu,player.state]);
  if(cpu.isActive()&&canConnect(cpu,player))pending.push([cpu,player,cpu.state]);
  for(const [attacker] of pending)attacker.hitDone=true;
  for(const [attacker,target,kind] of pending)hit(attacker,target,kind);
}

function hit(attacker, target, kind) {
  const frontBlock=target.blocking&&((attacker.x-target.x)*target.facing>0);
  const defenseFactor=clamp(1.16-target.data.defense*.035,.81,1.08),rawDamage=attackDamage(attacker.data,kind,frontBlock),damage=rawDamage*defenseFactor*(attacker.isCpu?1+Math.max(0,attacker.difficulty-1)*.35:1),move=ATTACKS[kind];
  target.health=clamp(target.health-damage,0,target.maxHealth);attacker.meter=attacker.data.allowLegacy===false?0:clamp(attacker.meter+(kind==='special'?0:damage*2.1),0,100);target.meter=target.data.allowLegacy===false?0:clamp(target.meter+damage*1.15,0,100);
  if(frontBlock){target.stamina=Math.max(0,target.stamina-damage*1.6);target.staminaDelay=.7;if(target.stamina===0){target.blocking=false;target.state='hurt';target.stateTime=0;target.hurtDuration=.32;target.knockdown=false;target.hitDirection=attacker.facing;target.hitLean=.2;}}
  target.flash=.13; target.vx=attacker.facing*move.knockback;
  const grappled=kind==='special'&&['groundSlam','bodySlam','suplex','takedown'].includes(attacker.data.legacy);
  if(grappled){target.throwType=attacker.data.legacy;target.throwTime=0;}
  if(!frontBlock){
    target.blocking=false;target.state='hurt';target.stateTime=0;target.hitDone=true;
    target.knockdown=shouldKnockdown(kind,attacker.data.power);target.knockdownDirection=attacker.facing;target.hitDirection=attacker.facing;
    target.hitLean=kind==='shove'?.24:kind==='heavyKick'?.34:kind==='cross'?.28:kind==='kick'?.22:.15;target.hurtDuration=target.knockdown?(target.health<=0?1.18:.92):grappled?.92:kind==='shove'?.3:kind==='heavyKick'?.4:kind==='cross'?.34:kind==='kick'?.3:.24;target.ragAngle=0;
  }
  shake=(kind==='special'?15:kind==='heavyKick'?10:kind==='cross'?7:kind==='shove'?5:4)*(settings.screenShake/100);
  burst((attacker.x+target.x)/2,target.y-118,kind==='special'?attacker.data.accent:'#fff',kind==='special'?34:14);
  beep(frontBlock?85:kind==='special'?48:68,kind==='special'?.2:.07,'sawtooth');
}

function burst(x,y,color,count){ for(let i=0;i<count;i++) sparks.push({x,y,vx:(Math.random()-.5)*520,vy:(Math.random()-.6)*430,life:.25+Math.random()*.35,color,size:2+Math.random()*7}); }
function flashScreen(){ particles.push({life:.18,max:.18,color:player?.data.accent||'#fff'}); }
function beep(freq,duration,type='sine'){
  const volume=(settings.masterVolume/100)*(settings.effectsVolume/100);
  if(!audioEnabled||volume<=0)return; try { audioContext ||= new (window.AudioContext||window.webkitAudioContext)(); const o=audioContext.createOscillator(),g=audioContext.createGain(); o.type=type;o.frequency.setValueAtTime(freq,audioContext.currentTime);o.frequency.exponentialRampToValueAtTime(Math.max(30,freq*.55),audioContext.currentTime+duration);g.gain.setValueAtTime(.075*volume,audioContext.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+duration);o.connect(g).connect(audioContext.destination);o.start();o.stop(audioContext.currentTime+duration); } catch {}
}

function shuffle(items){for(let i=items.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[items[i],items[j]]=[items[j],items[i]];}return items;}
function prepareChallenge(){challengeQueue=shuffle(ROSTER.filter(f=>f.id!==selected.id));challengePlayerId=selected.id;challengeRound=1;}
function prepareLegacy(){legacyRun=createLegacyRun(selected,ROSTER);}

function startMatch() {
  if(gameMode==='challenge'&&(!challengeQueue.length||challengePlayerId!==selected.id))prepareChallenge();
  if(gameMode==='legacy'&&(!legacyRun||legacyRun.playerId!==selected.id))prepareLegacy();
  const legacyFinal=gameMode==='legacy'&&legacyRun.round===LEGACY_TOTAL_ROUNDS;
  const rival=gameMode==='challenge'?challengeQueue[challengeRound-1]:gameMode==='legacy'?(legacyFinal?buildCounterFighter(legacyRun.finalBase,legacyRun.fighter):legacyRun.rivals[legacyRun.round-1]):selectCpu(selected.id);
  const playerData=gameMode==='legacy'?legacyRun.fighter:selected;
  const difficulty=gameMode==='challenge'?Math.min(1.72,1+(challengeRound-1)*.06):gameMode==='legacy'?(legacyFinal?1.48:1.04+(legacyRun.round-1)*.08):1;
  player=new Fighter(playerData,310,1); cpu=new Fighter(rival,970,-1,true,difficulty);
  particles=[];sparks=[];timer=60;startDelay=2.3;running=true;paused=false;last=performance.now();
  showOnly(gameScreen);if(resultDialog.open)resultDialog.close();if(legacyRewardDialog.open)legacyRewardDialog.close();
  $('#pauseBtn').classList.remove('hidden');setLegacyControlEnabled(true);
  $('#modeBadge').textContent=gameMode==='challenge'?`CHALLENGE ROUND ${challengeRound} · CPU +${Math.round((difficulty-1)*100)}%`:gameMode==='legacy'?`${legacyFinal?'FINAL COUNTER':'LEGACY ROUND '+legacyRun.round} · ${legacyRun.inherited.length} SKILL${legacyRun.inherited.length===1?'':'S'} INHERITED`:'CLASSIC MATCH';
  announce(gameMode==='challenge'?`CHALLENGE ${challengeRound}`:gameMode==='legacy'?(legacyFinal?'THE COUNTER':`LEGACY ${legacyRun.round}`):'ROUND 1',850); setTimeout(()=>announce('FIGHT!',650),950); requestAnimationFrame(loop);
}
function announce(text,time){ roundBanner.textContent=text;roundBanner.classList.add('show');setTimeout(()=>roundBanner.classList.remove('show'),time); }
function endCareerMatch(){
  running=false;const won=player.health>cpu.health,boss=careerRun.type==='tournament'&&careerRun.round===3;let xpEarned=0,levelsGained=0;
  if(won&&careerRun.type!=='dojo'){
    xpEarned=careerFightXp(careerProfile.level,cpu.data.careerLevel||careerProfile.level,{boss,tournament:careerRun.type==='tournament'});
    const gain=gainCareerXp(careerProfile,xpEarned);careerProfile=gain.profile;levelsGained=gain.levelsGained;
    if(boss)careerProfile.completedTournamentLevel=Math.max(careerProfile.completedTournamentLevel,careerRun.milestone);
    saveCareerProfile();
  }
  const tournamentContinue=won&&careerRun.type==='tournament'&&!boss;
  $('#resultTitle').textContent=won?(boss?'TOURNAMENT WON':'VICTORY'):'DEFEAT';
  $('#resultKicker').textContent=careerRun.type==='dojo'?'DOJO SESSION COMPLETE':boss&&won?'BOSS DEFEATED':careerRun.type==='tournament'?`TOURNAMENT FIGHT ${careerRun.round+1}`:'ARENA FIGHT COMPLETE';
  const reward=xpEarned?` +${xpEarned} XP.${levelsGained?` Level up ×${levelsGained}! ${levelsGained*5} skill points earned.`:''}`:'';
  $('#resultText').textContent=won?careerRun.type==='dojo'?`${careerProfile.name} completed the sparring session. Dojo fights do not award XP.`:boss?`${careerProfile.name} conquered the Level ${careerRun.milestone} tournament.${reward}`:`${careerProfile.name} defeated ${cpu.data.name}.${reward}`:careerRun.type==='tournament'?`${cpu.data.name} ended this tournament run. The bracket can be attempted again.`:`${cpu.data.name} won the fight. Return stronger and try again.`;
  $('#nextRoundBtn').classList.toggle('hidden',!tournamentContinue);$('#nextRoundBtn').textContent=boss?'COMPLETE':'NEXT TOURNAMENT FIGHT';
  const canRematch=careerRun.type!=='tournament'||!won;
  $('#rematchBtn').classList.toggle('hidden',!canRematch);$('#rematchBtn').textContent=careerRun.type==='dojo'?'SPAR AGAIN':careerRun.type==='arena'?'FIGHT ANOTHER RIVAL':'RETRY TOURNAMENT';$('#rosterBtn').textContent='RETURN TO FIGHTER HQ';
  setTimeout(()=>resultDialog.showModal(),500);
}
function endMatch(){
  if(gameMode==='multiplayer'){endMultiplayerHostMatch();return;}
  if(gameMode==='career'){endCareerMatch();return;}
  running=false;const won=player.health>cpu.health,challengeComplete=gameMode==='challenge'&&won&&challengeRound>=challengeQueue.length,legacyComplete=gameMode==='legacy'&&won&&legacyRun.round===LEGACY_TOTAL_ROUNDS;
  $('#resultTitle').textContent=challengeComplete?'LEGACY COMPLETE':legacyComplete?'LEGACY FORGED':won?'VICTORY':'DEFEAT';
  $('#resultKicker').textContent=gameMode==='challenge'?won?`CHALLENGE ROUND ${challengeRound} CLEARED`:`CHALLENGE ENDED · ROUND ${challengeRound}`:gameMode==='legacy'?legacyComplete?'THE COUNTER HAS FALLEN':won?`LEGACY ROUND ${legacyRun.round} CLEARED`:`LEGACY RUN ENDED · ROUND ${legacyRun.round}`:'BATTLE COMPLETE';
  $('#resultText').textContent=challengeComplete?`${player.data.name} conquered every challenger and completed the gauntlet.`:legacyComplete?`${player.data.name} overcame an opponent built to counter the inherited legacy.`:won?`${player.data.name} defeated ${cpu.data.name}. ${gameMode==='challenge'?'The next opponent will be stronger.':gameMode==='legacy'?'Claim one of the defeated fighter’s skills before the next round.':'The legacy grows stronger.'}`:`${cpu.data.name} takes the match. Study the rival and return stronger.`;
  const canContinue=(gameMode==='challenge'&&won&&!challengeComplete)||(gameMode==='legacy'&&won&&!legacyComplete);
  $('#nextRoundBtn').classList.toggle('hidden',!canContinue);$('#rematchBtn').classList.toggle('hidden',canContinue||challengeComplete||legacyComplete);
  $('#nextRoundBtn').textContent=gameMode==='legacy'?'CLAIM LEGACY':'NEXT ROUND';
  $('#rematchBtn').textContent=gameMode==='challenge'?'RESTART CHALLENGE':gameMode==='legacy'?'RESTART LEGACY':'REMATCH';$('#rosterBtn').textContent='CHANGE FIGHTER';
  setTimeout(()=>resultDialog.showModal(),500);
}

function showLegacyRewards(defeated){
  const options=legacyRewardOptions(defeated);
  $('#legacyRewardLead').textContent=`Choose one skill from ${defeated.name}. It becomes part of your build for the rest of this run.`;
  $('#legacyRewardGrid').innerHTML=options.map(option=>`<button class="legacy-reward-card" data-reward="${option.id}"><small>${option.type}</small><strong>${option.title}</strong><span>${option.detail}</span></button>`).join('');
  $('#legacyBuild').innerHTML=legacyRun.inherited.length?legacyRun.inherited.map(item=>`<li><span>${item.type}</span><strong>${item.title}</strong><small>Inherited from ${item.from}</small></li>`).join(''):'<li class="empty-build">No inherited skills yet.</li>';
  document.querySelectorAll('[data-reward]').forEach(button=>button.addEventListener('click',()=>{
    applyLegacyReward(legacyRun,defeated,button.dataset.reward);legacyRewardDialog.close();startMatch();
  }));
  legacyRewardDialog.showModal();
}

function continueRun(){
  resultDialog.close();
  if(gameMode==='career'){continueCareerTournament();}
  else if(gameMode==='challenge'){challengeRound+=1;startMatch();}
  else if(gameMode==='legacy')showLegacyRewards(cpu.data);
}
function restartCurrentMode(){if(gameMode==='multiplayer'){resetMultiplayerRoom();return;}if(gameMode==='career'){restartCareerActivity();return;}if(gameMode==='challenge')prepareChallenge();if(gameMode==='legacy')prepareLegacy();startMatch();}

function loop(now){
  if(!running)return;const dt=Math.min((now-last)/1000,.034);last=now;
  if(!paused){
    if(gameMode==='multiplayer'&&network.role==='guest'){if(startDelay>0)startDelay-=dt;applyGuestNetworkFrame(dt);updateFx(dt);}
    else{if(startDelay>0)startDelay-=dt;else timer=Math.max(0,timer-dt);player.update(dt,cpu);cpu.update(dt,player);resolveCombat();updateFx(dt);if(player.health<=0||cpu.health<=0||timer<=0)endMatch();}
    if(gameMode==='multiplayer'&&now>=network.nextSyncAt){network.nextSyncAt=now+NETWORK_TICK_MS;syncNetwork();}
  }
  draw();if(running)requestAnimationFrame(loop);
}
function updateFx(dt){ sparks.forEach(s=>{s.x+=s.vx*dt;s.y+=s.vy*dt;s.vy+=800*dt;s.life-=dt;});sparks=sparks.filter(s=>s.life>0);particles.forEach(p=>p.life-=dt);particles=particles.filter(p=>p.life>0);shake*=Math.pow(.02,dt); }

function draw(){ ctx.save(); if(shake>1)ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake); drawArena();drawHud();drawFighter(player);drawFighter(cpu);drawFx();if(paused){ctx.fillStyle='rgba(5,3,10,.7)';ctx.fillRect(0,0,1280,720);ctx.fillStyle='#fff';ctx.font='italic 900 82px Barlow Condensed';ctx.textAlign='center';ctx.fillText('PAUSED',640,370);} ctx.restore(); }
function gradient(top,bottom,split=.7){const g=ctx.createLinearGradient(0,0,0,720);g.addColorStop(0,top);g.addColorStop(split,bottom);g.addColorStop(1,bottom);ctx.fillStyle=g;ctx.fillRect(0,0,1280,720);}
function arenaFloor(color='#20202c',line='rgba(255,255,255,.08)'){ctx.fillStyle=color;ctx.fillRect(0,540,1280,180);ctx.strokeStyle=line;for(let y=552;y<720;y+=35){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1280,y);ctx.stroke();}for(let x=-200;x<1400;x+=95){ctx.beginPath();ctx.moveTo(640,540);ctx.lineTo(x,720);ctx.stroke();}}
function drawStars(count=70){ctx.fillStyle='#fff';for(let i=0;i<count;i++){const x=(i*193)%1280,y=115+(i*83)%330,r=i%9===0?2:1;ctx.globalAlpha=.35+(i%5)*.13;ctx.fillRect(x,y,r,r);}ctx.globalAlpha=1;}
function drawCity(baseY,color,lit=false){ctx.fillStyle=color;for(let i=0,x=-10;x<1290;i++,x+=48){const h=65+(i*47)%170,w=38+(i%3)*9;ctx.fillRect(x,baseY-h,w,h);if(lit){ctx.fillStyle=i%2?'#ffd66b':'#76caff';for(let wy=baseY-h+14;wy<baseY-12;wy+=22)for(let wx=x+8;wx<x+w-7;wx+=15)if((wx+wy+i)%3)ctx.fillRect(wx,wy,5,7);ctx.fillStyle=color;}}}
function drawArena(){
  ctx.save();
  const image=stageImages[selectedStage.id];
  if(image?.complete&&image.naturalWidth){
    ctx.drawImage(image,0,0,1280,720);
    const vignette=ctx.createRadialGradient(640,320,220,640,360,820);
    vignette.addColorStop(0,'rgba(4,6,12,0)');
    vignette.addColorStop(1,'rgba(4,6,12,.32)');
    ctx.fillStyle=vignette;ctx.fillRect(0,0,1280,720);
  }else{
    drawOctagon();
  }
  ctx.restore();
}
function drawOctagon(){
  gradient('#182238','#080910');ctx.fillStyle='#dcefff';ctx.globalAlpha=.28;for(const x of [180,430,850,1100]){ctx.beginPath();ctx.moveTo(x-35,0);ctx.lineTo(x+160,540);ctx.lineTo(x-160,540);ctx.fill();}ctx.globalAlpha=1;
  ctx.strokeStyle='rgba(190,220,230,.34)';ctx.lineWidth=2;for(let x=0;x<1280;x+=34){ctx.beginPath();ctx.moveTo(x,210);ctx.lineTo(x+180,540);ctx.stroke();ctx.beginPath();ctx.moveTo(x,540);ctx.lineTo(x+180,210);ctx.stroke();}
  ctx.strokeStyle='#737d86';ctx.lineWidth=10;ctx.strokeRect(4,206,1272,337);arenaFloor('#30343a','rgba(255,255,255,.1)');ctx.fillStyle='rgba(8,10,14,.28)';ctx.beginPath();ctx.ellipse(640,625,390,76,0,0,Math.PI*2);ctx.fill();
}
function drawToronto(){
  gradient('#55b7ea','#d8eff7',.64);ctx.fillStyle='#ffe77d';ctx.beginPath();ctx.arc(1040,150,58,0,Math.PI*2);ctx.fill();ctx.fillStyle='#5a8296';drawCity(500,'#58798a');
  ctx.fillStyle='#dce8ea';ctx.fillRect(633,185,14,315);ctx.beginPath();ctx.moveTo(618,185);ctx.lineTo(640,91);ctx.lineTo(662,185);ctx.fill();ctx.beginPath();ctx.ellipse(640,230,67,17,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#536d78';ctx.fillRect(627,230,27,270);ctx.fillStyle='#277b9f';ctx.fillRect(0,500,1280,40);for(let i=0;i<8;i++){ctx.strokeStyle='rgba(255,255,255,.45)';ctx.beginPath();ctx.moveTo(i*180,512+i%2*9);ctx.quadraticCurveTo(i*180+70,500,i*180+145,514);ctx.stroke();}arenaFloor('#304d55','rgba(255,255,255,.09)');
}
function drawJungle(){
  gradient('#153e2a','#06170f');ctx.fillStyle='#6ea64a';ctx.globalAlpha=.18;ctx.beginPath();ctx.arc(640,260,205,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
  for(let i=0;i<18;i++){const x=i*78-30,h=180+(i*53)%210;ctx.fillStyle=i%2?'#173d24':'#214f2b';ctx.fillRect(x,540-h,32,h);ctx.beginPath();ctx.arc(x+15,540-h,75+(i%3)*15,0,Math.PI*2);ctx.fill();}
  ctx.strokeStyle='#416b37';ctx.lineWidth=8;for(let x=90;x<1200;x+=210){ctx.beginPath();ctx.moveTo(x,0);ctx.bezierCurveTo(x-80,180,x+100,260,x+35,440);ctx.stroke();}ctx.fillStyle='#386333';for(let i=0;i<30;i++){ctx.beginPath();ctx.ellipse((i*149)%1280,440+(i%5)*22,38,15,(i%4)*.5,0,Math.PI*2);ctx.fill();}arenaFloor('#233529','rgba(151,211,117,.12)');
}
function drawFuji(){
  gradient('#78c7ed','#e7f5fb',.7);ctx.fillStyle='#fff3a0';ctx.beginPath();ctx.arc(1020,132,49,0,Math.PI*2);ctx.fill();ctx.fillStyle='#637e83';ctx.beginPath();ctx.moveTo(215,505);ctx.lineTo(635,112);ctx.lineTo(1055,505);ctx.closePath();ctx.fill();ctx.fillStyle='#f5f6f2';ctx.beginPath();ctx.moveTo(488,250);ctx.lineTo(635,112);ctx.lineTo(786,253);ctx.lineTo(710,231);ctx.lineTo(667,273);ctx.lineTo(621,226);ctx.lineTo(565,272);ctx.closePath();ctx.fill();
  ctx.fillStyle='#365e39';ctx.fillRect(0,488,1280,52);for(let i=0;i<18;i++){ctx.fillStyle=i%2?'#ef8faa':'#f5b6c8';ctx.beginPath();ctx.arc((i*173)%1280,430+(i%4)*22,22+(i%3)*5,0,Math.PI*2);ctx.fill();}arenaFloor('#41533e','rgba(255,255,255,.1)');
}
function drawMiami(){
  const g=ctx.createLinearGradient(0,0,0,540);g.addColorStop(0,'#4a267b');g.addColorStop(.45,'#ec5f70');g.addColorStop(.72,'#ffc16a');g.addColorStop(1,'#2b839a');ctx.fillStyle=g;ctx.fillRect(0,0,1280,540);ctx.fillStyle='#ffdf78';ctx.beginPath();ctx.arc(640,330,72,0,Math.PI*2);ctx.fill();ctx.fillStyle='#287f96';ctx.fillRect(0,390,1280,150);ctx.strokeStyle='rgba(255,255,255,.45)';for(let y=410;y<530;y+=31){ctx.beginPath();ctx.moveTo(0,y);for(let x=0;x<1280;x+=90)ctx.quadraticCurveTo(x+45,y-12,x+90,y);ctx.stroke();}
  for(const x of [120,1070]){ctx.save();ctx.translate(x,480);ctx.rotate(x<500?-.12:.12);ctx.fillStyle='#302b27';ctx.fillRect(-11,-250,22,250);ctx.fillStyle='#254c36';for(let a=0;a<7;a++){ctx.save();ctx.rotate(a*Math.PI/3.5);ctx.beginPath();ctx.ellipse(0,-250,17,86,0,0,Math.PI*2);ctx.fill();ctx.restore();}ctx.restore();}arenaFloor('#c6925a','rgba(255,255,255,.12)');
}
function drawDesert(){
  gradient('#e56d45','#f7ca70',.76);ctx.fillStyle='#f8e1a0';ctx.beginPath();ctx.arc(1025,145,62,0,Math.PI*2);ctx.fill();ctx.fillStyle='#c47f37';ctx.beginPath();ctx.moveTo(0,480);ctx.quadraticCurveTo(250,350,570,500);ctx.quadraticCurveTo(900,345,1280,470);ctx.lineTo(1280,540);ctx.lineTo(0,540);ctx.fill();ctx.fillStyle='#e3aa52';ctx.beginPath();ctx.moveTo(0,515);ctx.quadraticCurveTo(400,410,760,525);ctx.quadraticCurveTo(1010,420,1280,500);ctx.lineTo(1280,540);ctx.lineTo(0,540);ctx.fill();
  const cactus=(x,y,s=1)=>{ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.fillStyle='#38613a';ctx.fillRect(-13,-135,26,135);ctx.fillRect(-48,-92,38,19);ctx.fillRect(-48,-92,18,56);ctx.fillRect(10,-65,44,18);ctx.fillRect(36,-101,18,53);ctx.restore();};cactus(210,540,1);cactus(1050,540,.78);arenaFloor('#b97834','rgba(255,231,170,.14)');
}
function drawMoon(){
  gradient('#060916','#12192e');drawStars(95);ctx.fillStyle='#87b6ea';ctx.beginPath();ctx.arc(1010,142,75,0,Math.PI*2);ctx.fill();ctx.fillStyle='#d9edf8';ctx.beginPath();ctx.arc(986,126,55,0,Math.PI*2);ctx.fill();ctx.fillStyle='#777a82';ctx.beginPath();ctx.moveTo(0,500);for(let x=0;x<=1280;x+=90)ctx.lineTo(x,485+(x*37)%50);ctx.lineTo(1280,540);ctx.lineTo(0,540);ctx.fill();
  ctx.save();ctx.translate(770,465);ctx.rotate(-.17);ctx.fillStyle='#c8ccd2';ctx.beginPath();ctx.ellipse(0,0,150,48,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#505968';ctx.fillRect(-60,-42,98,31);ctx.fillStyle='#d35245';ctx.beginPath();ctx.moveTo(82,-20);ctx.lineTo(180,-70);ctx.lineTo(120,10);ctx.fill();ctx.fillStyle='#e68a3c';ctx.globalAlpha=.65;ctx.beginPath();ctx.moveTo(-135,0);ctx.lineTo(-238,-32);ctx.lineTo(-164,33);ctx.fill();ctx.restore();ctx.globalAlpha=1;arenaFloor('#666972','rgba(255,255,255,.09)');ctx.fillStyle='#4c4f57';for(const [x,y,r] of [[130,618,50],[1100,660,76],[370,690,38]]){ctx.beginPath();ctx.ellipse(x,y,r,r*.35,0,0,Math.PI*2);ctx.fill();}
}
function drawRing(){
  gradient('#191c31','#07080d');ctx.fillStyle='rgba(255,248,220,.22)';for(const x of [190,430,850,1090]){ctx.beginPath();ctx.moveTo(x-25,0);ctx.lineTo(x+160,540);ctx.lineTo(x-160,540);ctx.fill();}ctx.fillStyle='#090a10';for(let i=0;i<30;i++){const x=i*46,h=48+(i*31)%90;ctx.beginPath();ctx.arc(x,510-h,14,0,Math.PI*2);ctx.fill();ctx.fillRect(x-15,510-h+11,30,h);}ctx.fillStyle='#d7d8dc';ctx.fillRect(0,520,1280,200);ctx.strokeStyle='#df3c48';ctx.lineWidth=8;for(const y of [408,451,494]){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1280,y);ctx.stroke();}ctx.fillStyle='#1b1c24';for(const x of [25,1255])ctx.fillRect(x,370,16,204);arenaFloor('#cfd1d4','rgba(50,55,65,.11)');
}
function drawLA(){
  gradient('#0c1535','#25153c');drawStars(58);ctx.fillStyle='#f4e8c9';ctx.beginPath();ctx.arc(1020,133,57,0,Math.PI*2);ctx.fill();drawCity(520,'#101523',true);ctx.fillStyle='#0a0e16';for(const x of [100,1160]){ctx.save();ctx.translate(x,520);ctx.rotate(x<500?-.08:.08);ctx.fillRect(-8,-210,16,210);ctx.beginPath();for(let a=0;a<8;a++){ctx.moveTo(0,-210);ctx.lineTo(Math.cos(a*.78)*76,Math.sin(a*.78)*34-210);}ctx.lineWidth=12;ctx.strokeStyle='#0a0e16';ctx.stroke();ctx.restore();}arenaFloor('#161822','rgba(255,255,255,.08)');
}
function drawParis(){
  gradient('#111c48','#271a4d');drawStars(78);ctx.fillStyle='#dce7f2';ctx.beginPath();ctx.arc(1070,112,50,0,Math.PI*2);ctx.fill();drawCity(520,'#15162a',true);ctx.strokeStyle='#b6904e';ctx.lineWidth=13;ctx.beginPath();ctx.moveTo(520,520);ctx.lineTo(640,145);ctx.lineTo(760,520);ctx.moveTo(563,395);ctx.lineTo(717,395);ctx.moveTo(590,305);ctx.lineTo(690,305);ctx.moveTo(545,455);ctx.lineTo(735,455);ctx.stroke();ctx.lineWidth=7;ctx.beginPath();ctx.arc(640,520,90,Math.PI,0);ctx.stroke();const sparkle=performance.now()/260;ctx.fillStyle='#fff2a6';for(let i=0;i<24;i++){const x=545+(i*61)%190,y=205+(i*47)%270,r=(Math.sin(sparkle+i)+1)*2+1;ctx.fillRect(x-r/2,y-r/2,r,r);}arenaFloor('#242238','rgba(255,218,121,.1)');
}
function drawHud(){
  const health=(f,x,flip)=>{ctx.fillStyle='rgba(8,6,16,.82)';ctx.fillRect(x,34,460,70);ctx.strokeStyle='rgba(255,255,255,.22)';ctx.strokeRect(x,34,460,70);const w=442*f.health/f.maxHealth;ctx.fillStyle=f.health/f.maxHealth<.3?'#ff3d5a':'#f3ede3';ctx.fillRect(flip?x+9+442-w:x+9,43,w,22);const sw=442*f.stamina/f.maxStamina;ctx.fillStyle='rgba(255,255,255,.08)';ctx.fillRect(x+9,71,442,8);ctx.fillStyle=f.stamina/f.maxStamina<.2?'#ff7a64':'#58e6be';ctx.fillRect(flip?x+9+442-sw:x+9,71,sw,8);const legacyEnabled=f.data.allowLegacy!==false,mw=legacyEnabled?442*f.meter/100:0;ctx.fillStyle='rgba(255,255,255,.08)';ctx.fillRect(x+9,85,442,7);ctx.fillStyle='#ffd23f';ctx.fillRect(flip?x+9+442-mw:x+9,85,mw,7);ctx.fillStyle='#fff';ctx.textAlign=flip?'right':'left';ctx.font='italic 800 25px Barlow Condensed';ctx.fillText(f.data.name.toUpperCase(),flip?x+451:x+9,126);ctx.fillStyle='#ffd23f';ctx.font='700 12px Inter';const status=legacyEnabled?(f.meter>=100?'LEGACY READY':f.data.move.toUpperCase()):`LEVEL ${f.data.careerLevel||1}`;ctx.fillText(status,flip?x+451:x+9,145);};health(player,44,false);health(cpu,776,true);
  ctx.fillStyle='#0a0812';ctx.beginPath();ctx.arc(640,65,53,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#ffd23f';ctx.lineWidth=4;ctx.stroke();ctx.fillStyle='#fff';ctx.font='italic 900 48px Barlow Condensed';ctx.textAlign='center';ctx.fillText(Math.ceil(timer).toString().padStart(2,'0'),640,80);ctx.lineWidth=1;
}
// Version 1.33 character renderer preserved intact for instant rollback.
function drawFighterV133(f){
  const t=performance.now()/1000,motion=settings.fluidMotion,walking=f.state==='walk',stride=motion&&walking?Math.sin(f.stepPhase):0,bob=motion?(walking?Math.abs(Math.sin(f.stepPhase))*5:Math.sin(t*4+(f.isCpu?2:0))*2.5):0,attack=f.isAttacking(),special=f.state==='special',phase=f.stateTime,look=f.data.look,legacy=f.data.legacy,move=ATTACKS[f.state];
  const kickMove=['spinKick','roundhouse','counterKick'].includes(legacy),grappleMove=['groundSlam','bodySlam','suplex','takedown'].includes(legacy),punchMove=['punchCombo','strikeFlurry','straightPunch','overhand'].includes(legacy),chargeMove=legacy==='shoulderCharge',spinMove=legacy==='spinAttack';
  const throwProgress=f.throwType?Math.min(1,f.throwTime/.58):0,throwLift=f.throwType?Math.sin(throwProgress*Math.PI)*(f.throwType==='takedown'?55:105):0;
  const fallAmount=f.knockdown?clamp(Math.abs(f.ragAngle)/1.36,0,1):0;
  ctx.save();ctx.translate(f.x,f.y);ctx.fillStyle='rgba(0,0,0,.35)';ctx.beginPath();ctx.ellipse(f.knockdownDirection*fallAmount*72,15,62+fallAmount*70,15+fallAmount*3,0,0,Math.PI*2);ctx.fill();ctx.translate(0,bob-throwLift);if(f.throwType)ctx.rotate(f.facing*Math.sin(throwProgress*Math.PI)*(f.throwType==='suplex'?1.35:.65));if(f.ragAngle)ctx.rotate(f.ragAngle);ctx.scale(f.facing*look.width,look.height);if(f.flash>0){ctx.globalCompositeOperation='screen';}
  let lean=f.state==='hurt'?0:f.state==='block'?-0.08:special&&chargeMove?.32:special&&grappleMove?.2:f.state==='cross'?.08:f.state==='heavyKick'?.12:walking?clamp(f.vx/1500,-.1,.1):0;if(special&&spinMove)lean+=Math.sin(phase*18)*.08;ctx.rotate(lean);
  const pulse=move?Math.sin(Math.min(1,phase/move.duration)*Math.PI):0;
  const basicKick=f.state==='kick'||f.state==='heavyKick',legacyKick=special&&kickMove&&phase>.15,kick=basicKick||legacyKick;
  let frontX=48,frontY=-128,frontElbowX=59,frontElbowY=-145,backX=-28,backY=-132,backElbowX=-51,backElbowY=-143;
  let frontKneeX=19,frontKneeY=-40,frontFootX=-15,frontFootY=-3,backKneeX=-31,backKneeY=-39,backFootX=-34,backFootY=-3;
  if(walking){frontFootX=-15+stride*25;frontKneeX=19+stride*12;frontKneeY=-42+Math.abs(stride)*5;backFootX=-34-stride*25;backKneeX=-31-stride*12;backKneeY=-39+Math.abs(stride)*5;frontX=48-stride*17;backX=-28+stride*17;}
  if(f.state==='jab'){frontX=55+pulse*96;frontY=-151;frontElbowX=48+pulse*54;frontElbowY=-151;backX=-20;backY=-152;}
  if(f.state==='cross'){frontX=55+pulse*118;frontY=-142;frontElbowX=52+pulse*65;frontElbowY=-146;backX=-27;backY=-154;}
  if(f.state==='block'){frontX=55;frontY=-176;frontElbowX=28;frontElbowY=-142;backX=49;backY=-122;backElbowX=-14;backElbowY=-152;}
  if(f.state==='kick'){frontKneeX=30+pulse*48;frontKneeY=-38-pulse*30;frontFootX=-15+pulse*132;frontFootY=-3-pulse*76;}
  if(f.state==='heavyKick'){frontKneeX=28+pulse*58;frontKneeY=-42-pulse*62;frontFootX=-15+pulse*158;frontFootY=-3-pulse*132;}
  if(legacyKick){frontKneeX=45+pulse*42;frontKneeY=-66;frontFootX=20+pulse*120;frontFootY=-56-pulse*54;}
  if(special&&punchMove){frontX=65+pulse*(legacy==='straightPunch'?130:legacy==='overhand'?112:98);frontY=legacy==='overhand'?-164+pulse*55:-124;backX=legacy==='strikeFlurry'?48+pulse*82:-45;backY=legacy==='strikeFlurry'?-150:-104;}
  if(special&&grappleMove){const down=legacy==='groundSlam'||legacy==='bodySlam';frontX=66+pulse*78;frontY=down?-80+pulse*70:-112;backX=42+pulse*68;backY=down?-92+pulse*62:-145;}
  if(special&&chargeMove){frontX=14;frontY=-94;backX=-70;backY=-132;}
  if(special&&spinMove){frontX=72*pulse;frontY=-118;backX=-72*pulse;backY=-118;}
  ctx.lineCap='round';ctx.lineWidth=23;ctx.strokeStyle=f.data.skin;
  ctx.beginPath();ctx.moveTo(-22,-72);ctx.lineTo(backKneeX,backKneeY);ctx.lineTo(backFootX,backFootY);ctx.moveTo(22,-72);ctx.lineTo(frontKneeX,frontKneeY);ctx.lineTo(frontFootX,frontFootY);ctx.stroke();
  ctx.strokeStyle=f.data.accent;ctx.lineWidth=28;ctx.beginPath();ctx.moveTo(-19,-76);ctx.lineTo(backKneeX,backKneeY);ctx.moveTo(19,-76);ctx.lineTo(frontKneeX,frontKneeY);ctx.stroke();
  drawLegGear(f.data,frontFootX,frontFootY,backFootX,backFootY,kick);
  ctx.fillStyle=f.data.color;ctx.beginPath();ctx.roundRect(-45,-181,90,112,26);ctx.fill();ctx.fillStyle=f.data.accent;ctx.fillRect(-45,-112,90,22);
  ctx.strokeStyle=f.data.skin;ctx.lineWidth=22;ctx.beginPath();ctx.moveTo(-34,-157);ctx.lineTo(backElbowX,backElbowY);ctx.lineTo(backX,backY);ctx.moveTo(34,-157);ctx.lineTo(frontElbowX,frontElbowY);ctx.lineTo(frontX,frontY);ctx.stroke();
  drawBodyMark(f.data);
  ctx.fillStyle=f.data.skin;ctx.beginPath();ctx.arc(0,-218,39,0,Math.PI*2);ctx.fill();
  drawHair(f.data);drawBeard(f.data);drawHeadAccessory(f.data);
  drawArmGear(f.data, frontX, frontY);
  if(f.state==='block'){ctx.strokeStyle='#ffd23f';ctx.lineWidth=7;ctx.globalAlpha=.65;ctx.beginPath();ctx.arc(42,-147,70,-1.32,1.3);ctx.stroke();}
  if(special)drawLegacyEffect(f,legacy,phase,t,frontX,frontY);
  ctx.restore();
}

function rigPoint(x,y){return {x,y};}
function buildRigPose(f,t){
  const moving=f.state==='walk',motion=settings.fluidMotion,stride=motion&&moving?Math.sin(f.stepPhase):0,move=ATTACKS[f.state];
  const legacy=f.data.legacy,special=f.state==='special',kicker=['spinKick','roundhouse','counterKick'].includes(legacy),grappler=['groundSlam','bodySlam','suplex','takedown'].includes(legacy),puncher=['punchCombo','strikeFlurry','straightPunch','overhand'].includes(legacy);
  const specialProgress=special?clamp(f.stateTime/ATTACKS.special.duration,0,1):0;
  let pulse=move?Math.sin(Math.min(1,f.stateTime/move.duration)*Math.PI):0;
  if(special&&legacy==='punchCombo')pulse=Math.sin(Math.min(1,(specialProgress*3)%1)*Math.PI);
  if(special&&legacy==='strikeFlurry')pulse=Math.sin(Math.min(1,(specialProgress*6)%1)*Math.PI);
  if(special&&['straightPunch','overhand'].includes(legacy))pulse=Math.sin(clamp((specialProgress-.16)/.68,0,1)*Math.PI);
  if(special&&kicker)pulse=Math.sin(clamp((specialProgress-.12)/.78,0,1)*Math.PI);
  const boxer=/Boxer|Brawler|Striker|Counter/.test(f.data.style),wrestler=/Wrest|Grappl|Heavy|Powerhouse/.test(f.data.style);
  const pose={
    hip:rigPoint(0,-76),chest:rigPoint(0,-154),neck:rigPoint(0,-188),head:rigPoint(0,-218),
    backShoulder:rigPoint(-31,-157),backElbow:rigPoint(-51,-133),backHand:rigPoint(-31,-112),
    frontShoulder:rigPoint(31,-157),frontElbow:rigPoint(53,-139),frontHand:rigPoint(48,-119),
    backHip:rigPoint(-19,-75),backKnee:rigPoint(-30,-40),backFoot:rigPoint(-35,-4),
    frontHip:rigPoint(19,-75),frontKnee:rigPoint(22,-39),frontFoot:rigPoint(-7,-4)
  };
  if(boxer){pose.backHand=rigPoint(-11,-143);pose.frontHand=rigPoint(47,-145);pose.frontElbow=rigPoint(48,-123);}
  if(wrestler){pose.backHand=rigPoint(-48,-106);pose.frontHand=rigPoint(54,-110);pose.backElbow=rigPoint(-58,-137);pose.frontElbow=rigPoint(61,-138);}
  if(moving){
    pose.frontFoot.x+=stride*28;pose.frontKnee.x+=stride*15;pose.frontKnee.y+=Math.abs(stride)*5;
    pose.backFoot.x-=stride*28;pose.backKnee.x-=stride*15;pose.backKnee.y+=Math.abs(stride)*5;
    pose.frontHand.x-=stride*13;pose.backHand.x+=stride*13;pose.hip.x=stride*2;
  }
  if(f.state==='jab'){pose.frontElbow=rigPoint(50+pulse*50,-151);pose.frontHand=rigPoint(55+pulse*102,-151);pose.backHand=rigPoint(-7,-151);pose.chest.x=pulse*5;}
  if(f.state==='cross'){pose.frontElbow=rigPoint(53+pulse*65,-145);pose.frontHand=rigPoint(57+pulse*123,-143);pose.backHand=rigPoint(-14,-153);pose.backShoulder.x=-35+pulse*9;pose.chest.x=pulse*9;}
  if(f.state==='block'){pose.frontElbow=rigPoint(28,-147);pose.frontHand=rigPoint(49,-178);pose.backElbow=rigPoint(-9,-151);pose.backHand=rigPoint(34,-130);pose.frontKnee.y=-43;pose.backKnee.y=-43;}
  if(f.state==='shove'){pose.frontElbow=rigPoint(58+pulse*28,-130);pose.frontHand=rigPoint(72+pulse*72,-122);pose.backElbow=rigPoint(36+pulse*24,-149);pose.backHand=rigPoint(61+pulse*69,-140);pose.chest.x=pulse*10;pose.hip.x=-pulse*7;}
  if(f.state==='kick'){pose.frontKnee=rigPoint(29+pulse*50,-40-pulse*31);pose.frontFoot=rigPoint(-7+pulse*137,-4-pulse*78);pose.hip.x=-pulse*7;pose.backKnee.x-=pulse*7;}
  if(f.state==='heavyKick'){pose.frontKnee=rigPoint(29+pulse*60,-43-pulse*64);pose.frontFoot=rigPoint(-7+pulse*164,-4-pulse*134);pose.hip.x=-pulse*11;pose.chest.x=-pulse*8;pose.backKnee.x-=pulse*9;}
  if(special&&kicker){const chamber=clamp(specialProgress/.24,0,1),extension=clamp((specialProgress-.24)/.42,0,1);pose.frontKnee=rigPoint(36+chamber*45,-46-chamber*55);pose.frontFoot=rigPoint(3+extension*151,-18-extension*101);pose.chest.x=-pulse*13;pose.backHand.x-=pulse*32;}
  if(special&&puncher){const alternating=legacy==='strikeFlurry'||legacy==='punchCombo';pose.frontElbow=rigPoint(52+pulse*63,-142);pose.frontHand=rigPoint(63+pulse*(legacy==='straightPunch'?138:legacy==='overhand'?119:106),legacy==='overhand'?-165+pulse*58:-126);if(alternating){const backPulse=Math.sin(Math.min(1,((specialProgress+(legacy==='strikeFlurry'?.1:.18))*(legacy==='strikeFlurry'?6:3))%1)*Math.PI);pose.backElbow=rigPoint(20+backPulse*54,-144);pose.backHand=rigPoint(36+backPulse*104,-151);}pose.chest.x=pulse*11;}
  if(special&&grappler){
    const p=clamp(f.stateTime/ATTACKS.special.duration,0,1),grab=clamp(p/.28,0,1),lift=clamp((p-.28)/.34,0,1),slam=clamp((p-.62)/.38,0,1),down=legacy==='groundSlam'||legacy==='bodySlam'||legacy==='takedown';
    pose.frontElbow=rigPoint(52+grab*48-lift*18,-132-lift*45+slam*82);pose.frontHand=rigPoint(66+grab*84-lift*34,-112-lift*96+slam*(down?188:146));
    pose.backElbow=rigPoint(22+grab*42-lift*15,-146-lift*36+slam*73);pose.backHand=rigPoint(40+grab*73-lift*29,-141-lift*82+slam*(down?176:132));
    pose.chest.x=grab*15-lift*16+slam*27;pose.chest.y-=lift*18;pose.hip.y-=lift*9;pose.frontKnee.y+=slam*18;pose.backKnee.y+=slam*16;
  }
  if(special&&legacy==='shoulderCharge'){pose.frontHand=rigPoint(16,-94);pose.frontElbow=rigPoint(42,-123);pose.backHand=rigPoint(-72,-130);pose.backElbow=rigPoint(-58,-153);pose.chest.x=pulse*18;}
  if(special&&legacy==='spinAttack'){pose.frontHand=rigPoint(77*pulse,-116);pose.backHand=rigPoint(-77*pulse,-116);pose.frontElbow=rigPoint(45*pulse,-145);pose.backElbow=rigPoint(-45*pulse,-145);}
  const breathing=motion&&!moving&&!f.isAttacking()&&f.state!=='hurt'?Math.sin(t*3.3+(f.isCpu?1.7:0))*1.5:0;
  pose.chest.y+=breathing;pose.neck.y+=breathing;pose.head.y+=breathing;
  return {pose,pulse,special,legacy,moving,stride};
}

function rigSegment(a,b,startWidth,endWidth,fill,outline='rgba(12,8,18,.58)'){
  const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1,nx=-dy/length,ny=dx/length;
  const shape=(extra,color)=>{ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(a.x+nx*(startWidth/2+extra),a.y+ny*(startWidth/2+extra));ctx.lineTo(b.x+nx*(endWidth/2+extra),b.y+ny*(endWidth/2+extra));ctx.quadraticCurveTo(b.x+dx/length*(2+extra),b.y+dy/length*(2+extra),b.x-nx*(endWidth/2+extra),b.y-ny*(endWidth/2+extra));ctx.lineTo(a.x-nx*(startWidth/2+extra),a.y-ny*(startWidth/2+extra));ctx.quadraticCurveTo(a.x-dx/length*(2+extra),a.y-dy/length*(2+extra),a.x+nx*(startWidth/2+extra),a.y+ny*(startWidth/2+extra));ctx.closePath();ctx.fill();};
  shape(2.6,outline);shape(0,fill);
}

function rigJoint(point,radius,fill){ctx.fillStyle='rgba(12,8,18,.58)';ctx.beginPath();ctx.arc(point.x,point.y,radius+2.4,0,Math.PI*2);ctx.fill();ctx.fillStyle=fill;ctx.beginPath();ctx.arc(point.x,point.y,radius,0,Math.PI*2);ctx.fill();}
function drawRigChain(a,b,c,widthA,widthB,widthC,fill){rigSegment(a,b,widthA,widthB,fill);rigJoint(b,widthB*.53,fill);rigSegment(b,c,widthB,widthC,fill);}

function drawRigFoot(data,point,front=false){
  const large=data.look.gear==='bigshoes',length=large?34:25,height=large?13:10;
  ctx.fillStyle='rgba(12,8,18,.62)';ctx.beginPath();ctx.ellipse(point.x+7,point.y+2,length+3,height+3,-.06,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=large?data.accent:data.color;ctx.beginPath();ctx.ellipse(point.x+7,point.y,length,height,-.06,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,.22)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(point.x-5,point.y-3);ctx.lineTo(point.x+18+(front?3:0),point.y-1);ctx.stroke();
}

function drawRigHand(data,point){
  const gloves=['gloves','fightgloves'].includes(data.look.gear),radius=data.look.gear==='gloves'?17:gloves?14:11;
  ctx.fillStyle='rgba(12,8,18,.62)';ctx.beginPath();ctx.arc(point.x,point.y,radius+2.5,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=gloves?(data.look.gear==='gloves'?data.accent:'#202029'):data.skin;ctx.beginPath();ctx.arc(point.x,point.y,radius,0,Math.PI*2);ctx.fill();
  if(gloves){ctx.strokeStyle=data.color;ctx.lineWidth=3;ctx.beginPath();ctx.arc(point.x,point.y,radius-2,.2,2.9);ctx.stroke();}
}

function drawRigTorso(data,pose){
  const shoulder=43,waist=31,top=-181,bottom=-75;
  ctx.fillStyle='rgba(12,8,18,.64)';ctx.beginPath();ctx.moveTo(-shoulder-3,top+17);ctx.quadraticCurveTo(-shoulder-5,-145,-waist-3,bottom);ctx.quadraticCurveTo(0,bottom+11,waist+3,bottom);ctx.quadraticCurveTo(shoulder+5,-145,shoulder+3,top+17);ctx.quadraticCurveTo(18,top-4,0,top);ctx.quadraticCurveTo(-18,top-4,-shoulder-3,top+17);ctx.fill();
  ctx.fillStyle=data.color;ctx.beginPath();ctx.moveTo(-shoulder,top+17);ctx.quadraticCurveTo(-shoulder-2,-145,-waist,bottom);ctx.quadraticCurveTo(0,bottom+8,waist,bottom);ctx.quadraticCurveTo(shoulder+2,-145,shoulder,top+17);ctx.quadraticCurveTo(18,top,0,top+4);ctx.quadraticCurveTo(-18,top,-shoulder,top+17);ctx.closePath();ctx.fill();
  const shade=ctx.createLinearGradient(-45,-135,45,-135);shade.addColorStop(0,'rgba(0,0,0,.3)');shade.addColorStop(.45,'rgba(255,255,255,.08)');shade.addColorStop(1,'rgba(0,0,0,.2)');ctx.fillStyle=shade;ctx.fill();
  ctx.fillStyle=data.accent;ctx.beginPath();ctx.moveTo(-32,-102);ctx.quadraticCurveTo(0,-94,32,-102);ctx.lineTo(30,-78);ctx.quadraticCurveTo(0,-70,-30,-78);ctx.closePath();ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,.13)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-27,-163);ctx.quadraticCurveTo(-11,-151,0,-154);ctx.quadraticCurveTo(12,-151,27,-163);ctx.moveTo(0,-145);ctx.lineTo(0,-109);ctx.stroke();
}

function drawFighter(f,t=performance.now()/1000){
  const {pose,pulse,special,legacy,moving,stride}=buildRigPose(f,t),look=f.data.look;
  const throwProgress=f.throwType?Math.min(1,f.throwTime/.92):0,throwArc=f.throwType?Math.sin(throwProgress*Math.PI):0,throwLift=f.throwType?throwArc*(f.throwType==='takedown'?70:130):0,fallAmount=f.knockdown?clamp(Math.abs(f.ragAngle)/1.36,0,1):0;
  const bob=settings.fluidMotion?(moving?Math.abs(stride)*3.5:0):0;
  ctx.save();ctx.translate(f.x,f.y);ctx.fillStyle='rgba(0,0,0,.38)';ctx.beginPath();ctx.ellipse(f.knockdownDirection*fallAmount*72,15,64+fallAmount*72,15+fallAmount*3,0,0,Math.PI*2);ctx.fill();
  ctx.translate(f.throwType?f.facing*Math.sin(throwProgress*Math.PI)*42:0,bob-throwLift);if(f.throwType)ctx.rotate(f.facing*throwArc*(f.throwType==='suplex'?2.25:f.throwType==='bodySlam'?1.45:.92));if(f.ragAngle)ctx.rotate(f.ragAngle);ctx.scale(f.facing*look.width,look.height);
  if(f.flash>0){ctx.globalCompositeOperation='screen';}
  let lean=f.state==='block'?-.07:special&&legacy==='shoulderCharge'?.3:special&&['groundSlam','bodySlam','suplex','takedown'].includes(legacy)?.18:f.state==='cross'?.07:f.state==='heavyKick'?.11:moving?clamp(f.vx/1700,-.08,.08):0;if(special&&legacy==='spinAttack')lean+=Math.sin(f.stateTime*18)*.16;if(special&&['spinKick','roundhouse','counterKick'].includes(legacy))lean-=Math.sin(clamp(f.stateTime/ATTACKS.special.duration,0,1)*Math.PI)*.18;ctx.rotate(lean);
  const skin=f.data.skin,backSkin=skin;
  drawRigChain(pose.backHip,pose.backKnee,pose.backFoot,28,24,16,backSkin);drawRigFoot(f.data,pose.backFoot);
  drawRigChain(pose.backShoulder,pose.backElbow,pose.backHand,25,20,14,backSkin);drawRigHand(f.data,pose.backHand);
  rigSegment(rigPoint(-7,-187),rigPoint(-5,-174),24,29,skin);drawRigTorso(f.data,pose);
  drawRigChain(pose.frontHip,pose.frontKnee,pose.frontFoot,31,25,17,skin);drawRigFoot(f.data,pose.frontFoot,true);
  drawRigChain(pose.frontShoulder,pose.frontElbow,pose.frontHand,27,21,14,skin);drawRigHand(f.data,pose.frontHand);
  if(['wristbands','bands','armbands'].includes(f.data.look.gear)){ctx.strokeStyle=f.data.accent;ctx.lineWidth=7;ctx.beginPath();ctx.arc(pose.frontHand.x,pose.frontHand.y,14,0,Math.PI*2);ctx.stroke();}
  if(f.data.look.gear==='longsocks'||f.data.look.gear==='anklewraps')drawLegGear(f.data,pose.frontFoot.x,pose.frontFoot.y,pose.backFoot.x,pose.backFoot.y,f.state==='kick'||f.state==='heavyKick');
  const headGradient=ctx.createLinearGradient(-30,-252,28,-181);headGradient.addColorStop(0,'rgba(255,255,255,.16)');headGradient.addColorStop(.28,skin);headGradient.addColorStop(1,skin);ctx.fillStyle='rgba(12,8,18,.62)';ctx.beginPath();ctx.ellipse(0,-218,40,43,0,0,Math.PI*2);ctx.fill();ctx.fillStyle=headGradient;ctx.beginPath();ctx.moveTo(-35,-233);ctx.quadraticCurveTo(-42,-211,-29,-191);ctx.quadraticCurveTo(-16,-176,0,-174);ctx.quadraticCurveTo(17,-176,29,-191);ctx.quadraticCurveTo(42,-211,35,-233);ctx.quadraticCurveTo(20,-256,0,-258);ctx.quadraticCurveTo(-21,-256,-35,-233);ctx.closePath();ctx.fill();
  ctx.fillStyle=skin;ctx.beginPath();ctx.ellipse(-38,-215,7,12,0,0,Math.PI*2);ctx.ellipse(38,-215,7,12,0,0,Math.PI*2);ctx.fill();
  drawHair(f.data);drawBeard(f.data);drawHeadAccessory(f.data);
  if(f.state==='block'){ctx.strokeStyle='#ffd23f';ctx.lineWidth=7;ctx.globalAlpha=.62;ctx.beginPath();ctx.arc(42,-147,70,-1.32,1.3);ctx.stroke();}
  if(special)drawLegacyEffect(f,legacy,f.stateTime,t,pose.frontHand.x,pose.frontHand.y);
  ctx.restore();
}

function drawLegacyEffect(f,type,phase,t,frontX,frontY){
  ctx.save();ctx.strokeStyle=f.data.accent;ctx.fillStyle=f.data.accent;ctx.globalAlpha=.65;
  if(['spinKick','roundhouse','counterKick','spinAttack'].includes(type)){for(let i=0;i<3;i++){ctx.lineWidth=7-i*2;ctx.beginPath();ctx.arc(0,-98,88+i*24,t*5+i,t*5+i+2.15);ctx.stroke();}}
  else if(['punchCombo','strikeFlurry'].includes(type)){for(let i=0;i<5;i++){const y=-170+i*24,x=68+(i%2)*42;ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(x-58,y);ctx.lineTo(x+70,y+(i%2?12:-12));ctx.stroke();ctx.beginPath();ctx.arc(x+76,y+(i%2?12:-12),9,0,Math.PI*2);ctx.fill();}}
  else if(['straightPunch','overhand'].includes(type)){ctx.lineWidth=9;for(let i=0;i<4;i++){ctx.beginPath();ctx.moveTo(frontX-95-i*18,frontY+i*7);ctx.lineTo(frontX+18,frontY);ctx.stroke();ctx.globalAlpha*=.78;}}
  else if(type==='shoulderCharge'){ctx.lineWidth=7;for(let i=0;i<5;i++){ctx.beginPath();ctx.moveTo(-145-i*23,-185+i*31);ctx.lineTo(-30-i*10,-185+i*31);ctx.stroke();}}
  else if(['groundSlam','bodySlam','suplex','takedown'].includes(type)){const p=clamp(phase/ATTACKS.special.duration,0,1),impact=clamp((p-.62)/.38,0,1),wide=70+impact*235;ctx.globalAlpha=.28+impact*.65;ctx.lineWidth=10;ctx.beginPath();ctx.ellipse(25,3,wide,16+impact*28,0,Math.PI,Math.PI*2);ctx.stroke();for(let i=0;i<9;i++){const a=Math.PI+(i/8)*Math.PI;ctx.beginPath();ctx.moveTo(Math.cos(a)*54,0);ctx.lineTo(Math.cos(a)*wide,Math.sin(a)*(48+impact*34));ctx.stroke();}}
  ctx.restore();
}

function drawHair(data){
  const style=data.look.hairStyle;if(style==='bald')return;
  if(style==='shortcurl'){
    ctx.globalAlpha=.9;ctx.beginPath();ctx.arc(0,-235,36,Math.PI,Math.PI*2);ctx.lineTo(34,-229);ctx.quadraticCurveTo(12,-237,0,-230);ctx.quadraticCurveTo(-14,-238,-34,-229);ctx.closePath();finishHair(data,18);ctx.globalAlpha=1;return;
  }
  if(style==='mane'){
    ctx.beginPath();ctx.moveTo(-40,-231);ctx.bezierCurveTo(-52,-251,-34,-275,-12,-278);ctx.bezierCurveTo(11,-284,38,-273,44,-247);ctx.lineTo(39,-214);ctx.bezierCurveTo(31,-228,23,-235,13,-232);ctx.bezierCurveTo(0,-226,-9,-234,-20,-230);ctx.bezierCurveTo(-29,-226,-35,-219,-40,-207);ctx.closePath();finishHair(data,16);return;
  }
  if(style==='twists'){
    const twists=[[-29,-247,9],[-17,-260,10],[-3,-264,10],[12,-262,10],[27,-251,9],[-23,-238,9],[-7,-244,10],[10,-243,10],[25,-236,8]];
    for(const [x,y,r] of twists){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);finishHair(data,3);}return;
  }
  if(style==='manbun'){
    ctx.beginPath();ctx.moveTo(-38,-232);ctx.bezierCurveTo(-34,-255,-17,-268,5,-267);ctx.bezierCurveTo(27,-266,39,-250,37,-230);ctx.bezierCurveTo(23,-237,12,-236,1,-229);ctx.bezierCurveTo(-13,-237,-25,-235,-38,-232);ctx.closePath();finishHair(data,9);
    ctx.beginPath();ctx.bezierCurveTo(-47,-265,-62,-262,-60,-246);ctx.bezierCurveTo(-58,-230,-39,-229,-31,-243);ctx.bezierCurveTo(-24,-256,-34,-267,-47,-265);ctx.closePath();finishHair(data,5);ctx.strokeStyle=data.accent;ctx.lineWidth=4;ctx.beginPath();ctx.arc(-45,-248,13,-1.2,1.5);ctx.stroke();return;
  }
  if(style==='highfade'){
    ctx.globalAlpha=.55;ctx.beginPath();ctx.arc(0,-233,37,Math.PI,Math.PI*2);finishHair(data,10);ctx.globalAlpha=1;
    const curls=[[-28,-252,12],[-13,-263,13],[4,-264,14],[20,-257,13],[31,-245,11],[-1,-247,13]];for(const [x,y,r] of curls){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);finishHair(data,3);}return;
  }
  if(style==='spikes'){
    ctx.beginPath();ctx.moveTo(-39,-232);ctx.quadraticCurveTo(-39,-250,-28,-254);ctx.quadraticCurveTo(-29,-271,-17,-258);ctx.quadraticCurveTo(-12,-281,-3,-261);ctx.quadraticCurveTo(8,-284,11,-260);ctx.quadraticCurveTo(26,-277,24,-254);ctx.quadraticCurveTo(41,-265,35,-238);ctx.quadraticCurveTo(18,-235,6,-229);ctx.quadraticCurveTo(-14,-237,-39,-232);ctx.closePath();finishHair(data,11);return;
  }
  if(style==='flat'){
    ctx.beginPath();ctx.moveTo(-37,-232);ctx.lineTo(-33,-254);ctx.quadraticCurveTo(-4,-260,34,-254);ctx.lineTo(38,-234);ctx.quadraticCurveTo(24,-239,12,-233);ctx.quadraticCurveTo(-8,-240,-20,-232);ctx.quadraticCurveTo(-28,-237,-37,-232);ctx.closePath();finishHair(data,8);return;
  }
  if(style==='sideswept'){
    ctx.beginPath();ctx.moveTo(-38,-232);ctx.bezierCurveTo(-30,-262,-5,-272,19,-264);ctx.bezierCurveTo(34,-259,44,-249,42,-239);ctx.bezierCurveTo(27,-247,12,-250,-1,-242);ctx.bezierCurveTo(-14,-234,-25,-229,-38,-232);ctx.closePath();finishHair(data,10);return;
  }
  if(style==='shaggyblond'){
    ctx.beginPath();ctx.moveTo(-44,-229);ctx.bezierCurveTo(-46,-256,-23,-276,2,-271);ctx.bezierCurveTo(20,-281,45,-267,49,-244);ctx.bezierCurveTo(50,-228,43,-215,34,-205);ctx.lineTo(26,-231);ctx.lineTo(16,-207);ctx.lineTo(7,-235);ctx.lineTo(-5,-211);ctx.lineTo(-14,-238);ctx.lineTo(-28,-214);ctx.lineTo(-34,-240);ctx.closePath();finishHair(data,20);return;
  }
  if(style==='sweptback'){
    ctx.beginPath();ctx.moveTo(-39,-232);ctx.bezierCurveTo(-33,-258,-13,-272,12,-268);ctx.bezierCurveTo(27,-266,42,-259,48,-247);ctx.bezierCurveTo(28,-252,16,-249,3,-241);ctx.bezierCurveTo(-11,-233,-25,-229,-39,-232);ctx.closePath();finishHair(data,12);return;
  }
  if(style==='closecrop'){
    ctx.beginPath();ctx.arc(0,-232,37,Math.PI,Math.PI*2);ctx.lineTo(34,-229);ctx.bezierCurveTo(19,-236,9,-233,0,-229);ctx.bezierCurveTo(-11,-235,-23,-232,-34,-228);ctx.closePath();finishHair(data,18);return;
  }
  if(style==='blondcrew'){
    ctx.beginPath();ctx.moveTo(-34,-231);ctx.lineTo(-29,-251);ctx.quadraticCurveTo(0,-260,30,-250);ctx.lineTo(35,-231);ctx.quadraticCurveTo(20,-236,8,-231);ctx.quadraticCurveTo(-8,-237,-20,-231);ctx.closePath();finishHair(data,14);return;
  }
  ctx.beginPath();ctx.moveTo(-36,-231);ctx.bezierCurveTo(-31,-254,-16,-262,3,-262);ctx.bezierCurveTo(23,-261,36,-250,37,-230);ctx.bezierCurveTo(19,-236,7,-231,-1,-228);ctx.bezierCurveTo(-13,-235,-25,-230,-36,-231);ctx.closePath();finishHair(data,11);
}

function drawHeadAccessory(data){
  const accessory=data.look.accessory;if(!accessory)return;
  if(accessory==='mask'){
    ctx.save();
    const mask=ctx.createLinearGradient(-38,-231,38,-188);mask.addColorStop(0,'#35d9ed');mask.addColorStop(.5,'#6c35d9');mask.addColorStop(1,'#ef4d9b');ctx.fillStyle=mask;
    ctx.beginPath();ctx.moveTo(-38,-229);ctx.quadraticCurveTo(-24,-239,-7,-232);ctx.quadraticCurveTo(0,-226,8,-232);ctx.quadraticCurveTo(25,-239,38,-228);ctx.lineTo(31,-201);ctx.quadraticCurveTo(18,-187,0,-193);ctx.quadraticCurveTo(-19,-187,-32,-202);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#f8e84d';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-35,-225);ctx.quadraticCurveTo(-15,-210,0,-218);ctx.quadraticCurveTo(17,-210,35,-225);ctx.moveTo(-28,-203);ctx.quadraticCurveTo(0,-215,29,-203);ctx.stroke();
    ctx.fillStyle=data.skin;ctx.beginPath();ctx.ellipse(-16,-216,10,5,-.15,0,Math.PI*2);ctx.ellipse(16,-216,10,5,.15,0,Math.PI*2);ctx.fill();ctx.restore();return;
  }
  if(accessory==='bandana'){
    ctx.save();ctx.fillStyle='#6f1830';ctx.beginPath();ctx.moveTo(-39,-239);ctx.quadraticCurveTo(0,-247,39,-239);ctx.lineTo(37,-225);ctx.quadraticCurveTo(0,-232,-38,-225);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#e9d8ac';ctx.lineWidth=2;for(let x=-28;x<=28;x+=14){ctx.beginPath();ctx.moveTo(x,-237);ctx.quadraticCurveTo(x+7,-245,x+8,-234);ctx.quadraticCurveTo(x+3,-230,x,-237);ctx.stroke();}
    ctx.fillStyle='#6f1830';ctx.beginPath();ctx.moveTo(-37,-231);ctx.lineTo(-62,-218);ctx.lineTo(-46,-245);ctx.closePath();ctx.fill();ctx.strokeStyle='#e9d8ac';ctx.lineWidth=2;ctx.stroke();ctx.restore();
  }
}

function drawBeard(data){
  const beard=data.look.beard;if(beard==='none')return;
  if(beard==='full'){
    ctx.beginPath();ctx.moveTo(-35,-224);ctx.bezierCurveTo(-42,-210,-40,-190,-30,-179);ctx.bezierCurveTo(-22,-170,-12,-169,-5,-163);ctx.lineTo(0,-167);ctx.lineTo(6,-162);ctx.bezierCurveTo(15,-168,25,-170,32,-180);ctx.bezierCurveTo(41,-193,42,-211,35,-224);ctx.bezierCurveTo(29,-213,24,-208,20,-205);ctx.bezierCurveTo(14,-196,8,-191,0,-191);ctx.bezierCurveTo(-8,-191,-14,-196,-20,-205);ctx.bezierCurveTo(-25,-210,-30,-215,-35,-224);ctx.closePath();
    ctx.fillStyle=data.hair;ctx.fill();
    ctx.save();ctx.clip();drawBeardStrands(data,22);ctx.restore();drawMoustache(data,-203,1.05);return;
  }
  if(beard==='goatee'){
    drawMoustache(data,-202,.78);ctx.beginPath();ctx.moveTo(-12,-195);ctx.bezierCurveTo(-13,-184,-7,-174,0,-169);ctx.bezierCurveTo(8,-175,14,-185,12,-195);ctx.bezierCurveTo(6,-190,-6,-190,-12,-195);ctx.closePath();ctx.fillStyle=data.hair;ctx.fill();ctx.save();ctx.clip();drawBeardStrands(data,7);ctx.restore();return;
  }
  if(beard==='moustache'){drawMoustache(data,-202,.92);return;}
  ctx.save();ctx.globalAlpha=beard==='stubble'?.32:.72;ctx.beginPath();ctx.moveTo(-33,-211);ctx.bezierCurveTo(-32,-190,-18,-176,0,-171);ctx.bezierCurveTo(19,-176,33,-190,34,-211);ctx.bezierCurveTo(25,-202,18,-194,10,-190);ctx.bezierCurveTo(3,-186,-5,-186,-12,-190);ctx.bezierCurveTo(-21,-195,-27,-204,-33,-211);ctx.closePath();ctx.fillStyle=data.hair;ctx.fill();ctx.clip();drawBeardStrands(data,beard==='stubble'?28:16);ctx.restore();if(beard==='trim')drawMoustache(data,-202,.66);
}

function hairGradient(data,top=-270,bottom=-225){const g=ctx.createLinearGradient(-30,top,30,bottom);g.addColorStop(0,data.hair);g.addColorStop(.55,data.hair);g.addColorStop(1,'rgba(15,8,7,.92)');return g;}

function finishHair(data,density){ctx.fillStyle=hairGradient(data);ctx.fill();ctx.save();ctx.clip();ctx.strokeStyle='rgba(255,255,255,.14)';ctx.lineWidth=1.2;for(let i=0;i<density;i++){const x=-34+i*(68/Math.max(1,density-1));ctx.beginPath();ctx.moveTo(x,-268+(i%3)*5);ctx.quadraticCurveTo(x+8,-250,x+(i%2?4:-3),-226);ctx.stroke();}ctx.restore();}

function drawMoustache(data,y,scale=1){ctx.save();ctx.translate(0,y);ctx.scale(scale,scale);ctx.fillStyle=data.hair;ctx.beginPath();ctx.moveTo(0,1);ctx.bezierCurveTo(-8,-8,-24,-8,-27,-1);ctx.bezierCurveTo(-20,1,-17,8,-3,5);ctx.quadraticCurveTo(-1,4,0,1);ctx.bezierCurveTo(8,-8,24,-8,27,-1);ctx.bezierCurveTo(20,1,17,8,3,5);ctx.quadraticCurveTo(1,4,0,1);ctx.fill();ctx.strokeStyle='rgba(255,255,255,.12)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(-23,-2);ctx.quadraticCurveTo(-13,1,-4,3);ctx.moveTo(23,-2);ctx.quadraticCurveTo(13,1,4,3);ctx.stroke();ctx.restore();}

function drawBeardStrands(data,count){ctx.strokeStyle='rgba(255,255,255,.12)';ctx.lineWidth=1.1;for(let i=0;i<count;i++){const x=-32+i*(64/Math.max(1,count-1));const y=-214+Math.abs(x)*.6+(i%3)*2;ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(x+(i%2?3:-3),y+14,x+(i%3-1)*2,y+25);ctx.stroke();}}

function drawArmGear(data, fistX, fistY){
  const gear=data.look.gear;
  if(['gloves','fightgloves'].includes(gear)){ctx.fillStyle=gear==='gloves'?data.accent:'#202029';ctx.beginPath();ctx.arc(fistX,fistY,gear==='gloves'?18:14,0,Math.PI*2);ctx.fill();ctx.strokeStyle=data.color;ctx.lineWidth=4;ctx.stroke();}
  if(['wristbands','bands','armbands'].includes(gear)){ctx.strokeStyle=data.accent;ctx.lineWidth=9;ctx.beginPath();ctx.moveTo(-52,-103);ctx.lineTo(-43,-92);ctx.moveTo(fistX-12,fistY+8);ctx.lineTo(fistX-3,fistY+14);ctx.stroke();}
  if(gear==='headband'){ctx.strokeStyle=data.accent;ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(-38,-229);ctx.lineTo(39,-229);ctx.stroke();ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-34,-228);ctx.lineTo(-58,-214);ctx.stroke();}
}

function drawLegGear(data,footX,footY,backFootX,backFootY,kick){
  const gear=data.look.gear;ctx.strokeStyle=data.color;
  if(gear==='longsocks'){ctx.lineWidth=16;ctx.beginPath();ctx.moveTo(backFootX+3,backFootY-30);ctx.lineTo(backFootX,backFootY);ctx.moveTo(footX-(kick?23:5),footY+(kick?12:-30));ctx.lineTo(footX,footY);ctx.stroke();}
  if(gear==='anklewraps'){ctx.strokeStyle=data.accent;ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(backFootX-5,backFootY-9);ctx.lineTo(backFootX+4,backFootY);ctx.moveTo(footX-10,footY+3);ctx.lineTo(footX+2,footY);ctx.stroke();}
  if(gear==='bigshoes'){ctx.fillStyle=data.accent;ctx.beginPath();ctx.ellipse(backFootX,backFootY+4,30,13,-.05,0,Math.PI*2);ctx.ellipse(footX,footY,30,13,kick?-.2:.05,0,Math.PI*2);ctx.fill();}
}

function drawBodyMark(data){
  const mark=data.look.mark;if(mark==='none')return;ctx.save();ctx.strokeStyle=data.accent;ctx.globalAlpha=.72;ctx.lineWidth=4;
  if(mark==='shoulder'){ctx.beginPath();ctx.arc(-39,-154,17,.5,4.8);ctx.stroke();ctx.beginPath();ctx.moveTo(-50,-150);ctx.lineTo(-32,-128);ctx.stroke();}
  if(mark==='chest'){ctx.beginPath();ctx.moveTo(-19,-159);ctx.lineTo(0,-139);ctx.lineTo(20,-161);ctx.moveTo(-12,-143);ctx.lineTo(12,-143);ctx.stroke();}
  if(mark==='dragon'){ctx.beginPath();ctx.moveTo(-21,-156);ctx.quadraticCurveTo(15,-176,21,-141);ctx.quadraticCurveTo(7,-122,-13,-140);ctx.stroke();}
  if(mark==='patchwork'){ctx.setLineDash([7,6]);ctx.strokeRect(-31,-169,61,69);ctx.setLineDash([]);}
  if(mark==='back'){ctx.beginPath();ctx.moveTo(-27,-163);ctx.lineTo(27,-134);ctx.moveTo(27,-163);ctx.lineTo(-27,-134);ctx.stroke();}
  ctx.restore();
}
function drawFx(){ sparks.forEach(s=>{ctx.globalAlpha=clamp(s.life*3,0,1);ctx.fillStyle=s.color;ctx.fillRect(s.x,s.y,s.size,s.size);});ctx.globalAlpha=1;particles.forEach(p=>{ctx.globalAlpha=p.life/p.max*.38;ctx.fillStyle=p.color;ctx.fillRect(0,0,1280,720);});ctx.globalAlpha=1; }

const attackActions=new Set(['shove','jab','cross','kick','heavyKick','special']);
window.addEventListener('keydown',e=>{
  const k=e.key.toLowerCase();
  if(!menuRevealed){if(k==='enter'||k===' '){e.preventDefault();startAudioIntro();}return;}
  if(rebindingAction){
    e.preventDefault();if(k==='escape'){rebindingAction=null;renderSettings();return;}
    const previous=settings.keybinds[rebindingAction],conflict=actionFromKey(k);
    if(conflict&&conflict!==rebindingAction)settings.keybinds[conflict]=previous;
    settings.keybinds[rebindingAction]=k;rebindingAction=null;saveSettings();renderSettings();return;
  }
  keys.add(k);const action=actionFromKey(k);if(attackActions.has(action)&&!e.repeat)performLocalAttack(action);if(gameMode==='multiplayer'&&action&&!attackActions.has(action))syncNetwork(true);if(k==='escape')togglePause();
});
window.addEventListener('keyup',e=>{const action=actionFromKey(e.key.toLowerCase());keys.delete(e.key.toLowerCase());if(gameMode==='multiplayer'&&action)syncNetwork(true);});
document.querySelectorAll('[data-action]').forEach(btn=>{const action=btn.dataset.action;const down=e=>{e.preventDefault();touchActions.add(action);if(attackActions.has(action))performLocalAttack(action);else if(gameMode==='multiplayer')syncNetwork(true);};const up=e=>{e.preventDefault();touchActions.delete(action);if(gameMode==='multiplayer')syncNetwork(true);};btn.addEventListener('pointerdown',down);btn.addEventListener('pointerup',up);btn.addEventListener('pointerleave',up);btn.addEventListener('pointercancel',up);});
function togglePause(){if(!running||gameMode==='multiplayer')return;paused=!paused;$('#pauseBtn').textContent=paused?'▶':'Ⅱ';$('#pauseMenu').classList.toggle('hidden',!paused);last=performance.now();}
function leaveCurrentMatch(){
  leaveMatchDialog.close();running=false;paused=false;keys.clear();touchActions.clear();$('#pauseMenu').classList.add('hidden');$('#pauseBtn').textContent='Ⅱ';setLegacyControlEnabled(true);
  if(resultDialog.open)resultDialog.close();if(legacyRewardDialog.open)legacyRewardDialog.close();
  if(gameMode==='career'){careerRun=null;renderCareerHub();showOnly(careerHubScreen);return;}
  challengeQueue=[];legacyRun=null;showOnly(modeScreen);
}
function backFromFighterSelect(){if(gameMode==='multiplayer'){showOnly(multiplayerScreen);routeRoomState(network.room);scheduleRoomPoll(150);}else showOnly(modeScreen);}
enterGameBtn.addEventListener('click',startAudioIntro);titleMusic.addEventListener('ended',()=>{clearTimeout(playlistWatchdogTimer);playlistWatchdogTimer=0;playRandomTitleTrack();});titleMusic.addEventListener('playing',handleTitlePlaying);titleMusic.addEventListener('error',queuePlaylistRecovery);
$('#playBtn').addEventListener('click',()=>showOnly(modeScreen));$('#settingsBtn').addEventListener('click',openSettings);$('#settingsTopBtn').addEventListener('click',openSettings);$('#modeBackBtn').addEventListener('click',()=>showOnly(startScreen));
$('#homeBtn').addEventListener('click',()=>{if(gameMode==='multiplayer'&&network.code){leaveMultiplayerRoom(startScreen);return;}running=false;paused=false;careerRun=null;keys.clear();touchActions.clear();$('#pauseMenu').classList.add('hidden');setLegacyControlEnabled(true);if(resultDialog.open)resultDialog.close();if(legacyRewardDialog.open)legacyRewardDialog.close();showOnly(startScreen);});
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>chooseMode(button.dataset.mode)));
$('#careerSlotsBackBtn').addEventListener('click',()=>showOnly(modeScreen));$('#careerCreatorBackBtn').addEventListener('click',()=>{renderCareerSlots();showOnly(careerSlotsScreen);});$('#careerHubBackBtn').addEventListener('click',()=>{renderCareerSlots();showOnly(careerSlotsScreen);});$('#createCareerFighterBtn').addEventListener('click',createCareerFighter);
for(const id of ['careerNameInput','careerHairSelect','careerBeardSelect','careerBodySelect','careerHeightInput','careerWeightInput','careerSkinColor','careerHairColor','careerOutfitColor','careerAccentColor'])$(`#${id}`).addEventListener('input',renderCareerCreatorPreview);
document.querySelectorAll('[data-career-activity]').forEach(button=>button.addEventListener('click',()=>startCareerActivity(button.dataset.careerActivity)));
$('#selectBackBtn').addEventListener('click',backFromFighterSelect);$('#fightBtn').addEventListener('click',()=>gameMode==='multiplayer'?lockMultiplayerFighter():showStageSelect());$('#stageFightBtn').addEventListener('click',()=>gameMode==='multiplayer'?startMultiplayerFromStage():startMatch());$('#stageBackBtn').addEventListener('click',()=>{if(gameMode==='multiplayer'){network.stageSelectDismissed=true;showOnly(multiplayerScreen);routeRoomState(network.room);scheduleRoomPoll(150);}else showOnly(selectScreen);});$('#rematchBtn').addEventListener('click',restartCurrentMode);$('#nextRoundBtn').addEventListener('click',continueRun);$('#rosterBtn').addEventListener('click',()=>{if(gameMode==='multiplayer'){leaveMultiplayerRoom(modeScreen);return;}resultDialog.close();running=false;if(gameMode==='career'){careerRun=null;setLegacyControlEnabled(true);renderCareerHub();showOnly(careerHubScreen);return;}challengeQueue=[];legacyRun=null;showOnly(selectScreen);});$('#pauseBtn').addEventListener('click',togglePause);$('#resumeGameBtn').addEventListener('click',togglePause);$('#leaveGameBtn').addEventListener('click',()=>leaveMatchDialog.showModal());$('#cancelLeaveMatchBtn').addEventListener('click',()=>leaveMatchDialog.close());$('#confirmLeaveMatchBtn').addEventListener('click',leaveCurrentMatch);leaveMatchDialog.addEventListener('cancel',event=>{event.preventDefault();leaveMatchDialog.close();});
$('#createRoomBtn').addEventListener('click',createMultiplayerRoom);$('#joinRoomBtn').addEventListener('click',joinMultiplayerRoom);$('#joinCodeInput').addEventListener('input',e=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);});$('#joinCodeInput').addEventListener('keydown',e=>{if(e.key==='Enter')joinMultiplayerRoom();});
$('#copyRoomCodeBtn').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(network.code||'');networkMessage('Room code copied.');}catch{networkMessage(`Room code: ${network.code}`,false);}});
$('#multiplayerPrimaryBtn').addEventListener('click',()=>{const room=network.room;if(!room)return;const localReady=room.role==='host'?room.hostReady:room.guestReady;if(!localReady)openMultiplayerSelect();else if(room.role==='host'&&room.hostReady&&room.guestReady){network.stageSelectDismissed=false;showStageSelect();}});
$('#leaveRoomBtn').addEventListener('click',()=>leaveMultiplayerRoom(modeScreen));$('#multiplayerBackBtn').addEventListener('click',()=>network.code?leaveMultiplayerRoom(modeScreen):showOnly(modeScreen));
legacyRewardDialog.addEventListener('cancel',event=>event.preventDefault());
$('#soundBtn').addEventListener('click',e=>{audioEnabled=!audioEnabled;e.currentTarget.textContent=audioEnabled?'SOUND ON':'SOUND OFF';if(audioEnabled&&introStarted){applyTitleVolume();titleMusic.play().catch(()=>{});}else titleMusic.pause();});
$('#howBtn').addEventListener('click',()=>$('#controlsDialog').showModal());$('#closeHow').addEventListener('click',()=>$('#controlsDialog').close());
$('#closeSettings').addEventListener('click',closeSettings);$('#settingsDialog').addEventListener('cancel',e=>{e.preventDefault();closeSettings();});
for(const id of ['masterVolume','musicVolume','effectsVolume','screenShake'])$(`#${id}`).addEventListener('input',e=>{settings[id]=Number(e.target.value);$(`#${id}Value`).value=`${settings[id]}%`;saveSettings();applyTitleVolume();});
$('#fluidMotion').addEventListener('change',e=>{settings.fluidMotion=e.target.checked;saveSettings();});
$('#resetKeysBtn').addEventListener('click',()=>{settings.keybinds={...DEFAULT_KEYBINDS};rebindingAction=null;saveSettings();renderSettings();});
$('#updatesBtn').addEventListener('click',()=>$('#updatesDialog').showModal());$('#closeUpdates').addEventListener('click',()=>$('#updatesDialog').close());

renderRoster();renderDetail();renderStages();renderSettings();renderControlHelp();
