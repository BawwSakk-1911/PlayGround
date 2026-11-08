import * as THREE from 'three';

const canvas = document.querySelector('#game');
const $ = (id) => document.getElementById(id);
const ui = {
  start: $('start-screen'), pause: $('pause-screen'), end: $('end-screen'), deploy: $('deploy'), resume: $('resume'), restart: $('restart'),
  objective: $('objective-count'), health: $('health-fill'), healthNum: $('health-number'), ammo: $('ammo-current'), reserve: $('ammo-reserve'), bars: $('ammo-bars'),
  crosshair: document.querySelector('.crosshair'), hit: $('hit-marker'), prompt: $('interact-prompt'), damage: $('damage-flash'), toast: $('toast'),
  objectiveText: $('objective-text'), mobile: $('mobile-controls'), movePad: $('move-pad'), mobileFire: $('mobile-fire'), mobileReload: $('mobile-reload')
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x89949a);
scene.fog = new THREE.FogExp2(0x89949a, 0.012);
const camera = new THREE.PerspectiveCamera(73, window.innerWidth / window.innerHeight, 0.1, 180);
camera.position.set(0, 1.72, 12);
const clock = new THREE.Clock();
let started = false, paused = false, ended = false, pointerLocked = false;
let health = 100, mag = 30, reserve = 120, kills = 0, shots = 0, hits = 0;
let fireCooldown = 0, reloadTimer = 0, invulnerable = 0, recoil = 0, muzzleTimer = 0, toastTimer = 0;
let wave = 1, waveHostiles = 6, waveKills = 0, spawned = 0, waveWait = 0;
const keys = {}, enemies = [], bullets = [], particles = [];
const raycaster = new THREE.Raycaster();
const moveDir = new THREE.Vector3();
const audio = { ctx: null };
let pitch = 0, yaw = 0, lookTouch = null, joystick = { x: 0, y: 0 }, fireHeld = false;

function mat(color, roughness = .8, metalness = 0) { return new THREE.MeshStandardMaterial({ color, roughness, metalness }); }
function box(parent, name, size, position, material, cast = true, receive = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.name = name; mesh.position.set(...position); mesh.castShadow = cast; mesh.receiveShadow = receive; parent.add(mesh); return mesh;
}
function textureCanvas(w, h, painter) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; painter(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// WORLD BUILD
scene.add(camera);
const hemi = new THREE.HemisphereLight(0xc5d5df, 0x323535, 1.55); scene.add(hemi);
const moon = new THREE.DirectionalLight(0xe4e9e9, 2.8); moon.position.set(-16, 25, 14); moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048); moon.shadow.camera.left = -34; moon.shadow.camera.right = 34; moon.shadow.camera.top = 34; moon.shadow.camera.bottom = -34; moon.shadow.bias = -.00035; scene.add(moon);
const cityGlow = new THREE.PointLight(0xe7a872, 95, 55, 1.7); cityGlow.position.set(-8, 10, -19); scene.add(cityGlow);
const blueGlow = new THREE.PointLight(0x7794ad, 75, 50, 1.8); blueGlow.position.set(13, 9, -30); scene.add(blueGlow);

