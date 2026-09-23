import * as THREE from 'three';
import { GLTFLoader } from '/vendor/package/examples/jsm/loaders/GLTFLoader.js';

const app = document.querySelector('#app');
const BOSS_MAX_HP=160;
app.innerHTML = `
  <canvas id="game" aria-label="Tidal Bell 3D boss fight"></canvas>
  <div class="ui">
    <div class="vignette"></div><div class="damage-flash" id="damage-flash"></div>
    <div class="top-left"><div class="sigil">◯</div><div class="brand">TIDAL BELL<small>the drowned observatory</small></div></div>
    <div class="top-right"><span>01 / THE HOLLOW BELL</span><button class="sound-btn" id="sound" aria-label="Toggle sound">♫</button></div>
    <div class="boss-hud" id="boss-hud"><div class="name">The Hollow Bell</div><div class="caption" id="boss-caption">keeper of the undertide</div><div class="bar"><div class="bar-fill" id="boss-bar"></div><i class="phase-mark"></i></div></div>
    <div class="player-hud" id="player-hud"><div class="row"><div class="label">The Warden</div><div class="hp" id="player-hp">100 / 100</div></div><div class="bar"><div class="bar-fill" id="player-bar"></div></div><div class="dodge">Evade <div class="dodge-meter"><span id="dodge-bar"></span></div></div></div>
    <div class="controls"><strong>W A S D</strong> MOVE <span class="sep">/</span> <strong>CLICK · SPACE</strong> STRIKE <span class="sep">/</span> <strong>SHIFT</strong> EVADE</div>
    <div class="callout" id="callout"></div>
    <div class="mobile-controls" id="mobile-controls"><div class="stick" id="stick"><div class="stick-knob" id="stick-knob"></div></div><div class="mobile-actions"><button class="evade" id="evade-btn">EVADE</button><button class="attack" id="attack-btn">STRIKE</button></div></div>
    <div class="overlay" id="overlay"><div class="intro-panel"><div class="overline">An encounter beneath the still sea</div><div class="rule"></div><h1>THE<br><em>HOLLOW</em><br>BELL</h1><p>It once measured the tides. Now it listens for anything that moves. Read the warning on the stone, then answer with steel and motion.</p><button class="begin" id="begin">Enter the observatory &nbsp; ↗</button><div class="hint">Move close to strike. Evade through the moment of impact.</div></div></div>
  </div>`;

