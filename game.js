import { ROSTER, clamp, attackDamage, selectCpu } from './game-data.js';

const $ = s => document.querySelector(s);
const rosterEl = $('#roster');
const detailEl = $('#fighterDetail');
const selectScreen = $('#selectScreen');
const gameScreen = $('#gameScreen');
const canvas = $('#game');
const ctx = canvas.getContext('2d');
const roundBanner = $('#roundBanner');
const resultDialog = $('#resultDialog');
const keys = new Set();

let selected = ROSTER[0];
let player, cpu, particles = [], sparks = [], shake = 0;
let running = false, paused = false, last = 0, timer = 60, startDelay = 0;
let audioEnabled = true, audioContext;

function renderRoster() {
  rosterEl.innerHTML = ROSTER.map(f => `
    <button class="fighter-card ${f.id === selected.id ? 'selected' : ''} look-${f.look.hairStyle} beard-${f.look.beard} accessory-${f.look.accessory || 'none'}" data-id="${f.id}" style="--color:${f.color};--accent:${f.accent};--skin:${f.skin};--hair:${f.hair};--body-scale:${f.look.width};--height-scale:${f.look.height}">
      <span class="portrait"><i class="portrait-hair"></i><i class="portrait-beard"></i><i class="portrait-accessory"></i></span>
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

class Fighter {
  constructor(data, x, facing, isCpu=false) {
    this.data=data; this.x=x; this.y=560; this.facing=facing; this.isCpu=isCpu;
    this.health=100; this.meter=20; this.maxStamina=65+data.stamina*5; this.stamina=this.maxStamina; this.staminaDelay=0;
    this.vx=0; this.state='idle'; this.stateTime=0; this.cooldown=0; this.hitDone=false; this.flash=0; this.blocking=false; this.aiWait=0;
  }
  attack(kind) {
    if (this.cooldown>0 || this.state==='hurt' || startDelay>0) return;
    if (kind==='special' && this.meter<100) return;
    const staminaCost=kind==='light'?8:kind==='heavy'?18:28;
    if(this.stamina<staminaCost){if(!this.isCpu)beep(52,.08,'square');return;}
    this.stamina-=staminaCost;this.staminaDelay=kind==='light'?.32:kind==='heavy'?.62:.95;
    this.state=kind; this.stateTime=0; this.hitDone=false;
    this.cooldown = kind==='light' ? .28 : kind==='heavy' ? .54 : 1.0;
    if(kind==='special') { this.meter=0; flashScreen(); beep(95,.18,'sawtooth'); }
    else beep(kind==='heavy'?115:190,.05,'square');
  }
  update(dt, opponent) {
    this.stateTime += dt; this.cooldown=Math.max(0,this.cooldown-dt); this.flash=Math.max(0,this.flash-dt);this.staminaDelay=Math.max(0,this.staminaDelay-dt);
    if (this.isCpu) this.think(dt, opponent);
    const attacking=['light','heavy','special'].includes(this.state);
    if (!attacking && this.state!=='hurt') {
      this.blocking = (this.isCpu ? this.blocking : keys.has('h')) && this.stamina>0;
      this.state = this.blocking ? 'block' : Math.abs(this.vx)>.1 ? 'walk' : 'idle';
    }
    if (!this.isCpu && !attacking && this.state!=='hurt' && !this.blocking && startDelay<=0) {
      const axis=(keys.has('d')?1:0)-(keys.has('a')?1:0);
      this.vx=axis*(170+this.data.speed*10);
    }
    if (this.blocking){this.vx*=.45;this.stamina=Math.max(0,this.stamina-dt*7);this.staminaDelay=.22;}
    else if(!attacking&&this.state!=='hurt'&&this.staminaDelay<=0)this.stamina=Math.min(this.maxStamina,this.stamina+(8+this.data.stamina*1.55)*dt);
    this.x=clamp(this.x+this.vx*dt,90,1190); this.vx*=Math.pow(.005,dt);
    const distance=Math.abs(this.x-opponent.x);
    if(distance<125) { const push=(125-distance)*.5; this.x += this.x<opponent.x?-push:push; }
    this.facing=this.x<opponent.x?1:-1;
    const impact = this.state==='light'?.09:this.state==='heavy'?.21:this.state==='special'?.36:-1;
    if(impact>=0 && this.stateTime>=impact && !this.hitDone) {
      this.hitDone=true; const reach=76+this.data.reach*7+(this.state==='special'?80:0);
      if(distance<reach) hit(this,opponent,this.state);
    }
    const duration=this.state==='light'?.24:this.state==='heavy'?.46:this.state==='special'?.88:this.state==='hurt'?.25:99;
    if(this.stateTime>duration && ['light','heavy','special','hurt'].includes(this.state)) { this.state='idle'; this.stateTime=0; }
  }
  think(dt, opponent) {
    if(startDelay>0 || this.state==='hurt') return;
    this.aiWait-=dt; if(this.aiWait>0) return;
    const dx=opponent.x-this.x, dist=Math.abs(dx), threat=['light','heavy','special'].includes(opponent.state);
    this.blocking = this.stamina>12 && threat && dist<175 && Math.random()<.64;
    if(this.blocking) { this.vx=0; this.aiWait=.12; return; }
    if(this.stamina<10){this.vx=-Math.sign(dx)*125;this.aiWait=.2;return;}
    if(dist>155) this.vx=Math.sign(dx)*(140+this.data.speed*9);
    else if(dist<100 && Math.random()<.28) this.vx=-Math.sign(dx)*150;
    else { this.vx=0; const roll=Math.random(); if(this.meter>=100&&roll<.28)this.attack('special'); else if(roll<.58)this.attack('light'); else if(roll<.82)this.attack('heavy'); }
    this.aiWait=.12+Math.random()*.22;
  }
}

function hit(attacker, target, kind) {
  const damage=attackDamage(attacker.data,kind,target.blocking);
  target.health=clamp(target.health-damage,0,100); attacker.meter=clamp(attacker.meter+(kind==='special'?0:damage*2.1),0,100); target.meter=clamp(target.meter+damage*1.15,0,100);
  if(target.blocking){target.stamina=Math.max(0,target.stamina-damage*1.6);target.staminaDelay=.7;if(target.stamina===0){target.blocking=false;target.state='hurt';target.stateTime=0;}}
  target.flash=.13; target.vx=attacker.facing*(kind==='special'?440:kind==='heavy'?270:150);
  if(!target.blocking){target.state='hurt';target.stateTime=0;} shake=kind==='special'?15:kind==='heavy'?8:3;
  burst((attacker.x+target.x)/2,target.y-118,kind==='special'?attacker.data.accent:'#fff',kind==='special'?34:14);
  beep(target.blocking?85:kind==='special'?48:68,kind==='special'?.2:.07,'sawtooth');
}

function burst(x,y,color,count){ for(let i=0;i<count;i++) sparks.push({x,y,vx:(Math.random()-.5)*520,vy:(Math.random()-.6)*430,life:.25+Math.random()*.35,color,size:2+Math.random()*7}); }
function flashScreen(){ particles.push({life:.18,max:.18,color:player?.data.accent||'#fff'}); }
function beep(freq,duration,type='sine'){
  if(!audioEnabled)return; try { audioContext ||= new (window.AudioContext||window.webkitAudioContext)(); const o=audioContext.createOscillator(),g=audioContext.createGain(); o.type=type;o.frequency.setValueAtTime(freq,audioContext.currentTime);o.frequency.exponentialRampToValueAtTime(Math.max(30,freq*.55),audioContext.currentTime+duration);g.gain.setValueAtTime(.06,audioContext.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+duration);o.connect(g).connect(audioContext.destination);o.start();o.stop(audioContext.currentTime+duration); } catch {} 
}

function startMatch() {
  const rival=selectCpu(selected.id); player=new Fighter(selected,310,1); cpu=new Fighter(rival,970,-1,true);
  particles=[];sparks=[];timer=60;startDelay=2.3;running=true;paused=false;last=performance.now();
  selectScreen.classList.add('hidden'); gameScreen.classList.remove('hidden'); resultDialog.close?.();
  announce('ROUND 1',850); setTimeout(()=>announce('FIGHT!',650),950); requestAnimationFrame(loop);
}
function announce(text,time){ roundBanner.textContent=text;roundBanner.classList.add('show');setTimeout(()=>roundBanner.classList.remove('show'),time); }
function endMatch(){ running=false; const won=player.health>cpu.health; $('#resultTitle').textContent=won?'VICTORY':'DEFEAT'; $('#resultText').textContent=won?`${player.data.name} defeated ${cpu.data.name} and strengthened the legacy.`:`${cpu.data.name} takes the match. Study the rival and return stronger.`; setTimeout(()=>resultDialog.showModal(),500); }

function loop(now){ if(!running)return; const dt=Math.min((now-last)/1000,.034);last=now;if(!paused){ if(startDelay>0)startDelay-=dt;else timer=Math.max(0,timer-dt);player.update(dt,cpu);cpu.update(dt,player);updateFx(dt);if(player.health<=0||cpu.health<=0||timer<=0)endMatch(); } draw();if(running)requestAnimationFrame(loop); }
function updateFx(dt){ sparks.forEach(s=>{s.x+=s.vx*dt;s.y+=s.vy*dt;s.vy+=800*dt;s.life-=dt;});sparks=sparks.filter(s=>s.life>0);particles.forEach(p=>p.life-=dt);particles=particles.filter(p=>p.life>0);shake*=Math.pow(.02,dt); }

function draw(){ ctx.save(); if(shake>1)ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake); drawArena();drawHud();drawFighter(player);drawFighter(cpu);drawFx();if(paused){ctx.fillStyle='rgba(5,3,10,.7)';ctx.fillRect(0,0,1280,720);ctx.fillStyle='#fff';ctx.font='italic 900 82px Barlow Condensed';ctx.textAlign='center';ctx.fillText('PAUSED',640,370);} ctx.restore(); }
function drawArena(){
  const grd=ctx.createLinearGradient(0,0,0,720);grd.addColorStop(0,'#27144a');grd.addColorStop(.55,'#10142f');grd.addColorStop(1,'#090a12');ctx.fillStyle=grd;ctx.fillRect(0,0,1280,720);
  ctx.fillStyle='#ff3d5a';ctx.beginPath();ctx.arc(640,350,150,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ffd23f';ctx.beginPath();ctx.arc(640,350,111,0,Math.PI*2);ctx.fill();ctx.fillStyle='#140f25';ctx.beginPath();ctx.arc(640,350,82,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='rgba(5,3,12,.72)';for(let i=0;i<32;i++){const x=i*43+(i%3)*9,h=40+(i*37)%105;ctx.beginPath();ctx.arc(x,540-h,15,0,Math.PI*2);ctx.fill();ctx.fillRect(x-17,540-h+11,34,h);}
  ctx.fillStyle='#20202c';ctx.fillRect(0,540,1280,180);for(let y=552;y<720;y+=35){ctx.strokeStyle='rgba(255,255,255,.07)';ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1280,y);ctx.stroke();}for(let x=-200;x<1400;x+=95){ctx.beginPath();ctx.moveTo(640,540);ctx.lineTo(x,720);ctx.stroke();}
}
function drawHud(){
  const health=(f,x,flip)=>{ctx.fillStyle='rgba(8,6,16,.82)';ctx.fillRect(x,34,460,70);ctx.strokeStyle='rgba(255,255,255,.22)';ctx.strokeRect(x,34,460,70);const w=442*f.health/100;ctx.fillStyle=f.health<30?'#ff3d5a':'#f3ede3';ctx.fillRect(flip?x+9+442-w:x+9,43,w,22);const sw=442*f.stamina/f.maxStamina;ctx.fillStyle='rgba(255,255,255,.08)';ctx.fillRect(x+9,71,442,8);ctx.fillStyle=f.stamina/f.maxStamina<.2?'#ff7a64':'#58e6be';ctx.fillRect(flip?x+9+442-sw:x+9,71,sw,8);const mw=442*f.meter/100;ctx.fillStyle='rgba(255,255,255,.08)';ctx.fillRect(x+9,85,442,7);ctx.fillStyle='#ffd23f';ctx.fillRect(flip?x+9+442-mw:x+9,85,mw,7);ctx.fillStyle='#fff';ctx.textAlign=flip?'right':'left';ctx.font='italic 800 25px Barlow Condensed';ctx.fillText(f.data.name.toUpperCase(),flip?x+451:x+9,126);ctx.fillStyle='#ffd23f';ctx.font='700 12px Inter';ctx.fillText(f.meter>=100?'LEGACY READY':f.data.move.toUpperCase(),flip?x+451:x+9,145);};health(player,44,false);health(cpu,776,true);
  ctx.fillStyle='#0a0812';ctx.beginPath();ctx.arc(640,65,53,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#ffd23f';ctx.lineWidth=4;ctx.stroke();ctx.fillStyle='#fff';ctx.font='italic 900 48px Barlow Condensed';ctx.textAlign='center';ctx.fillText(Math.ceil(timer).toString().padStart(2,'0'),640,80);ctx.lineWidth=1;
}
function drawFighter(f){
  const t=performance.now()/1000,bob=Math.sin(t*4+(f.isCpu?2:0))*3, attack=['light','heavy','special'].includes(f.state), phase=f.stateTime, look=f.data.look;
  ctx.save();ctx.translate(f.x,f.y+bob);ctx.scale(f.facing*look.width,look.height);if(f.flash>0){ctx.globalCompositeOperation='screen';ctx.filter='brightness(2.5)';}
  ctx.fillStyle='rgba(0,0,0,.35)';ctx.beginPath();ctx.ellipse(0,15,62,15,0,0,Math.PI*2);ctx.fill();
  let lean=f.state==='hurt'?-0.22:f.state==='block'?-0.12:attack?.1:0;ctx.rotate(lean);
  const kick=f.state==='special'&&phase>.2; const armReach=f.state==='light'?Math.sin(Math.min(1,phase/.09)*Math.PI)*58:f.state==='heavy'?Math.sin(Math.min(1,phase/.21)*Math.PI)*82:f.state==='special'?Math.sin(Math.min(1,phase/.36)*Math.PI)*105:0;
  ctx.lineCap='round';ctx.lineWidth=23;ctx.strokeStyle=f.data.skin;
  ctx.beginPath();ctx.moveTo(-22,-72);ctx.lineTo(-34,-3);ctx.moveTo(22,-72);ctx.lineTo(kick?100:-15,kick?-43:-3);ctx.stroke();
  ctx.strokeStyle=f.data.accent;ctx.lineWidth=28;ctx.beginPath();ctx.moveTo(-19,-76);ctx.lineTo(-31,-41);ctx.moveTo(19,-76);ctx.lineTo(kick?67:-7,kick?-31:-40);ctx.stroke();
  drawLegGear(f.data, kick);
  ctx.fillStyle=f.data.color;ctx.beginPath();ctx.roundRect(-45,-181,90,112,26);ctx.fill();ctx.fillStyle=f.data.accent;ctx.fillRect(-45,-112,90,22);
  ctx.strokeStyle=f.data.skin;ctx.lineWidth=22;ctx.beginPath();ctx.moveTo(-34,-157);ctx.lineTo(-58,-105);ctx.lineTo(-38,-82);ctx.moveTo(34,-157);ctx.lineTo(55+armReach,-123+(f.state==='heavy'?20:0));ctx.stroke();
  drawBodyMark(f.data);
  ctx.fillStyle=f.data.skin;ctx.beginPath();ctx.arc(0,-218,39,0,Math.PI*2);ctx.fill();
  drawHair(f.data);drawBeard(f.data);drawHeadAccessory(f.data);
  drawArmGear(f.data, 55+armReach, -123+(f.state==='heavy'?20:0));
  if(f.state==='block'){ctx.strokeStyle='#ffd23f';ctx.lineWidth=7;ctx.globalAlpha=.65;ctx.beginPath();ctx.arc(50,-132,66,-1.2,1.2);ctx.stroke();}
  if(f.state==='special'){ctx.strokeStyle=f.data.accent;ctx.globalAlpha=.6;for(let i=0;i<3;i++){ctx.lineWidth=6-i;ctx.beginPath();ctx.arc(0,-120,80+i*24,t*3+i,t*3+i+2.3);ctx.stroke();}}
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
    const g=hairGradient(data,-225,-162);ctx.fillStyle=g;ctx.fill();
    ctx.save();ctx.clip();drawBeardStrands(data,22);ctx.restore();drawMoustache(data,-203,1.05);return;
  }
  if(beard==='goatee'){
    drawMoustache(data,-202,.78);ctx.beginPath();ctx.moveTo(-12,-195);ctx.bezierCurveTo(-13,-184,-7,-174,0,-169);ctx.bezierCurveTo(8,-175,14,-185,12,-195);ctx.bezierCurveTo(6,-190,-6,-190,-12,-195);ctx.closePath();ctx.fillStyle=hairGradient(data,-198,-168);ctx.fill();ctx.save();ctx.clip();drawBeardStrands(data,7);ctx.restore();return;
  }
  if(beard==='moustache'){drawMoustache(data,-202,.92);return;}
  ctx.save();ctx.globalAlpha=beard==='stubble'?.32:.72;ctx.beginPath();ctx.moveTo(-33,-211);ctx.bezierCurveTo(-32,-190,-18,-176,0,-171);ctx.bezierCurveTo(19,-176,33,-190,34,-211);ctx.bezierCurveTo(25,-202,18,-194,10,-190);ctx.bezierCurveTo(3,-186,-5,-186,-12,-190);ctx.bezierCurveTo(-21,-195,-27,-204,-33,-211);ctx.closePath();ctx.fillStyle=hairGradient(data,-214,-169);ctx.fill();ctx.clip();drawBeardStrands(data,beard==='stubble'?28:16);ctx.restore();if(beard==='trim')drawMoustache(data,-202,.66);
}

function hairGradient(data,top=-270,bottom=-225){const g=ctx.createLinearGradient(-30,top,30,bottom);g.addColorStop(0,data.hair);g.addColorStop(.55,data.hair);g.addColorStop(1,'rgba(15,8,7,.92)');return g;}

function finishHair(data,density){ctx.fillStyle=hairGradient(data);ctx.fill();ctx.save();ctx.clip();ctx.strokeStyle='rgba(255,255,255,.14)';ctx.lineWidth=1.2;for(let i=0;i<density;i++){const x=-34+i*(68/Math.max(1,density-1));ctx.beginPath();ctx.moveTo(x,-268+(i%3)*5);ctx.quadraticCurveTo(x+8,-250,x+(i%2?4:-3),-226);ctx.stroke();}ctx.restore();}

function drawMoustache(data,y,scale=1){ctx.save();ctx.translate(0,y);ctx.scale(scale,scale);ctx.fillStyle=hairGradient(data,y-8,y+8);ctx.beginPath();ctx.moveTo(0,1);ctx.bezierCurveTo(-8,-8,-24,-8,-27,-1);ctx.bezierCurveTo(-20,1,-17,8,-3,5);ctx.quadraticCurveTo(-1,4,0,1);ctx.bezierCurveTo(8,-8,24,-8,27,-1);ctx.bezierCurveTo(20,1,17,8,3,5);ctx.quadraticCurveTo(1,4,0,1);ctx.fill();ctx.strokeStyle='rgba(255,255,255,.12)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(-23,-2);ctx.quadraticCurveTo(-13,1,-4,3);ctx.moveTo(23,-2);ctx.quadraticCurveTo(13,1,4,3);ctx.stroke();ctx.restore();}

function drawBeardStrands(data,count){ctx.strokeStyle='rgba(255,255,255,.12)';ctx.lineWidth=1.1;for(let i=0;i<count;i++){const x=-32+i*(64/Math.max(1,count-1));const y=-214+Math.abs(x)*.6+(i%3)*2;ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(x+(i%2?3:-3),y+14,x+(i%3-1)*2,y+25);ctx.stroke();}}

function drawArmGear(data, fistX, fistY){
  const gear=data.look.gear;
  if(['gloves','fightgloves'].includes(gear)){ctx.fillStyle=gear==='gloves'?data.accent:'#202029';ctx.beginPath();ctx.arc(fistX,fistY,gear==='gloves'?18:14,0,Math.PI*2);ctx.fill();ctx.strokeStyle=data.color;ctx.lineWidth=4;ctx.stroke();}
  if(['wristbands','bands','armbands'].includes(gear)){ctx.strokeStyle=data.accent;ctx.lineWidth=9;ctx.beginPath();ctx.moveTo(-52,-103);ctx.lineTo(-43,-92);ctx.moveTo(fistX-12,fistY+8);ctx.lineTo(fistX-3,fistY+14);ctx.stroke();}
  if(gear==='headband'){ctx.strokeStyle=data.accent;ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(-38,-229);ctx.lineTo(39,-229);ctx.stroke();ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-34,-228);ctx.lineTo(-58,-214);ctx.stroke();}
}

function drawLegGear(data,kick){
  const gear=data.look.gear;ctx.strokeStyle=data.color;
  if(gear==='longsocks'){ctx.lineWidth=16;ctx.beginPath();ctx.moveTo(-31,-35);ctx.lineTo(-34,-5);ctx.moveTo(kick?72:-10,kick?-34:-34);ctx.lineTo(kick?95:-15,kick?-43:-4);ctx.stroke();}
  if(gear==='anklewraps'){ctx.strokeStyle=data.accent;ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(-35,-11);ctx.lineTo(-30,-2);ctx.moveTo(kick?91:-14,kick?-41:-9);ctx.lineTo(kick?101:-16,kick?-43:-1);ctx.stroke();}
  if(gear==='bigshoes'){ctx.fillStyle=data.accent;ctx.beginPath();ctx.ellipse(-36,1,30,13,-.05,0,Math.PI*2);ctx.ellipse(kick?101:-13,kick?-43:1,30,13,kick?-.2:.05,0,Math.PI*2);ctx.fill();}
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

window.addEventListener('keydown',e=>{const k=e.key.toLowerCase();keys.add(k);if(k==='f')player?.attack('light');if(k==='g')player?.attack('heavy');if(k==='r')player?.attack('special');if(k==='escape')togglePause();});
window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
document.querySelectorAll('[data-key]').forEach(btn=>{const k=btn.dataset.key;const down=e=>{e.preventDefault();keys.add(k);if(k==='f')player?.attack('light');if(k==='g')player?.attack('heavy');if(k==='r')player?.attack('special');};const up=e=>{e.preventDefault();keys.delete(k);};btn.addEventListener('pointerdown',down);btn.addEventListener('pointerup',up);btn.addEventListener('pointercancel',up);});
function togglePause(){if(!running)return;paused=!paused;$('#pauseBtn').textContent=paused?'▶':'Ⅱ';last=performance.now();}
$('#fightBtn').addEventListener('click',startMatch);$('#rematchBtn').addEventListener('click',startMatch);$('#rosterBtn').addEventListener('click',()=>{resultDialog.close();gameScreen.classList.add('hidden');selectScreen.classList.remove('hidden');});$('#pauseBtn').addEventListener('click',togglePause);
$('#soundBtn').addEventListener('click',e=>{audioEnabled=!audioEnabled;e.currentTarget.textContent=audioEnabled?'SOUND ON':'SOUND OFF';});
$('#howBtn').addEventListener('click',()=>$('#controlsDialog').showModal());$('#closeHow').addEventListener('click',()=>$('#controlsDialog').close());
$('#updatesBtn').addEventListener('click',()=>$('#updatesDialog').showModal());$('#closeUpdates').addEventListener('click',()=>$('#updatesDialog').close());

renderRoster();renderDetail();