const asphaltTex = textureCanvas(512, 512, (ctx, w, h) => {
  ctx.fillStyle = '#343b3c'; ctx.fillRect(0, 0, w, h);
  for (let i=0;i<14000;i++) { const v = Math.random()*55; ctx.fillStyle = `rgba(${v+35},${v+39},${v+39},${Math.random()*.24})`; ctx.fillRect(Math.random()*w,Math.random()*h,Math.random()*3+1,Math.random()*3+1); }
  for(let i=0;i<26;i++){ctx.strokeStyle=`rgba(12,17,18,${Math.random()*.22})`;ctx.lineWidth=Math.random()*2+1;ctx.beginPath();let x=Math.random()*w,y=Math.random()*h;ctx.moveTo(x,y);ctx.lineTo(x+(Math.random()-.5)*95,y+(Math.random()-.5)*40);ctx.stroke();}
});
asphaltTex.repeat.set(3, 3);
const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(120,120), new THREE.MeshStandardMaterial({map:asphaltTex, color:0xb5b8b3, roughness:1}));
asphalt.rotation.x=-Math.PI/2; asphalt.position.y=-.04; asphalt.receiveShadow=true; scene.add(asphalt);
const concrete = mat(0x6d7270), curbMat=mat(0x898b84), roadPaint=mat(0xaaa98b), darkMetal=mat(0x242b2c,.55,.55);
// Broken center divider, curb lanes, and sidewalks
for(let z=-49;z<33;z+=7) box(scene,'lane dash',[.13,.015,3.2],[0,.015,z],roadPaint,false,false);
for(const x of [-9.5,9.5]) { box(scene,'curb',[.36,.2,110],[x,.03,-8],curbMat,false,true); box(scene,'sidewalk',[5,.24,110],[x+(x<0?-2.65:2.65),-.02,-8],concrete,false,true); }

const facadeMats=[0x4a5150,0x59605d,0x68665e,0x424c4d,0x686d68,0x555957].map(c=>mat(c,.94));
const glassMats=[0x273b43,0x36464a,0x52605c,0x202e35].map(c=>new THREE.MeshStandardMaterial({color:c,roughness:.27,metalness:.25,emissive:c,emissiveIntensity:.07}));
const litGlass=new THREE.MeshStandardMaterial({color:0xb18457,emissive:0xb7743e,emissiveIntensity:.75,roughness:.45});
function building(x,z,w,d,h,mi=0) {
  const g=new THREE.Group(); scene.add(g);
  box(g,'building shell',[w,h,d],[x,h/2-.04,z],facadeMats[mi],true,true);
  box(g,'roof parapet',[w+.3,.45,d+.3],[x,h+.14,z],facadeMats[(mi+2)%facadeMats.length]);
  const rows=Math.floor((h-2.8)/2.65), cols=Math.max(2,Math.floor(w/2.5));
  for(let row=0;row<rows;row++) for(let col=0;col<cols;col++) {
    const wx=x-w/2+1.25+col*(w-2.5)/(cols-1), wy=2.0+row*2.65;
    if(w>12 && col===Math.floor(cols/2) && row<2) continue;
    const windowMat=Math.random()<.14?litGlass:glassMats[(mi+col+row)%glassMats.length];
    box(g,'window frame',[1.24,1.52,.1],[wx,wy,z+d/2+.055],darkMetal,false);
    box(g,'window glass',[1.02,1.3,.04],[wx,wy,z+d/2+.12],windowMat,false);
    box(g,'window mullion',[.045,1.3,.055],[wx,wy,z+d/2+.15],darkMetal,false,false);
  }
  // Side facade recesses add depth and breakup
  for(let side of [-1,1]) for(let row=0;row<rows;row++) for(let col=0;col<Math.max(1,Math.floor(d/3));col++) {
    const wz=z-d/2+1.5+col*(d-3)/Math.max(1,Math.floor(d/3)-1), wy=2+row*2.65;
    box(g,'side window',[.05,1.35,1.1],[x+side*(w/2+.04),wy,wz],glassMats[(row+col+mi)%glassMats.length],false,false);
  }
  box(g,'shop awning',[w*.82,.18,.9],[x,3.1,z+d/2+.55],darkMetal);
  return g;
}
building(-18,-31,17,18,22,0); building(-18,-7,15,16,19,2); building(-20,17,20,19,25,4);
building(19,-35,19,18,28,1); building(19,-10,17,17,21,3); building(20,15,21,20,24,5);
building(-42,-26,20,26,34,2); building(43,-22,24,28,38,0);
// Alley end, skyline silhouettes
for(let i=0;i<12;i++){
 const x=-52+i*9.5, h=20+Math.random()*26;
 box(scene,'distant tower',[7+Math.random()*4,h,8],[x,h/2-1,-65],facadeMats[i%6],false,false);
}