const $ = (id) => document.getElementById(id);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#061920');
scene.fog = new THREE.FogExp2('#061920', .019);
const camera = new THREE.PerspectiveCamera(42, innerWidth/innerHeight, .1, 150);
const renderer = new THREE.WebGLRenderer({canvas:$('game'), antialias:true, powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.29;
camera.position.set(0,21.5,24.5);
camera.lookAt(0,0,0);
scene.add(new THREE.HemisphereLight(0xc4e9e3,0x163037,1.15));
const keyLight = new THREE.DirectionalLight(0xe2fff2,2.55);
keyLight.position.set(-8,18,10);
keyLight.castShadow=true;
keyLight.shadow.mapSize.set(2048,2048);
Object.assign(keyLight.shadow.camera,{left:-22,right:22,top:22,bottom:-22,near:1,far:55});
keyLight.shadow.bias=-.0002;
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x41c3d0,3.15);
rimLight.position.set(7,8,-11);scene.add(rimLight);
const heartLight = new THREE.PointLight(0x5bf2dd,21,9,2);
heartLight.position.set(0,2.8,-.8);scene.add(heartLight);
const phaseLights = [];
for (let i=0;i<4;i++) {
  const a=(i+.5)*Math.PI/2;
  const p=new THREE.PointLight(0x4dcac5,0,11,2);
  p.position.set(Math.cos(a)*15.5,4,Math.sin(a)*15.5);
  scene.add(p);phaseLights.push(p);
}
const phaseChannels=[];
for(let i=0;i<4;i++){
  const a=(i+.5)*Math.PI/2;
  const g=new THREE.Group();g.rotation.y=a;
  const stripe=new THREE.Mesh(new THREE.PlaneGeometry(.13,3.7),new THREE.MeshBasicMaterial({color:0x75e8de,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));
  stripe.rotation.x=-Math.PI/2;stripe.position.set(0,.12,9.55);
  g.add(stripe);scene.add(g);phaseChannels.push(stripe);
}

const ocean = new THREE.Mesh(new THREE.PlaneGeometry(300,300),new THREE.MeshStandardMaterial({color:0x071e27,roughness:.35,metalness:.22}));
ocean.rotation.x=-Math.PI/2;ocean.position.y=-.66;ocean.receiveShadow=true;scene.add(ocean);
const underglow = new THREE.Mesh(new THREE.RingGeometry(13.8,24,96),new THREE.MeshBasicMaterial({color:0x17474c,transparent:true,opacity:.29,side:THREE.DoubleSide}));
underglow.rotation.x=-Math.PI/2;underglow.position.y=-.63;scene.add(underglow);

// Slow motes give the empty air depth while leaving the fighting plane clear.
const motesN=110, motePos=new Float32Array(motesN*3);
for(let i=0;i<motesN;i++){const a=Math.random()*Math.PI*2,r=15+Math.random()*45;motePos[i*3]=Math.cos(a)*r;motePos[i*3+1]=1+Math.random()*16;motePos[i*3+2]=Math.sin(a)*r;}
const motesGeo=new THREE.BufferGeometry();motesGeo.setAttribute('position',new THREE.BufferAttribute(motePos,3));
const motes=new THREE.Points(motesGeo,new THREE.PointsMaterial({color:0x85cfca,size:.075,transparent:true,opacity:.58,depthWrite:false}));scene.add(motes);

const loader=new GLTFLoader();
let bossModel, playerModel, bossMixer, clips={}, currentClip='', arenaModel;
const playerRoot=new THREE.Group(), bossRoot=new THREE.Group();
scene.add(playerRoot,bossRoot);
const bossBase={x:0,z:-1.4};
bossRoot.position.set(bossBase.x,.03,bossBase.z);
playerRoot.position.set(0,.08,7.25);
const playerShadow=new THREE.Mesh(new THREE.CircleGeometry(.65,32),new THREE.MeshBasicMaterial({color:0x031418,transparent:true,opacity:.55,depthWrite:false}));
playerShadow.rotation.x=-Math.PI/2;playerShadow.position.y=-.015;playerRoot.add(playerShadow);
const bossShadow=new THREE.Mesh(new THREE.CircleGeometry(2.35,48),new THREE.MeshBasicMaterial({color:0x031418,transparent:true,opacity:.38,depthWrite:false}));
bossShadow.rotation.x=-Math.PI/2;bossShadow.position.y=.005;bossRoot.add(bossShadow);

const state={mode:'loading',time:0,playerHP:100,bossHP:BOSS_MAX_HP,phase:1,playerVel:new THREE.Vector3(),playerFacing:Math.PI,
  attackT:0,attackHit:false,dodgeT:0,dodgeCD:0,dodgeDir:new THREE.Vector3(),invuln:0,playerStagger:0,
  attackBuffer:0,dodgeBuffer:0,
  bossState:'idle',bossT:0,bossAttack:null,bossAttackIndex:0,bossHit:false,phaseT:0,deathT:0,
  echoes:[],effects:[],shake:0,freeze:0,calloutT:0,playerStep:0};
const keys=new Set();let attackRequested=false,dodgeRequested=false;
let stickVec={x:0,z:0};
let moveTap=new THREE.Vector3(),moveTapT=0;
const tmp=new THREE.Vector3();
const cyan=0x75e8de, danger=0xff947d, pale=0xd9f9e4;

function playClip(name,duration,loop=false){
  if(!bossMixer||!clips[name])return;
  if(state.phase===2&&['idle','stride','sweep','lance','pulse','recoil'].includes(name))name='phase_'+name;
  if(currentClip===name && (name==='idle'||name==='stride'))return;
  const next=clips[name],prev=clips[currentClip];
  if(prev&&prev!==next)prev.fadeOut(.16);
  next.reset().fadeIn(.14).setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);
  next.clampWhenFinished=!loop;
  if(duration)next.setDuration(duration);
  else next.timeScale=1;
  next.play();currentClip=name;
}

function setCallout(text,t=1.3,teal=false){
  $('callout').textContent=text;$('callout').className='callout show'+(teal?' teal':'');state.calloutT=t;
}
function sound(freq=200,type='sine',length=.16,gain=.035,slide=0){
  if(sound.muted||!sound.ctx)return;
  const ctx=sound.ctx,o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.setValueAtTime(freq,ctx.currentTime);
  if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(20,freq+slide),ctx.currentTime+length);
  g.gain.setValueAtTime(gain,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+length);
  o.connect(g).connect(ctx.destination);o.start();o.stop(ctx.currentTime+length);
}
sound.muted=false;sound.ctx=null;
function unlockSound(){if(!sound.ctx)sound.ctx=new (window.AudioContext||window.webkitAudioContext)();sound.ctx.resume();}
function boom(){sound(79,'triangle',.4,.11,-47);sound(158,'sine',.23,.035,-112);}
function shimmer(){sound(480,'sine',.27,.025,-230);sound(760,'triangle',.13,.018,170);}

