const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const site=process.env.STATIC_GAME_URL||'http://127.0.0.1:8080';
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
try{const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/game.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+`
window.comboChecks=()=>{
 const saved={player,cpu,startDelay,audioEnabled,gameMode};audioEnabled=false;startDelay=0;gameMode='classic';
 try{
  const simulate=(actions,{blocked=false,miss=false,poor=false,spacing=12}={})=>{
   player=new Fighter(ROSTER[1],500,1);cpu=new Fighter(ROSTER[0],miss?1100:615,-1);
   cpu.maxHealth=cpu.health=1000;cpu.remoteControlled=true;cpu.remoteInput={block:blocked};cpu.blocking=blocked;
   if(poor)player.stamina=6;
   let next=0,hits=0,lastHealth=cpu.health;
   for(let i=0;i<180;i++){
    if(next<actions.length&&i>=next*spacing){player.queueAttack(actions[next],next+1);next++;}
    player.update(1/120,cpu);cpu.update(1/120,player);resolveCombat();
    if(cpu.health<lastHealth){hits++;lastHealth=cpu.health;}
   }
   return {hits,name:player.comboName,stamina:player.stamina,resolved:player.lastResolvedAttackSequence};
  };
  return {combos:COMBOS.map(combo=>({...simulate(combo.actions),expected:combo.name,count:combo.actions.length})),
   late:simulate(['jab','cross'],{spacing:36}),tooLate:simulate(['jab','cross'],{spacing:50}),blocked:simulate(['jab','jab','cross'],{blocked:true}),miss:simulate(['jab','cross'],{miss:true}),poor:simulate(['jab','cross'],{poor:true})};
 }finally{player=saved.player;cpu=saved.cpu;startDelay=saved.startDelay;audioEnabled=saved.audioEnabled;gameMode=saved.gameMode;particles=[];sparks=[];}
};`});});
await page.goto(site);const result=await page.evaluate(()=>comboChecks());
for(const combo of result.combos){assert.equal(combo.name,combo.expected);assert.equal(combo.hits,combo.count);}
assert.equal(result.late.name,'One-Two');assert.equal(result.tooLate.name,'');assert.equal(result.blocked.name,'');assert.equal(result.blocked.hits,1);assert.equal(result.miss.hits,0);assert.equal(result.poor.hits,1);assert.equal(result.poor.name,'');assert.deepEqual(errors,[]);
console.log(JSON.stringify(result,null,2));
// Capture actual rendered anticipation, contact and recovery poses for visual review.
await page.route('**/game.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+`
window.poseSheet=()=>{
 const original=ctx;const out=document.createElement('canvas');out.width=1280;out.height=720;ctx=out.getContext('2d');ctx.fillStyle='#171323';ctx.fillRect(0,0,1280,720);
 try{for(let row=0;row<2;row++)for(let column=0;column<4;column++){
 const f=new Fighter(ROSTER[row?12:1],column*320+150,1);f.y=row*360+320;f.state=row?'heavyKick':'cross';f.stateTime=[0,.08,ATTACKS[f.state].startup,ATTACKS[f.state].duration*.85][column];drawFighter(f,0);
 ctx.fillStyle='#fff';ctx.font='16px sans-serif';ctx.fillText(['Guard','Windup','Contact','Recovery'][column],column*320+110,row*360+25);
 }return out.toDataURL();}finally{ctx=original;}
};`});});
await page.reload();const data=await page.evaluate(()=>poseSheet());require('fs').writeFileSync('/tmp/combo-pose-sheet.png',Buffer.from(data.split(',')[1],'base64'));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