// Street details: dumpsters, traffic barriers, bollards, lamps, debris
const yellow=mat(0xc1a54d), rust=mat(0x54483a), barrierRed=mat(0x9b4935);
function streetLamp(x,z){
 box(scene,'lamp post',[.13,6.6,.13],[x,3.3,z],darkMetal);
 box(scene,'lamp arm',[1.3,.11,.11],[x+(x<0?.55:-.55),6.5,z],darkMetal);
 const glow=new THREE.PointLight(0xf5bd77,42,13,2);glow.position.set(x+(x<0?.9:-.9),6.15,z);scene.add(glow);
 const bulb=new THREE.Mesh(new THREE.BoxGeometry(.4,.13,.32),new THREE.MeshBasicMaterial({color:0xffd49a}));bulb.position.copy(glow.position);scene.add(bulb);
}
for(const z of [-43,-24,-4,17]){streetLamp(-8.6,z);streetLamp(8.6,z);}
function dumpster(x,z){
 box(scene,'dumpster body',[2.7,1.35,1.25],[x,.75,z],mat(0x35413d)); box(scene,'dumpster lid',[2.82,.15,1.32],[x,1.48,z],mat(0x4b5750));
 for(let dx of [-.9,.9]){const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.18,.18,.12,10),darkMetal);wheel.rotation.z=Math.PI/2;wheel.position.set(x+dx,.18,z+.46);scene.add(wheel);}
}
dumpster(-7.3,-13); dumpster(7.5,-30);
function barrier(x,z,rot=0){const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=rot;scene.add(g);box(g,'concrete barrier',[4,.85,.85],[0,.43,0],curbMat);for(let n=-1;n<=1;n+=2)box(g,'hazard stripe',[.55,.65,.88],[n*.8,.45,0],barrierRed,false);}
barrier(-4,-21,-.12); barrier(4,-39,.08); barrier(3,-5,-.05);
for(const [x,z] of [[-5,-31],[5,-17],[-3,5],[6,-46]]){
 const c=new THREE.Mesh(new THREE.CylinderGeometry(.42,.48,1.1,12),mat(0x454947));c.position.set(x,.55,z);c.castShadow=true;scene.add(c);
 const band=new THREE.Mesh(new THREE.CylinderGeometry(.49,.49,.16,12),yellow);band.position.set(x,.57,z);scene.add(band);
}
// road drains and small debris add grounded detail
for(let i=0;i<26;i++){
 const x=(Math.random()-.5)*17, z=-46+Math.random()*75;
 const s=.08+Math.random()*.15; const debris=new THREE.Mesh(new THREE.BoxGeometry(s,.025,s*2),i%3===0?mat(0x8e8067):darkMetal);
 debris.position.set(x,.03,z);debris.rotation.y=Math.random()*3;scene.add(debris);
}