function material(color,opacity=.5){return new THREE.MeshBasicMaterial({color,transparent:true,opacity,side:THREE.DoubleSide,depthWrite:false});}
function circle(radius,color,opacity=.4){const m=new THREE.Mesh(new THREE.CircleGeometry(radius,64),material(color,opacity));m.rotation.x=-Math.PI/2;m.position.y=.13;return m;}
function ring(radius,color,opacity=.8,tube=.055){const mesh=new THREE.Mesh(new THREE.TorusGeometry(radius,tube,5,96),material(color,opacity));mesh.rotation.x=Math.PI/2;mesh.position.y=.17;return mesh;}
function sector(radius,halfAngle,color,opacity=.35){
  const verts=[0,0,0];const steps=38;
  for(let i=0;i<=steps;i++){let a=-halfAngle+2*halfAngle*i/steps;verts.push(Math.sin(a)*radius,0,Math.cos(a)*radius);}
  const idx=[];for(let i=1;i<=steps;i++)idx.push(0,i,i+1);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setIndex(idx);g.computeVertexNormals();
  const m=new THREE.Mesh(g,material(color,opacity));m.position.y=.13;return m;
}
function lane(length,width,color,opacity=.37){const m=new THREE.Mesh(new THREE.PlaneGeometry(width,length),material(color,opacity));m.rotation.x=-Math.PI/2;m.position.set(0,.14,length/2);return m;}
function orientXZ(object,angle){object.rotation.y=angle;}
function fx(object,life,update){scene.add(object);state.effects.push({object,life,total:life,update});}
function burst(x,z,color,count=10,power=2){
  const group=new THREE.Group();group.position.set(x,.8,z);
  const pieces=[];
  for(let i=0;i<count;i++){
    const mesh=new THREE.Mesh(new THREE.IcosahedronGeometry(.045+Math.random()*.065,0),material(color,.9));group.add(mesh);
    const a=Math.random()*Math.PI*2,up=.3+Math.random()*1.2;
    pieces.push({mesh,v:new THREE.Vector3(Math.cos(a)*power,up,Math.sin(a)*power).multiplyScalar(.45+Math.random()*.5)});
  }
  fx(group,.55,(e,dt)=>{for(const p of pieces){p.mesh.position.addScaledVector(p.v,dt);p.v.y-=4*dt;p.mesh.material.opacity=.85*e.life/e.total;}});
}
function flashRing(x,z,color,r0,r1,life=.38){const m=ring(r0,color,.8,.06);m.position.set(x,.17,z);fx(m,life,e=>{const t=1-e.life/e.total;m.scale.setScalar((r0+(r1-r0)*t)/r0);m.material.opacity=(1-t)*.8;});}
function slashFx(x,z,angle){const group=new THREE.Group();group.position.set(x,.63,z);group.rotation.y=angle;
  const m=sector(2.9,1.06,pale,.48);m.position.y=0;group.add(m);
  const outline=new THREE.Mesh(new THREE.TorusGeometry(2.85,.055,6,45,Math.PI*1.1),material(pale,.95));outline.rotation.x=Math.PI/2;outline.rotation.z=-.22;outline.position.z=.1;group.add(outline);
  fx(group,.22,e=>{const t=1-e.life/e.total;group.scale.setScalar(.85+t*.25);group.children.forEach(o=>o.material.opacity*=Math.max(.15,1-t*.2));});
}
function afterimage(){if(!playerModel)return;const ghost=playerModel.clone(true);ghost.position.copy(playerRoot.position);ghost.rotation.copy(playerRoot.rotation);
  ghost.traverse(o=>{if(o.isMesh){o.material=new THREE.MeshBasicMaterial({color:cyan,transparent:true,opacity:.2,depthWrite:false});o.castShadow=false;}});
  fx(ghost,.32,e=>{ghost.material&&(ghost.material.opacity=e.life/e.total*.2);ghost.traverse(o=>{if(o.isMesh)o.material.opacity=.2*e.life/e.total;});});
}

function updateHUD(){
  $('player-hp').textContent=`${Math.ceil(Math.max(0,state.playerHP))} / 100`;
  $('player-bar').style.transform=`scaleX(${Math.max(0,state.playerHP/100)})`;
  $('boss-bar').style.transform=`scaleX(${Math.max(0,state.bossHP/BOSS_MAX_HP)})`;
  $('dodge-bar').style.transform=`scaleX(${1-Math.min(1,state.dodgeCD/1.05)})`;
}
function damagePlayer(amount,source){
  if(state.mode!=='play'||state.invuln>0)return;
  state.playerHP=Math.max(0,state.playerHP-amount);state.invuln=.72;state.playerStagger=.28;state.shake=.19;
  $('damage-flash').style.opacity='.23';setTimeout(()=>$('damage-flash').style.opacity='0',90);
  burst(playerRoot.position.x,playerRoot.position.z,danger,12,3);boom();updateHUD();
  if(state.playerHP<=0){state.mode='dead';state.deathT=0;state.bossState='victory';setCallout('THE TIDE CLAIMS ANOTHER',2);}
}
function damageBoss(amount){
  if(state.mode!=='play'||state.bossState==='phase'||state.bossState==='defeat')return;
  state.bossHP=Math.max(0,state.bossHP-amount);state.shake=.12;state.freeze=.055;
  burst(bossRoot.position.x,bossRoot.position.z+1.5,pale,13,3.2);
  flashRing(bossRoot.position.x,bossRoot.position.z,pale,.6,2.9,.32);shimmer();updateHUD();
  const core=bossModel?.getObjectByName('resonance heart');if(core){core.material=core.material.clone();core.material.emissiveIntensity=4;setTimeout(()=>core.material.emissiveIntensity=1.35,110);}
  if(state.bossHP<=0){startDefeat();return;}
  if(state.phase===1&&state.bossHP<=BOSS_MAX_HP/2){startPhase();return;}
  if(state.bossState==='idle'||state.bossState==='chase'){
    state.bossState='recoil';state.bossT=0;playClip('recoil',.34);
  }
}

function startPhase(){
  state.phase=2;state.bossState='phase';state.phaseT=0;clearTelegraph();state.echoes.forEach(e=>scene.remove(e.visual));state.echoes=[];
  playClip('unfurl',2.1);setCallout('THE SHELL OPENS  ·  ECHOES AWAKEN',2.5,true);
  $('boss-hud').classList.add('phase-two');$('boss-caption').textContent='the undertide answers twice';
  phaseChannels.forEach(c=>c.material.opacity=.38);
  boom();flashRing(bossRoot.position.x,bossRoot.position.z,cyan,1,12,1.6);
}
function startDefeat(){
  state.mode='won';state.bossState='defeat';state.deathT=0;clearTelegraph();state.echoes.forEach(e=>scene.remove(e.visual));state.echoes=[];
  playClip('defeat',2.5);setCallout('THE BELL FALLS SILENT',3,true);boom();
  for(let i=0;i<3;i++)setTimeout(()=>flashRing(bossRoot.position.x,bossRoot.position.z,cyan,1.5,7+i*2,.8),i*310);
}
function showEnd(won){
  const overlay=$('overlay');overlay.className='overlay end-overlay';
  overlay.innerHTML=`<div class="intro-panel"><div class="overline">${won?'The observatory remembers':'The undertide endures'}</div><div class="rule"></div><h1>${won?'STILL<br><em>WATER</em>':'LOST<br><em>TO THE</em><br>TIDE'}</h1><p>${won?'The final resonance fades. For the first time in centuries, the sea below is quiet.':'The Hollow Bell waits in the deep. The stone still carries the shape of its attacks.'}</p><button class="begin" id="restart">Return to the observatory &nbsp; ↗</button></div>`;
  $('restart').addEventListener('click',resetGame);
}