// Detailed first-person rifle, built as camera-attached meshes
const weapon=new THREE.Group(); camera.add(weapon); weapon.position.set(.35,-.34,-.67); weapon.rotation.set(-.03,.04,0);
const gunBody=mat(0x202728,.52,.62), gunEdge=mat(0x46504e,.38,.72), polymer=mat(0x343b39,.82), rubber=mat(0x171d1e,.95);
box(weapon,'receiver',[.19,.18,.45],[0,0,0],gunBody);
box(weapon,'upper receiver',[.18,.12,.43],[0,.105,-.015],gunEdge);
box(weapon,'handguard',[.16,.14,.42],[0,.025,-.36],polymer);
box(weapon,'barrel',[.065,.065,.47],[0,.025,-.77],gunEdge);
box(weapon,'muzzle brake',[.11,.1,.13],[0,.025,-1.02],darkMetal);
box(weapon,'stock',[.14,.16,.34],[0,-.045,.38],polymer);
box(weapon,'stock pad',[.15,.18,.08],[0,-.05,.58],rubber);
box(weapon,'magazine',[.13,.31,.16],[0,-.22,.04],gunBody).rotation.x=-.14;
box(weapon,'grip',[.12,.2,.13],[0,-.18,.18],rubber).rotation.x=-.25;
box(weapon,'optic mount',[.08,.09,.19],[0,.18,-.05],gunBody);
box(weapon,'optic',[.13,.17,.18],[0,.28,-.04],gunBody);
box(weapon,'optic glass',[.11,.1,.015],[0,.29,-.135],new THREE.MeshStandardMaterial({color:0x546a66,metalness:.65,roughness:.16,emissive:0x173933,emissiveIntensity:.4}));
for(let i=0;i<5;i++) box(weapon,'rail slot',[.018,.012,.075],[i%2?.09:-.09,.1,-.28+i*.1],gunEdge,false,false);
for(let i=0;i<4;i++) box(weapon,'handguard groove',[.012,.025,.04],[i%2?.084:-.084,.03,-.43+i*.09],darkMetal,false,false);
const muzzleFlash=new THREE.Group(); muzzleFlash.position.set(0,.02,-1.12); muzzleFlash.visible=false;weapon.add(muzzleFlash);
const flashMat=new THREE.MeshBasicMaterial({color:0xffd37d,transparent:true,opacity:.95,side:THREE.DoubleSide});
const flashMesh=new THREE.Mesh(new THREE.ConeGeometry(.16,.42,8),flashMat);flashMesh.rotation.x=-Math.PI/2; muzzleFlash.add(flashMesh);
const flashLight=new THREE.PointLight(0xffbf5d,0,5,2);camera.add(flashLight);flashLight.position.set(0,.02,-1.3);

// INPUT + GAME STATE
const hostileMat = new THREE.MeshStandardMaterial({color:0x333b3d,roughness:.88});
const vestMat = new THREE.MeshStandardMaterial({color:0x45473c,roughness:.96});
const helmetMat = new THREE.MeshStandardMaterial({color:0x202728,roughness:.68,metalness:.18});
const enemySkin = new THREE.MeshStandardMaterial({color:0x9a806d,roughness:.95});
const enemyAccent = new THREE.MeshStandardMaterial({color:0x9d4739,roughness:.84});
const enemyGun = mat(0x171d1d,.52,.52);
function addEnemy(position) {
  const root=new THREE.Group(); scene.add(root); root.position.set(position[0],0,position[1]);
  const body=new THREE.Group();root.add(body);
  const parts=[];
  function part(mesh,name,head=false){mesh.name=name;mesh.userData.enemy=root;mesh.userData.head=head;body.add(mesh);parts.push(mesh);return mesh;}
  part(new THREE.Mesh(new THREE.BoxGeometry(.64,.75,.34),hostileMat),'body').position.set(0,1.16,0);
  part(new THREE.Mesh(new THREE.BoxGeometry(.53,.38,.35),vestMat),'vest').position.set(0,1.24,-.19);
  part(new THREE.Mesh(new THREE.BoxGeometry(.28,.29,.29),enemyAccent),'chest patch').position.set(-.19,1.27,-.375);
  const head=part(new THREE.Mesh(new THREE.SphereGeometry(.19,12,10),enemySkin),'head',true);head.position.set(0,1.78,-.01);head.scale.set(.84,1.06,.88);
  const helmet=part(new THREE.Mesh(new THREE.SphereGeometry(.21,12,8,0,Math.PI*2,0,Math.PI*.56),helmetMat),'helmet');helmet.position.set(0,1.83,-.015);helmet.scale.set(1.12,.8,1.12);
  part(new THREE.Mesh(new THREE.BoxGeometry(.46,.065,.37),helmetMat),'helmet brim').position.set(0,1.77,-.18);
  // articulated silhouette: arms angled inward over rifle, legs in a ready stance
  for(const side of [-1,1]){
    const arm=new THREE.Mesh(new THREE.BoxGeometry(.19,.62,.2),hostileMat);arm.position.set(side*.43,1.12,-.14);arm.rotation.z=side*.16;arm.rotation.x=-.3;part(arm,'arm');
    const glove=part(new THREE.Mesh(new THREE.BoxGeometry(.18,.15,.18),rubber),'glove');glove.position.set(side*.38,.86,-.38);
    const leg=part(new THREE.Mesh(new THREE.BoxGeometry(.24,.68,.26),hostileMat),'leg');leg.position.set(side*.17,.42,.015);leg.rotation.x=side*.04;
    const boot=part(new THREE.Mesh(new THREE.BoxGeometry(.26,.16,.38),rubber),'boot');boot.position.set(side*.17,.12,-.055);
  }
  const rifle=part(new THREE.Mesh(new THREE.BoxGeometry(.1,.09,.63),enemyGun),'rifle');rifle.position.set(0,1.04,-.48);
  const stock=part(new THREE.Mesh(new THREE.BoxGeometry(.12,.12,.19),rubber),'rifle stock');stock.position.set(0,1.04,-.13);
  const muzzle= new THREE.Mesh(new THREE.SphereGeometry(.055,8,6),new THREE.MeshBasicMaterial({color:0xff9c4a}));muzzle.position.set(0,1.04,-.84);muzzle.visible=false;root.add(muzzle);
  root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  const enemy={root,body,parts,muzzle,hp:100,alive:true,fire:1+Math.random()*1.8,anim:Math.random()*6,damageFlash:0};
  for(const p of parts)p.userData.enemyRecord=enemy;
  enemies.push(enemy); return enemy;
}
function spawnWave(){
  const count=wave===1?6:wave===2?7:8;waveHostiles=count;waveKills=0;spawned=0;waveWait=0;
  ui.objective.textContent=`00 / ${String(count).padStart(2,'0')}`;ui.objectiveText.textContent=wave===1?'NEUTRALIZE HOSTILES':`WAVE ${wave} — NEUTRALIZE HOSTILES`;
  const positions=[[-5,-22],[5,-26],[-7,-35],[7,-39],[-2,-45],[3,-50],[-6,-55],[6,-58]];
  for(let i=0;i<count;i++) addEnemy(positions[i]); spawned=count;
}
spawnWave();
function makeSound(kind){
  try{
    if(!audio.ctx)audio.ctx=new (window.AudioContext||window.webkitAudioContext)();
    const c=audio.ctx;if(c.state==='suspended')c.resume();const now=c.currentTime;
    const osc=c.createOscillator(),gain=c.createGain();osc.connect(gain);gain.connect(c.destination);
    if(kind==='shot'){osc.type='sawtooth';osc.frequency.setValueAtTime(115,now);osc.frequency.exponentialRampToValueAtTime(42,now+.11);gain.gain.setValueAtTime(.055,now);gain.gain.exponentialRampToValueAtTime(.001,now+.13);osc.start(now);osc.stop(now+.14);}
    else if(kind==='hit'){osc.type='square';osc.frequency.setValueAtTime(760,now);osc.frequency.exponentialRampToValueAtTime(280,now+.06);gain.gain.setValueAtTime(.025,now);gain.gain.exponentialRampToValueAtTime(.001,now+.075);osc.start(now);osc.stop(now+.08);}
    else {osc.type='triangle';osc.frequency.setValueAtTime(170,now);osc.frequency.exponentialRampToValueAtTime(65,now+.23);gain.gain.setValueAtTime(.07,now);gain.gain.exponentialRampToValueAtTime(.001,now+.24);osc.start(now);osc.stop(now+.25);}
  }catch(e){}
}
function showToast(text){ui.toast.textContent=text;ui.toast.classList.add('show');toastTimer=1.5;}
function updateAmmo(){ui.ammo.textContent=String(mag).padStart(2,'0');ui.reserve.textContent=String(reserve).padStart(3,'0');ui.bars.innerHTML='';for(let i=0;i<30;i++){const b=document.createElement('i');if(i>=mag)b.className='empty';ui.bars.appendChild(b);}}
function setHealth(value){health=Math.max(0,Math.min(100,value));ui.health.style.width=`${health}%`;ui.health.style.background=health<30?'#df7059':'#d7df58';ui.healthNum.textContent=String(Math.ceil(health)).padStart(3,'0');}
function reload(){if(!started||paused||reloadTimer>0||mag>=30||reserve<=0)return;reloadTimer=1.25;showToast('RELOADING');}
function fire(){
  if(!started||paused||ended||fireCooldown>0||reloadTimer>0)return;
  if(mag<=0){reload();return;}
  mag--;shots++;updateAmmo();fireCooldown=.105;recoil=Math.min(recoil+.11,.24);muzzleTimer=.055;muzzleFlash.visible=true;flashLight.intensity=10;makeSound('shot');
  const spread=.0035+(keys.Shift?.012:0);raycaster.setFromCamera(new THREE.Vector2((Math.random()-.5)*spread,(Math.random()-.5)*spread),camera);raycaster.far=90;
  const objects=[];for(const e of enemies)if(e.alive)objects.push(...e.parts);
  const hit=raycaster.intersectObjects(objects,false)[0];
  if(hit){const e=hit.object.userData.enemyRecord;if(e&&e.alive){hits++;const damage=hit.object.userData.head?100:38;e.hp-=damage;makeSound('hit');ui.hit.classList.add('show');setTimeout(()=>ui.hit.classList.remove('show'),105);if(e.hp<=0)killEnemy(e);}}
}
function killEnemy(e){
  if(!e.alive)return;e.alive=false;kills++;waveKills++;
  ui.objective.textContent=`${String(waveKills).padStart(2,'0')} / ${String(waveHostiles).padStart(2,'0')}`;
  // brief collapse, then remove the downed hostile
  e.root.rotation.x=.22;e.root.position.y=-.18;
  setTimeout(()=>scene.remove(e.root),650);
  if(enemies.every(x=>!x.alive)){
    if(wave<3){wave++;showToast(`SECTOR CLEAR — WAVE ${wave} INBOUND`);waveWait=3.2;}
    else finish(true);
  }
}
function finish(success){ended=true;started=false;document.exitPointerLock?.();$('end-kicker').textContent=success?'MISSION COMPLETE':'OPERATOR DOWN';$('end-title').innerHTML=success?'BLOCK<br><em>SECURED.</em>':'MISSION<br><em>FAILED.</em>';$('end-copy').textContent=success?'All hostiles neutralized. Good work, operator.':'You were overwhelmed. Regroup and try again.';$('end-kills').textContent=String(kills).padStart(2,'0');$('end-accuracy').textContent=shots?`${Math.round(hits/shots*100)}%`:'—';$('end-status').textContent=success?'SUCCESS':'KIA';ui.end.classList.remove('hidden');}