function clearTelegraph(){if(state.bossAttack?.visual){scene.remove(state.bossAttack.visual);state.bossAttack.visual.geometry?.dispose();}state.bossAttack=null;}
function chooseAttack(){
  const d=bossRoot.position.distanceTo(playerRoot.position);
  const options=d>7?['lance','pulse']:d<4.7?['sweep','pulse','lance']:['lance','sweep','pulse'];
  const type=options[state.bossAttackIndex++%options.length];startAttack(type);
}
function startAttack(type){
  const angle=Math.atan2(playerRoot.position.x-bossRoot.position.x,playerRoot.position.z-bossRoot.position.z);
  const timings={sweep:[.83,.17,.69],lance:[1.02,.18,.71],pulse:[1.12,.92,.51]};
  const [wind,active,recover]=timings[type];
  let visual;
  if(type==='sweep')visual=sector(5.85,1.04,danger,.24);
  if(type==='lance')visual=lane(11,1.58,danger,.27);
  if(type==='pulse')visual=ring(3.2,danger,.78,.11);
  visual.position.x=bossRoot.position.x;visual.position.z=bossRoot.position.z;orientXZ(visual,angle);scene.add(visual);
  state.bossAttack={type,angle,wind,active,recover,t:0,visual,hit:false,pulseRadius:0,echoScheduled:false,origin:bossRoot.position.clone()};
  state.bossState='attack';state.bossT=0;
  playClip(type,wind+active+recover);
  setCallout({sweep:'FIN SWEEP  ·  CROSS THE ARC',lance:'NEEDLE THRUST  ·  LEAVE THE LINE',pulse:'RESONANCE  ·  EVADE THE RING'}[type],wind+.15);
  sound(type==='pulse'?280:170,'sine',wind*.65,.023,type==='pulse'?180:-80);
}
function insideAttack(type,origin,angle,radius){
  const dx=playerRoot.position.x-origin.x,dz=playerRoot.position.z-origin.z;
  const d=Math.hypot(dx,dz),diff=Math.atan2(Math.sin(Math.atan2(dx,dz)-angle),Math.cos(Math.atan2(dx,dz)-angle));
  if(type==='sweep')return d<5.85&&Math.abs(diff)<1.07;
  if(type==='lance')return d<10.8&&d>1&&Math.abs(Math.sin(diff)*d)<.84&&Math.cos(diff)>0;
  if(type==='pulse')return Math.abs(d-radius)<.65;
  return false;
}
function spawnEcho(a){
  let visual=a.type==='sweep'?sector(5.85,1.04,cyan,.16):a.type==='lance'?lane(11,1.58,cyan,.18):ring(1,cyan,.72,.07);
  visual.position.x=a.origin.x;visual.position.z=a.origin.z;orientXZ(visual,a.angle);scene.add(visual);
  state.echoes.push({type:a.type,origin:a.origin.clone(),angle:a.angle,t:0,delay:.85,visual,hit:false});
}
function updateEchoes(dt){
  for(let i=state.echoes.length-1;i>=0;i--){const e=state.echoes[i];e.t+=dt;
    if(e.t<e.delay){e.visual.material.opacity=(.12+.09*Math.sin(e.t*18))*(e.t/e.delay*.5+.5);}
    else if(e.type==='pulse'){
      const radius=(e.t-e.delay)*11.5;
      e.visual.scale.setScalar(Math.max(.02,radius));
      if(!e.hit&&insideAttack('pulse',e.origin,e.angle,radius)){damagePlayer(11,'echo');e.hit=true;}
    }else if(!e.hit){
      e.visual.material.opacity=.64;
      if(insideAttack(e.type,e.origin,e.angle))damagePlayer(11,'echo');
      flashRing(e.origin.x,e.origin.z,cyan,.7,3.2,.35);e.hit=true;shimmer();
    }
    const done=e.t>e.delay+(e.type==='pulse'?1.08:.23);
    if(done){scene.remove(e.visual);state.echoes.splice(i,1);}
  }
}
function updateBoss(dt){
  if(state.bossState==='phase'){
    state.phaseT+=dt;heartLight.intensity=22+Math.sin(state.phaseT*16)*14;
    phaseLights.forEach(p=>p.intensity=Math.min(8,state.phaseT*4));
    if(state.phaseT>2.25){state.bossState='idle';state.bossT=0;playClip('idle',null,true);}
    return;
  }
  if(state.bossState==='defeat'||state.bossState==='victory')return;
  if(state.bossState==='recoil'){
    state.bossT+=dt;
    if(state.bossT>.34){state.bossState='idle';state.bossT=0;playClip('idle',null,true);}
    return;
  }
  const dx=playerRoot.position.x-bossRoot.position.x,dz=playerRoot.position.z-bossRoot.position.z;
  const distance=Math.hypot(dx,dz),targetAngle=Math.atan2(dx,dz);
  let turn=Math.atan2(Math.sin(targetAngle-bossRoot.rotation.y),Math.cos(targetAngle-bossRoot.rotation.y));
  if(state.bossState!=='attack')bossRoot.rotation.y+=THREE.MathUtils.clamp(turn,-dt*2.2,dt*2.2);
  if(state.bossState==='attack'){
    const a=state.bossAttack;if(!a)return;
    a.t+=dt;state.bossT+=dt;
    if(a.t<a.wind){
      const p=a.t/a.wind;
      a.visual.material.opacity=(a.type==='pulse'?.44:.17)+p*(a.type==='pulse'?.30:.32);
      if(a.type==='pulse')a.visual.scale.setScalar(1+p*.08);
    } else if(a.t<a.wind+a.active){
      if(a.type==='pulse'){
        const p=(a.t-a.wind)/a.active;a.pulseRadius=.5+p*11.8;
        a.visual.scale.setScalar(a.pulseRadius/3.2);
        a.visual.material.opacity=.78*(1-p*.2);
        if(!a.hit&&insideAttack('pulse',a.origin,a.angle,a.pulseRadius)){damagePlayer(22,'pulse');a.hit=true;}
        if(!a.echoScheduled&&state.phase===2){spawnEcho(a);a.echoScheduled=true;}
      } else if(!a.hit){
        a.visual.material.opacity=.75;
        if(a.type==='lance'){
          const lunge=2.25*Math.min(1,(a.t-a.wind)/a.active);
          bossRoot.position.x=a.origin.x+Math.sin(a.angle)*lunge;
          bossRoot.position.z=a.origin.z+Math.cos(a.angle)*lunge;
        }
        if(insideAttack(a.type,a.origin,a.angle))damagePlayer(a.type==='sweep'?23:26,a.type);
        a.hit=true;boom();state.shake=.10;
        if(state.phase===2&&!a.echoScheduled){spawnEcho(a);a.echoScheduled=true;}
      }
    } else {
      a.visual.material.opacity=Math.max(0,a.visual.material.opacity-dt*2.5);
    }
    if(a.t>a.wind+a.active+a.recover){clearTelegraph();state.bossState='idle';state.bossT=0;playClip('idle',null,true);}
    return;
  }
  state.bossT+=dt;
  const desired=state.phase===2?4.7:4.35;
  if(distance>desired+.5){
    state.bossState='chase';playClip('stride',null,true);
    const speed=state.phase===2?2.6:2.25;
    bossRoot.position.x+=dx/distance*speed*dt;bossRoot.position.z+=dz/distance*speed*dt;
  }else{state.bossState='idle';playClip('idle',null,true);}
  if(state.bossT>(state.phase===2?1.38:1.65)&&distance<10.7)chooseAttack();
}