// INPUT
camera.rotation.order='YXZ';
function deploy(){
  if(ended)return;
  ui.start.classList.add('hidden');ui.pause.classList.add('hidden');started=true;paused=false;
  ui.prompt.textContent='CLICK TO AIM / FIRE';
  if(window.matchMedia('(pointer:fine)').matches)canvas.requestPointerLock?.();
  else ui.mobile.style.display='flex';
  makeSound('hit');
}
function pauseGame(){if(!started||ended)return;paused=true;ui.pause.classList.remove('hidden');ui.prompt.textContent='CLICK TO RESUME';}
function resumeGame(){if(ended)return;paused=false;ui.pause.classList.add('hidden');if(window.matchMedia('(pointer:fine)').matches)canvas.requestPointerLock?.();}
ui.deploy.addEventListener('click',deploy);ui.resume.addEventListener('click',resumeGame);
ui.restart.addEventListener('click',()=>location.reload());
canvas.addEventListener('click',()=>{if(started&&paused){resumeGame();return;}if(started&&!pointerLocked&&window.matchMedia('(pointer:fine)').matches)canvas.requestPointerLock?.();else if(started&&pointerLocked)fire();});
document.addEventListener('pointerlockchange',()=>{
 pointerLocked=document.pointerLockElement===canvas;
 if(started&&!pointerLocked&&window.matchMedia('(pointer:fine)').matches)pauseGame();
 if(pointerLocked){ui.prompt.textContent='';}
});
document.addEventListener('mousemove',e=>{if(!pointerLocked||!started||paused)return;yaw-=e.movementX*.0022;pitch-=e.movementY*.0022;pitch=Math.max(-1.25,Math.min(1.25,pitch));camera.rotation.set(pitch,yaw,0,'YXZ');});
document.addEventListener('keydown',e=>{
 keys[e.code]=true;
 if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
 if(e.code==='Escape'&&started&&!paused){pauseGame();}
 if(e.code==='KeyR')reload();
});
document.addEventListener('keyup',e=>keys[e.code]=false);
document.addEventListener('mousedown',e=>{if(e.button===0&&started&&!paused&&pointerLocked)fireHeld=true;});
document.addEventListener('mouseup',e=>{if(e.button===0)fireHeld=false;});
// Simple mobile look-drag and virtual movement pad
canvas.addEventListener('touchstart',e=>{if(!started||paused)return;const t=e.changedTouches[0];lookTouch={x:t.clientX,y:t.clientY,id:t.identifier};},{passive:true});
canvas.addEventListener('touchmove',e=>{if(!lookTouch)return;for(const t of e.changedTouches)if(t.identifier===lookTouch.id){yaw-=(t.clientX-lookTouch.x)*.006;pitch-=(t.clientY-lookTouch.y)*.006;pitch=Math.max(-1.1,Math.min(1.1,pitch));lookTouch={x:t.clientX,y:t.clientY,id:t.identifier};camera.rotation.set(pitch,yaw,0,'YXZ');}},{passive:true});
canvas.addEventListener('touchend',()=>lookTouch=null,{passive:true});
ui.movePad.addEventListener('pointerdown',e=>{e.preventDefault();ui.movePad.setPointerCapture(e.pointerId);});
ui.movePad.addEventListener('pointermove',e=>{if(!(e.buttons&1))return;const r=ui.movePad.getBoundingClientRect(),dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2),len=Math.max(1,Math.hypot(dx,dy)),m=Math.min(34,len);joystick.x=dx/len*m/34;joystick.y=dy/len*m/34;const knob=ui.movePad.querySelector('i');knob.style.left=`${37+joystick.x*25}px`;knob.style.top=`${37+joystick.y*25}px`;});
ui.movePad.addEventListener('pointerup',()=>{joystick={x:0,y:0};const k=ui.movePad.querySelector('i');k.style.left='36px';k.style.top='36px';});
ui.mobileFire.addEventListener('pointerdown',e=>{e.preventDefault();fireHeld=true;fire();});ui.mobileFire.addEventListener('pointerup',()=>fireHeld=false);ui.mobileFire.addEventListener('pointerleave',()=>fireHeld=false);
ui.mobileReload.addEventListener('click',reload);