function getMove(){let x=0,z=0;
  if(keys.has('KeyA')||keys.has('ArrowLeft'))x--;
  if(keys.has('KeyD')||keys.has('ArrowRight'))x++;
  if(keys.has('KeyW')||keys.has('ArrowUp'))z--;
  if(keys.has('KeyS')||keys.has('ArrowDown'))z++;
  x+=stickVec.x;z+=stickVec.z;
  if(x===0&&z===0&&moveTapT>0){x=moveTap.x;z=moveTap.z;}
  return new THREE.Vector3(x,0,z).clampLength(0,1);
}
function updatePlayer(dt){
  moveTapT=Math.max(0,moveTapT-dt);
  if(attackRequested)state.attackBuffer=.24;
  if(dodgeRequested)state.dodgeBuffer=.20;
  attackRequested=false;dodgeRequested=false;
  state.attackBuffer=Math.max(0,state.attackBuffer-dt);
  state.dodgeBuffer=Math.max(0,state.dodgeBuffer-dt);
  state.attackT=Math.max(0,state.attackT-dt);
  state.dodgeT=Math.max(0,state.dodgeT-dt);
  state.dodgeCD=Math.max(0,state.dodgeCD-dt);
  state.invuln=Math.max(0,state.invuln-dt);
  state.playerStagger=Math.max(0,state.playerStagger-dt);
  const move=getMove();
  if(state.dodgeBuffer>0&&state.dodgeCD<=0&&state.playerStagger<=0){
    const dir=move.lengthSq()>.01?move:new THREE.Vector3(Math.sin(state.playerFacing),0,Math.cos(state.playerFacing));
    state.dodgeDir.copy(dir).normalize();state.dodgeT=.44;state.dodgeCD=1.05;state.invuln=Math.max(state.invuln,.38);
    state.attackT=0;state.attackBuffer=0;state.dodgeBuffer=0;shimmer();afterimage();
    flashRing(playerRoot.position.x,playerRoot.position.z,cyan,.25,1.15,.25);
  }
  if(state.attackBuffer>0&&state.attackT<=0&&state.dodgeT<=0&&state.playerStagger<=0){
    state.attackT=.54;state.attackHit=false;
    state.attackBuffer=0;
    const dx=bossRoot.position.x-playerRoot.position.x,dz=bossRoot.position.z-playerRoot.position.z;
    if(Math.hypot(dx,dz)<6.2)state.playerFacing=Math.atan2(dx,dz);
    sound(390,'triangle',.16,.036,-230);
  }
  const attacking=state.attackT>0,dodging=state.dodgeT>0;
  const speed=dodging?12.3:state.playerStagger>0?1.3:attacking?3.5:6.2;
  const wanted=dodging?state.dodgeDir:move;
  state.playerVel.lerp(wanted.clone().multiplyScalar(speed),Math.min(1,dt*(dodging?24:13)));
  playerRoot.position.addScaledVector(state.playerVel,dt);
  const radius=Math.hypot(playerRoot.position.x,playerRoot.position.z);
  if(radius>11.75){playerRoot.position.x*=11.75/radius;playerRoot.position.z*=11.75/radius;}
  const bossD=playerRoot.position.distanceTo(bossRoot.position);
  if(bossD<2.5){const ax=playerRoot.position.x-bossRoot.position.x,az=playerRoot.position.z-bossRoot.position.z,mag=Math.max(.01,Math.hypot(ax,az));
    playerRoot.position.x=bossRoot.position.x+ax/mag*2.5;playerRoot.position.z=bossRoot.position.z+az/mag*2.5;}
  if(!attacking&&!dodging&&move.lengthSq()>.05)state.playerFacing=Math.atan2(move.x,move.z);
  playerRoot.rotation.y+=Math.atan2(Math.sin(state.playerFacing-playerRoot.rotation.y),Math.cos(state.playerFacing-playerRoot.rotation.y))*Math.min(1,dt*15);
  state.playerStep+=dt*state.playerVel.length()*1.8;
  if(playerModel){
    const strike=attacking?1-state.attackT/.54:0;
    playerModel.rotation.z=attacking?Math.sin(strike*Math.PI)*-.20:0;
    playerModel.rotation.x=dodging?-.34:attacking?Math.sin(strike*Math.PI)*.19:0;
    playerModel.position.y=(dodging?-.23:0)+Math.sin(state.playerStep)*Math.min(.055,state.playerVel.length()*.013);
    playerModel.visible=!(state.invuln>0&&state.playerStagger>0&&Math.sin(state.time*52)>0);
  }
  if(attacking&&!state.attackHit&&state.attackT<.37){
    state.attackHit=true;slashFx(playerRoot.position.x,playerRoot.position.z,state.playerFacing);
    const dx=bossRoot.position.x-playerRoot.position.x,dz=bossRoot.position.z-playerRoot.position.z;
    const diff=Math.atan2(Math.sin(Math.atan2(dx,dz)-state.playerFacing),Math.cos(Math.atan2(dx,dz)-state.playerFacing));
    if(Math.hypot(dx,dz)<4.65&&Math.abs(diff)<1.3){damageBoss(state.phase===2?26:27);}
  }
  updateHUD();
}

function resetGame(){
  $('overlay').className='overlay hidden';$('boss-hud').classList.add('show');$('player-hud').classList.add('show');
  state.mode='play';state.time=0;state.playerHP=100;state.bossHP=BOSS_MAX_HP;state.phase=1;state.attackT=0;state.dodgeT=0;state.dodgeCD=0;state.invuln=0;state.attackBuffer=0;state.dodgeBuffer=0;
  state.playerStagger=0;state.bossState='idle';state.bossT=-.8;state.bossAttackIndex=0;state.playerVel.set(0,0,0);state.playerFacing=Math.PI;
  state.echoes.forEach(e=>scene.remove(e.visual));state.echoes=[];clearTelegraph();state.effects.forEach(e=>scene.remove(e.object));state.effects=[];
  playerRoot.position.set(0,.08,7.25);playerRoot.rotation.y=Math.PI;bossRoot.position.set(0,.03,-1.4);bossRoot.rotation.y=0;
  if(bossModel)bossModel.visible=true;
  phaseLights.forEach(p=>p.intensity=0);heartLight.intensity=21;$('boss-hud').classList.remove('phase-two');
  phaseChannels.forEach(c=>c.material.opacity=0);
  $('boss-caption').textContent='keeper of the undertide';
  playClip('idle',null,true);setCallout('LISTEN FOR THE WARNING',2,true);updateHUD();
  unlockSound();
}

const load=(url)=>new Promise((resolve,reject)=>loader.load(url,resolve,undefined,reject));
Promise.all([load('/assets/hollow_bell.glb'),load('/assets/observatory.glb'),load('/assets/warden.glb')]).then(([boss,arena,player])=>{
  bossModel=boss.scene;bossRoot.add(bossModel);bossModel.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  bossMixer=new THREE.AnimationMixer(bossModel);
  boss.animations.forEach(clip=>clips[clip.name]=bossMixer.clipAction(clip));
  arenaModel=arena.scene;arenaModel.traverse(o=>{if(o.isMesh){o.receiveShadow=true;if(/prong|pearl|bridge/.test(o.name))o.castShadow=true;}});scene.add(arenaModel);
  playerModel=player.scene;playerRoot.add(playerModel);playerModel.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  playClip('idle',null,true);state.mode='title';$('begin').textContent='Enter the observatory  ↗';$('begin').disabled=false;
}).catch(error=>{console.error(error);$('begin').textContent='Asset loading failed — refresh';$('begin').disabled=true;});