function enemyShot(enemy){
  const start=new THREE.Vector3(enemy.root.position.x,1.05,enemy.root.position.z-.8);
  const target=camera.position.clone();target.y-=.3;
  const dir=target.sub(start).normalize();
  const group=new THREE.Group();scene.add(group);group.position.copy(start);
  const orb=new THREE.Mesh(new THREE.SphereGeometry(.075,8,6),new THREE.MeshBasicMaterial({color:0xff9b54}));group.add(orb);
  const trail=new THREE.Mesh(new THREE.CylinderGeometry(.018,.035,.55,6),new THREE.MeshBasicMaterial({color:0xff713b,transparent:true,opacity:.45}));trail.rotation.x=Math.PI/2;trail.position.z=.29;group.add(trail);group.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),dir);
  bullets.push({group,dir,speed:22,life:2});makeSound('enemy');
}
function damagePlayer(amount){if(invulnerable>0||ended)return;invulnerable=.32;setHealth(health-amount);ui.damage.classList.add('show');setTimeout(()=>ui.damage.classList.remove('show'),160);if(health<=0)finish(false);}
const blockers=[[-7.3,-13,1.8],[7.5,-30,1.8],[-4,-21,2.2],[4,-39,2.2],[3,-5,2.2],[-5,-31,.8],[5,-17,.8],[-3,5,.8],[6,-46,.8]];
function movePlayer(dt){
 let forward=(keys.KeyW||keys.ArrowUp?1:0)-(keys.KeyS||keys.ArrowDown?1:0)-joystick.y;
 let side=(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0)+joystick.x;
 const len=Math.hypot(forward,side);if(len>1){forward/=len;side/=len;}
 const speed=(keys.ShiftLeft||keys.ShiftRight?7.2:4.7);$('speed-label').textContent=(keys.ShiftLeft||keys.ShiftRight)?'SPRINT':'READY';
 const dx=(Math.sin(yaw)*forward+Math.cos(yaw)*side)*speed*dt;
 const dz=(-Math.cos(yaw)*forward+Math.sin(yaw)*side)*speed*dt;
 let nx=THREE.MathUtils.clamp(camera.position.x+dx,-8.15,8.15),nz=THREE.MathUtils.clamp(camera.position.z+dz,-54,25);
 for(const [x,z,r] of blockers){const vx=nx-x,vz=nz-z,d=Math.hypot(vx,vz);if(d<r){if(d===0){nx+=r;}else{nx=x+vx/d*r;nz=z+vz/d*r;}}}
 camera.position.x=nx;camera.position.z=nz;
}
function updateGame(dt){
 if(!started||paused||ended)return;
 if(fireCooldown>0)fireCooldown-=dt;if(invulnerable>0)invulnerable-=dt;
 if(reloadTimer>0){reloadTimer-=dt;if(reloadTimer<=0){const n=Math.min(30-mag,reserve);mag+=n;reserve-=n;updateAmmo();showToast('MAGAZINE READY');}}
 if(fireHeld&&pointerLocked)fire();if(muzzleTimer>0){muzzleTimer-=dt;if(muzzleTimer<=0){muzzleFlash.visible=false;flashLight.intensity=0;}}
 if(toastTimer>0){toastTimer-=dt;if(toastTimer<=0)ui.toast.classList.remove('show');}
 if(waveWait>0){waveWait-=dt;if(waveWait<=0)spawnWave();}
 movePlayer(dt);
 recoil=Math.max(0,recoil-dt*.72);weapon.position.set(.35,-.34+recoil*.35,-.67+recoil*.24);weapon.rotation.x=-.03-recoil*.5;
 ui.crosshair.style.transform=`scale(${1+recoil*1.6})`;
 for(const e of enemies){if(!e.alive)continue;e.fire-=dt;e.anim+=dt;
   const dx=camera.position.x-e.root.position.x,dz=camera.position.z-e.root.position.z,dist=Math.hypot(dx,dz);
   e.root.rotation.y=Math.atan2(dx,-dz);
   if(dist>13){e.root.position.x+=dx/dist*dt*.72;e.root.position.z+=dz/dist*dt*.72;}
   e.body.position.y=Math.sin(e.anim*3)*.035;
   if(e.fire<=0&&dist<55){enemyShot(e);e.fire=1.6+Math.random()*1.25;e.muzzle.visible=true;setTimeout(()=>e.muzzle.visible=false,80);}
 }
 for(let i=bullets.length-1;i>=0;i--){const b=bullets[i];b.life-=dt;b.group.position.addScaledVector(b.dir,b.speed*dt);
  if(b.life<=0||b.group.position.distanceTo(camera.position)<.6){if(b.group.position.distanceTo(camera.position)<.75)damagePlayer(7+Math.random()*5);scene.remove(b.group);bullets.splice(i,1);}}
}

// FRAME LOOP
function loop(){requestAnimationFrame(loop);const dt=Math.min(clock.getDelta(),.05);updateGame(dt);renderer.render(scene,camera);}
updateAmmo();loop();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
});