$('begin').textContent='Preparing the observatory…';$('begin').disabled=true;
document.addEventListener('keydown',e=>{
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
  keys.add(e.code);
  const direction={KeyW:[0,-1],ArrowUp:[0,-1],KeyS:[0,1],ArrowDown:[0,1],KeyA:[-1,0],ArrowLeft:[-1,0],KeyD:[1,0],ArrowRight:[1,0]}[e.code];
  if(direction){moveTap.set(direction[0],0,direction[1]);moveTapT=.14;}
  if(e.code==='Space'||e.code==='KeyJ')attackRequested=true;
  if(e.code==='ShiftLeft'||e.code==='ShiftRight'||e.code==='KeyK')dodgeRequested=true;
  if(e.code==='Enter'&&state.mode==='title')resetGame();
  if(e.code==='KeyR'&&(state.mode==='dead'||state.mode==='won'))resetGame();
});
document.addEventListener('keyup',e=>keys.delete(e.code));
$('game').addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&state.mode==='play')attackRequested=true;});
$('begin').addEventListener('click',()=>{if(state.mode==='title')resetGame();});
$('sound').addEventListener('click',()=>{sound.muted=!sound.muted;$('sound').textContent=sound.muted?'♩':'♫';if(!sound.muted)unlockSound();});
$('attack-btn').addEventListener('pointerdown',e=>{e.preventDefault();attackRequested=true;});
$('evade-btn').addEventListener('pointerdown',e=>{e.preventDefault();dodgeRequested=true;});
const stick=$('stick'),knob=$('stick-knob');
function updateStick(e){const r=stick.getBoundingClientRect(),dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2),m=Math.max(1,Math.hypot(dx,dy)),s=Math.min(1,m/45);
  stickVec={x:dx/m*s,z:dy/m*s};knob.style.transform=`translate(${stickVec.x*37}px,${stickVec.z*37}px)`;}
stick.addEventListener('pointerdown',e=>{stick.setPointerCapture(e.pointerId);updateStick(e);});
stick.addEventListener('pointermove',e=>{if(stick.hasPointerCapture(e.pointerId))updateStick(e);});
function endStick(){stickVec={x:0,z:0};knob.style.transform='translate(0,0)';}
stick.addEventListener('pointerup',endStick);stick.addEventListener('pointercancel',endStick);
function resize(){camera.aspect=innerWidth/innerHeight;camera.fov=innerWidth<760?54:42;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);}
addEventListener('resize',resize);resize();

let last=performance.now();
function frame(now){requestAnimationFrame(frame);let dt=Math.min(.04,(now-last)/1000);last=now;
  if(state.freeze>0){state.freeze-=dt;dt*=.13;}
  state.time+=dt;
  if(state.mode==='play'){updatePlayer(dt);updateBoss(dt);updateEchoes(dt);}
  if(state.mode==='won'||state.mode==='dead'){
    state.deathT+=dt;if(state.deathT>2.7&&$('overlay').classList.contains('hidden'))showEnd(state.mode==='won');
    if(state.mode==='won')heartLight.intensity=Math.max(0,heartLight.intensity-dt*9);
    if(state.mode==='dead'&&playerModel){playerModel.rotation.x=THREE.MathUtils.lerp(playerModel.rotation.x,-1.42,Math.min(1,dt*3));playerModel.position.y=Math.max(-.35,playerModel.position.y-dt*.45);}
  }
  if(bossMixer)bossMixer.update(dt);
  for(let i=state.effects.length-1;i>=0;i--){const e=state.effects[i];e.life-=dt;if(e.update)e.update(e,dt);
    if(e.life<=0){scene.remove(e.object);state.effects.splice(i,1);}}
  if(state.calloutT>0){state.calloutT-=dt;if(state.calloutT<=0)$('callout').classList.remove('show');}
  motes.rotation.y+=dt*.002;
  if(state.phase===2&&state.mode==='play')heartLight.intensity=29+Math.sin(state.time*5)*4;
  const camTarget=new THREE.Vector3(playerRoot.position.x*.18,0,playerRoot.position.z*.16);
  const narrow=innerWidth<760;
  const desired=new THREE.Vector3(camTarget.x,narrow?25:21.5,camTarget.z+(narrow?29:24.5));
  if(state.shake>0){desired.x+=(Math.random()-.5)*state.shake;desired.y+=(Math.random()-.5)*state.shake;state.shake=Math.max(0,state.shake-dt*.9);}
  camera.position.lerp(desired,Math.min(1,dt*2.4));camera.lookAt(camTarget.x,0,camTarget.z-1);
  renderer.render(scene,camera);
}
requestAnimationFrame(frame);
