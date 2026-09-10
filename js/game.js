/* Free Kick Simulator — single-file arcade game logic (Three.js r128) */
(function(){
'use strict';

/* ===================== CONFIG ===================== */
const CFG = {
  gravity: 9.81,
  dragCoeff: 0.010,       // a_drag = -dragCoeff * |v| * v
  magnusCoeff: 0.012,     // a_magnus = magnusCoeff * (spin x v)
  ballRadius: 0.11,
  goalWidth: 6.4,
  goalHeight: 2.35,
  postRadius: 0.07,

  speedMin: 17, speedMax: 32,
  loftMinDeg: 6, loftMaxDeg: 22,
  aimMaxDeg: 12.5,
  spinMax: 42,             // rad/s at full horizontal drag

  dragPixelRange: 230,     // px of drag mapped to 0..1 for power/aim/loft

  reactionBase: 0.44,
  reactionPowerFactor: 0.17,
  reactionLevelFactor: 0.012,
  reactionMin: 0.15,

  keeperMaxReachX: 2.55,
  keeperMaxReachY: 2.15,
  keeperErrorBase: 0.55,
  saveRadius: 0.62,

  livesStart: 3,
  goalBasePoints: 10,
  levelUpEvery: 5,

  flightTimeout: 3.2,
};

const PRESETS = [
  { name:'Practice — Center 20m',       dist:20, lateral:0,    label:'20m • CENTER' },
  { name:'Roberto Carlos Angle — 35m',  dist:27, lateral:-8.5, label:'27m • WIDE LEFT' },
  { name:'Messi Curler — 18m Right',    dist:18, lateral:6.5,  label:'18m • RIGHT EDGE' },
  { name:'Beckham Special — 25m',       dist:25, lateral:0.6,  label:'25m • CENTER' },
  { name:'Sniper — 12m Tight Angle',    dist:13, lateral:-6.2, label:'13m • TIGHT ANGLE' },
];

/* ===================== UTIL ===================== */
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const lerp = (a,b,t)=>a+(b-a)*t;
const randRange = (a,b)=>a+Math.random()*(b-a);
const easeOutCubic = t=>1-Math.pow(1-t,3);
const easeOutBack = t=>{ const c1=1.70158,c3=c1+1; return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2); };
const easeOutQuad = t=>1-(1-t)*(1-t);
const deg2rad = d=>d*Math.PI/180;

/* ===================== PHYSICS CORE ===================== */
// Shared by live simulation and the drag preview.
function computeAccel(vel, spinY, out){
  const speed = vel.length();
  const dragX = -CFG.dragCoeff*speed*vel.x;
  const dragY = -CFG.dragCoeff*speed*vel.y;
  const dragZ = -CFG.dragCoeff*speed*vel.z;
  // magnus = magnusCoeff * (spin x v), spin = (0, spinY, 0)
  const magX =  CFG.magnusCoeff * (spinY*vel.z);
  const magZ =  CFG.magnusCoeff * (-spinY*vel.x);
  out.set(dragX+magX, -CFG.gravity+dragY, dragZ+magZ);
  return out;
}

const _acc = new THREE.Vector3();
function stepBallState(pos, vel, spinY, dt){
  computeAccel(vel, spinY, _acc);
  vel.addScaledVector(_acc, dt);
  pos.addScaledVector(vel, dt);
}

/* ===================== TEXTURES (procedural) ===================== */
function makeCanvas(w,h){ const c=document.createElement('canvas'); c.width=w; c.height=h; return c; }

function grassTexture(){
  const c = makeCanvas(256,256), ctx = c.getContext('2d');
  const tiles = 8, ts = 256/tiles;
  for(let y=0;y<tiles;y++){
    for(let x=0;x<tiles;x++){
      const dark = (x+y)%2===0;
      ctx.fillStyle = dark ? '#2e7d32' : '#3a9142';
      ctx.fillRect(x*ts,y*ts,ts,ts);
    }
  }
  // subtle blade noise
  ctx.globalAlpha = 0.07;
  for(let i=0;i<1400;i++){
    ctx.fillStyle = Math.random()>0.5 ? '#ffffff':'#003300';
    ctx.fillRect(Math.random()*256, Math.random()*256, 1.5, 1.5);
  }
  ctx.globalAlpha=1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10,20);
  tex.anisotropy = 4;
  return tex;
}

function crowdTexture(){
  const w=1024,h=256;
  const c = makeCanvas(w,h), ctx=c.getContext('2d');
  const grad = ctx.createLinearGradient(0,0,0,h);
  grad.addColorStop(0,'#171034');
  grad.addColorStop(1,'#2b1a4a');
  ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);
  const hues = ['#4b2f77','#5c3a8e','#7a3f8c','#3a2f6b','#8a4fa0'];
  for(let row=0; row<9; row++){
    const y = 30 + row*24 + Math.random()*4;
    const size = 9 - row*0.35;
    for(let x=0; x<w; x+= size*1.15){
      ctx.fillStyle = hues[(Math.random()*hues.length)|0];
      ctx.globalAlpha = 0.55 + Math.random()*0.45;
      ctx.beginPath();
      ctx.arc(x+Math.random()*4, y, size*0.5, 0, Math.PI*2);
      ctx.fill();
    }
  }
  ctx.globalAlpha=1;
  // a few green flag streaks
  for(let i=0;i<26;i++){
    ctx.fillStyle = Math.random()>0.5 ? '#2fae4b' : '#e8e8e8';
    const x = Math.random()*w, y = 40+Math.random()*140;
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate((Math.random()-0.5)*0.5);
    ctx.fillRect(0,0,3,26);
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function skyTexture(){
  const w=512,h=512;
  const c = makeCanvas(w,h), ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0,0,0,h);
  grad.addColorStop(0,'#0a0620');
  grad.addColorStop(0.45,'#1c1240');
  grad.addColorStop(0.75,'#2a1850');
  grad.addColorStop(1,'#150c30');
  ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);
  for(let i=0;i<220;i++){
    ctx.globalAlpha = Math.random()*0.8;
    ctx.fillStyle = '#ffffff';
    const s = Math.random()*1.6;
    ctx.fillRect(Math.random()*w, Math.random()*h*0.6, s, s);
  }
  ctx.globalAlpha=1;
  // light beam glow near top
  const beam = ctx.createRadialGradient(w*0.5,h*0.05,10,w*0.5,h*0.05,w*0.5);
  beam.addColorStop(0,'rgba(255,255,255,0.5)');
  beam.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle = beam; ctx.fillRect(0,0,w,h);
  return new THREE.CanvasTexture(c);
}

function netTexture(){
  const w=256,h=256;
  const c = makeCanvas(w,h), ctx = c.getContext('2d');
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1;
  const step = 12;
  for(let x=0;x<=w;x+=step){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for(let y=0;y<=h;y+=step){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function glowSpriteTexture(){
  const s=128;
  const c = makeCanvas(s,s), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
  g.addColorStop(0,'rgba(255,255,255,0.95)');
  g.addColorStop(0.4,'rgba(255,255,255,0.35)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=g; ctx.fillRect(0,0,s,s);
  return new THREE.CanvasTexture(c);
}

function shadowTexture(){
  const s=128;
  const c = makeCanvas(s,s), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
  g.addColorStop(0,'rgba(0,0,0,0.55)');
  g.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=g; ctx.fillRect(0,0,s,s);
  return new THREE.CanvasTexture(c);
}

function ballTexture(){
  const s=256;
  const c = makeCanvas(s,s), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s*0.35,s*0.3,10,s*0.5,s*0.5,s*0.72);
  g.addColorStop(0,'#ffe6a3');
  g.addColorStop(0.35,'#ff9d4e');
  g.addColorStop(0.7,'#e2453f');
  g.addColorStop(1,'#7d2a6b');
  ctx.fillStyle=g; ctx.fillRect(0,0,s,s);
  ctx.strokeStyle='rgba(15,10,20,0.55)';
  ctx.lineWidth=2.4;
  function pent(cx,cy,r,rot){
    ctx.beginPath();
    for(let i=0;i<5;i++){
      const a = rot + i*(Math.PI*2/5) - Math.PI/2;
      const x = cx+Math.cos(a)*r, y=cy+Math.sin(a)*r;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.closePath(); ctx.stroke();
  }
  pent(s*0.5,s*0.28,26,0.2);
  pent(s*0.26,s*0.52,24,0.9);
  pent(s*0.74,s*0.52,24,2.4);
  pent(s*0.4,s*0.78,22,-0.4);
  pent(s*0.68,s*0.8,20,1.6);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

function numberSpriteTexture(text, ringColor){
  const s=160;
  const c = makeCanvas(s,s), ctx=c.getContext('2d');
  ctx.clearRect(0,0,s,s);
  ctx.beginPath(); ctx.arc(s/2,s/2,s*0.46,0,Math.PI*2);
  ctx.fillStyle = ringColor.fill; ctx.fill();
  ctx.lineWidth = 6; ctx.strokeStyle = ringColor.stroke; ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 64px Arial';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.shadowColor='rgba(0,0,0,0.4)'; ctx.shadowBlur=4;
  ctx.fillText(text, s/2, s/2+4);
  return new THREE.CanvasTexture(c);
}

function confettiTexture(){
  const s=32;
  const c = makeCanvas(s,s), ctx=c.getContext('2d');
  ctx.fillStyle='#ffffff';
  ctx.fillRect(4,4,s-8,s-8);
  return new THREE.CanvasTexture(c);
}

/* ===================== RENDERER / SCENE ===================== */
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x1a1030, 0.012);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth/window.innerHeight, 0.1, 300);

function resize(){
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w,h);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

/* Lights */
const hemi = new THREE.HemisphereLight(0x9aa7ff, 0x1a1030, 0.65);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff2d8, 1.05);
key.position.set(8,16,10);
key.castShadow = true;
key.shadow.mapSize.set(1024,1024);
key.shadow.camera.left=-20; key.shadow.camera.right=20;
key.shadow.camera.top=20; key.shadow.camera.bottom=-20;
key.shadow.camera.far = 60;
key.shadow.bias = -0.002;
scene.add(key);
const rim = new THREE.PointLight(0xbb88ff, 0.7, 60);
rim.position.set(-6,8,-14);
scene.add(rim);

/* Sky */
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(140,24,16),
  new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog:false })
);
scene.add(sky);

/* Crowd cylinder */
const crowd = new THREE.Mesh(
  new THREE.CylinderGeometry(48,48,20,48,1,true),
  new THREE.MeshBasicMaterial({ map: crowdTexture(), side: THREE.BackSide })
);
crowd.position.y = 8;
scene.add(crowd);
crowd.material.map.repeat.set(6,1);

/* Floodlights (visual) */
const glowTex = glowSpriteTexture();
function addFloodlight(x,z){
  const grp = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.2,14,8), new THREE.MeshStandardMaterial({color:0x222222}));
  pole.position.y = 7;
  grp.add(pole);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(3.2,2.2,0.2), new THREE.MeshStandardMaterial({color:0x111111, emissive:0xfff6d0, emissiveIntensity:1.4}));
  panel.position.y = 14.2;
  grp.add(panel);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color:0xfff6d0, transparent:true, opacity:0.9, depthWrite:false, blending: THREE.AdditiveBlending }));
  spr.position.y = 14.2; spr.scale.set(9,7,1);
  grp.add(spr);
  grp.position.set(x,0,z);
  grp.lookAt(0,14,0);
  scene.add(grp);
}
addFloodlight(-16,-24);
addFloodlight(16,-24);
addFloodlight(-16, 10);
addFloodlight(16, 10);

/* Field */
const field = new THREE.Mesh(
  new THREE.PlaneGeometry(60,90),
  new THREE.MeshStandardMaterial({ map: grassTexture(), roughness:0.95 })
);
field.rotation.x = -Math.PI/2;
field.position.z = -20;
field.receiveShadow = true;
scene.add(field);

/* Sponsor board ring (simple 3D strip behind goal) */
function sponsorBoardTexture(){
  const w=1024,h=96;
  const c = makeCanvas(w,h), ctx=c.getContext('2d');
  ctx.fillStyle='#0b0b0b'; ctx.fillRect(0,0,w,h);
  ctx.fillStyle='#f4c400';
  ctx.font='900 44px Arial';
  ctx.textBaseline='middle';
  const items = ['⚽ FOOTBALL','🏆 GAME CUP','⚽ FOOTBALL','🏆 GAME CUP'];
  let x = 20;
  for(let i=0;i<10;i++){
    ctx.fillText(items[i%items.length], x, h/2);
    x += 260;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(2,1);
  return tex;
}
const boardMat = new THREE.MeshBasicMaterial({ map: sponsorBoardTexture() });
const board = new THREE.Mesh(new THREE.PlaneGeometry(30,1.4), boardMat);
board.position.set(0, 0.9, -34.4);
scene.add(board);

/* ===================== GOAL ===================== */
const goalGroup = new THREE.Group();
scene.add(goalGroup);
const postMat = new THREE.MeshStandardMaterial({ color:0xf4f4f4, roughness:0.35, metalness:0.1 });
const capMat = new THREE.MeshStandardMaterial({ color:0xd6352b, roughness:0.4 });
const netMat = new THREE.MeshBasicMaterial({ map: netTexture(), transparent:true, opacity:0.8, side: THREE.DoubleSide, depthWrite:false });

const GW = CFG.goalWidth, GH = CFG.goalHeight, PR = CFG.postRadius;
function buildGoal(){
  const postGeo = new THREE.CylinderGeometry(PR,PR,GH,10);
  const leftPost = new THREE.Mesh(postGeo, postMat);
  leftPost.position.set(-GW/2, GH/2, 0);
  leftPost.castShadow = true;
  goalGroup.add(leftPost);
  const rightPost = leftPost.clone();
  rightPost.position.x = GW/2;
  goalGroup.add(rightPost);

  const barGeo = new THREE.CylinderGeometry(PR,PR,GW+PR*2,10);
  const bar = new THREE.Mesh(barGeo, postMat);
  bar.rotation.z = Math.PI/2;
  bar.position.set(0, GH, 0);
  bar.castShadow = true;
  goalGroup.add(bar);

  // red corner caps
  [[-GW/2,GH],[GW/2,GH]].forEach(([x,y])=>{
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.22,0.22), capMat);
    cap.position.set(x,y,0);
    goalGroup.add(cap);
  });

  const depth = 1.6;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(GW, GH), netMat);
  back.position.set(0, GH/2, -depth);
  goalGroup.add(back);
  const topNet = new THREE.Mesh(new THREE.PlaneGeometry(GW, depth), netMat);
  topNet.rotation.x = Math.PI/2;
  topNet.position.set(0, GH, -depth/2);
  goalGroup.add(topNet);
  const leftNet = new THREE.Mesh(new THREE.PlaneGeometry(depth, GH), netMat);
  leftNet.rotation.y = Math.PI/2;
  leftNet.position.set(-GW/2, GH/2, -depth/2);
  goalGroup.add(leftNet);
  const rightNet = leftNet.clone();
  rightNet.position.x = GW/2;
  goalGroup.add(rightNet);

  // ground goal-line marking
  const line = new THREE.Mesh(new THREE.PlaneGeometry(GW+1.2, 0.08), new THREE.MeshBasicMaterial({color:0xffffff}));
  line.rotation.x = -Math.PI/2;
  line.position.set(0, 0.01, 0.02);
  goalGroup.add(line);
}
buildGoal();

/* ===================== KEEPER ===================== */
const keeperGroup = new THREE.Group();
const kitMat = new THREE.MeshStandardMaterial({ color:0x21c765, roughness:0.7 });
const shortsMat = new THREE.MeshStandardMaterial({ color:0x151515, roughness:0.7 });
const skinMat = new THREE.MeshStandardMaterial({ color:0xd8a374, roughness:0.8 });
const gloveMat = new THREE.MeshStandardMaterial({ color:0x222222, roughness:0.6 });

const kBody = new THREE.Group();
const torsoGeo = (typeof THREE.CapsuleGeometry === 'function')
  ? new THREE.CapsuleGeometry(0.22,0.5,4,8)
  : new THREE.BoxGeometry(0.44,0.7,0.28);
const torso = new THREE.Mesh(torsoGeo, kitMat);
torso.position.y = 1.02;
torso.castShadow = true;
kBody.add(torso);
const head = new THREE.Mesh(new THREE.SphereGeometry(0.16,12,10), skinMat);
head.position.y = 1.5;
head.castShadow = true;
kBody.add(head);
const hips = new THREE.Mesh(new THREE.BoxGeometry(0.36,0.22,0.24), shortsMat);
hips.position.y = 0.68;
kBody.add(hips);

function makeLimb(mat, len, radius){
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius,radius*0.85,len,8), mat);
  m.position.y = -len/2;
  m.castShadow = true;
  g.add(m);
  return g;
}
const leftLeg = makeLimb(shortsMat, 0.62, 0.09); leftLeg.position.set(-0.11,0.62,0);
const rightLeg = makeLimb(shortsMat, 0.62, 0.09); rightLeg.position.set(0.11,0.62,0);
kBody.add(leftLeg, rightLeg);

const leftArmPivot = new THREE.Group(); leftArmPivot.position.set(-0.26,1.28,0);
const leftArm = makeLimb(kitMat,0.5,0.075); leftArm.position.y = 0; leftArmPivot.add(leftArm);
const leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.1,8,8), gloveMat); leftHand.position.y=-0.52; leftArmPivot.add(leftHand);
leftArmPivot.rotation.z = 0.35;

const rightArmPivot = new THREE.Group(); rightArmPivot.position.set(0.26,1.28,0);
const rightArm = makeLimb(kitMat,0.5,0.075); rightArm.position.y = 0; rightArmPivot.add(rightArm);
const rightHand = new THREE.Mesh(new THREE.SphereGeometry(0.1,8,8), gloveMat); rightHand.position.y=-0.52; rightArmPivot.add(rightHand);
rightArmPivot.rotation.z = -0.35;

kBody.add(leftArmPivot, rightArmPivot);
keeperGroup.add(kBody);
scene.add(keeperGroup);

const Keeper = {
  state: 'idle', // idle | reacting | diving | result
  reactionDelay: 0.3,
  diveTarget: new THREE.Vector3(0, 1.0, 0),
  diveDir: 0, // -1 left, 0 center/up, 1 right
  diveDuration: 0.28,
  diveElapsed: 0,
  startPos: new THREE.Vector3(),
  startRot: 0,
  goalZ: 0,
  basePos: new THREE.Vector3(0, 0, 0.35),
  time: 0,
  bobT: 0,

  reset(goalZ){
    this.state = 'idle';
    this.time = 0;
    this.goalZ = goalZ;
    this.basePos.set(0, 0, goalZ + 0.42);
    keeperGroup.position.copy(this.basePos);
    keeperGroup.rotation.set(0,0,0);
    kBody.rotation.set(0,0,0);
    leftArmPivot.rotation.set(0,0,0.35);
    rightArmPivot.rotation.set(0,0,-0.35);
  },

  armForShot(reactionDelay){
    this.state = 'idle';
    this.reactionDelay = reactionDelay;
    this.time = 0;
  },

  decide(predX, predY){
    const rx = clamp(predX, -CFG.keeperMaxReachX, CFG.keeperMaxReachX);
    const ry = clamp(predY, 0.15, CFG.keeperMaxReachY);
    this.diveTarget.set(rx, ry, this.goalZ + 0.55);
    this.diveDir = predX < -0.5 ? -1 : (predX > 0.5 ? 1 : 0);
    const dist = Math.abs(rx) + Math.abs(ry-1.0)*0.6;
    this.diveDuration = clamp(0.22 + dist*0.045, 0.22, 0.42);
    this.diveElapsed = 0;
    this.startPos.copy(keeperGroup.position);
    this.state = 'diving';
  },

  update(dt){
    this.time += dt;
    this.bobT += dt;
    if(this.state==='idle'){
      keeperGroup.position.y = Math.sin(this.bobT*2.2)*0.02;
      leftArmPivot.rotation.z = 0.35 + Math.sin(this.bobT*1.6)*0.05;
      rightArmPivot.rotation.z = -0.35 - Math.sin(this.bobT*1.6)*0.05;
    } else if(this.state==='diving'){
      this.diveElapsed += dt;
      const t = clamp(this.diveElapsed/this.diveDuration, 0, 1);
      const e = easeOutQuad(t);
      keeperGroup.position.x = lerp(this.startPos.x, this.diveTarget.x, e);
      keeperGroup.position.y = lerp(this.startPos.y, Math.max(0,this.diveTarget.y-1.0), e);
      keeperGroup.position.z = this.basePos.z;
      const lean = this.diveDir * e * 1.15;
      keeperGroup.rotation.z = -lean;
      kBody.rotation.x = e * 0.3 * (this.diveDir===0?1:0.4);
      const armSwing = this.diveDir * e * 1.5;
      leftArmPivot.rotation.z = 0.35 - armSwing*0.9 - e*0.8;
      rightArmPivot.rotation.z = -0.35 - armSwing*0.9 - e*0.8;
      if(t>=1) this.state = 'result';
    }
  },

  handPositionWorld(out){
    // approx position of gloves in world space
    const t = this.state==='diving' ? clamp(this.diveElapsed/this.diveDuration,0,1) : 0;
    const reachY = lerp(1.35, this.diveTarget.y + 0.15, easeOutQuad(t));
    out.set(keeperGroup.position.x + (this.state!=='idle'? this.diveDir*0.35*t : 0), reachY, this.goalZ + 0.35);
    return out;
  }
};
Keeper.reset(-20);

/* ===================== BALL ===================== */
const ballGeo = new THREE.SphereGeometry(CFG.ballRadius, 24, 18);
const ballMat = new THREE.MeshStandardMaterial({ map: ballTexture(), roughness:0.5, metalness:0.05 });
const ballMesh = new THREE.Mesh(ballGeo, ballMat);
ballMesh.castShadow = true;
scene.add(ballMesh);

const ballShadow = new THREE.Mesh(new THREE.PlaneGeometry(0.5,0.5), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent:true, depthWrite:false }));
ballShadow.rotation.x = -Math.PI/2;
scene.add(ballShadow);

const teeRing = new THREE.Mesh(new THREE.RingGeometry(0.16,0.21,24), new THREE.MeshBasicMaterial({ color:0xffe94e, transparent:true, opacity:0.85, side:THREE.DoubleSide }));
teeRing.rotation.x = -Math.PI/2;
scene.add(teeRing);
const teeGlow = new THREE.Mesh(new THREE.CircleGeometry(0.32,24), new THREE.MeshBasicMaterial({ color:0xffe94e, transparent:true, opacity:0.18, side:THREE.DoubleSide }));
teeGlow.rotation.x = -Math.PI/2;
teeGlow.position.y = 0.001;
scene.add(teeGlow);

/* ===================== TARGET CIRCLES ===================== */
const TIER_STYLES = [
  { max:35, fill:'rgba(40,170,90,0.85)', stroke:'#eafff1', color:0x28aa5a },
  { max:65, fill:'rgba(40,120,220,0.85)', stroke:'#eaf3ff', color:0x2878dc },
  { max:999,fill:'rgba(220,60,50,0.9)',  stroke:'#fff0ea', color:0xdc3c32 },
];
function tierFor(v){ return TIER_STYLES.find(t=>v<=t.max) || TIER_STYLES[2]; }

const targets = [];
function makeTarget(value, x, y){
  const tier = tierFor(value);
  const tex = numberSpriteTexture(String(value), tier);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent:true, depthWrite:false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(0.62,0.62,1);
  spr.position.set(x,y,-0.05);
  goalGroup.add(spr);
  const obj = { value, x, y, sprite:spr, alive:true, bob: Math.random()*10, radius:0.34 };
  targets.push(obj);
  return obj;
}
function clearTargets(){
  targets.forEach(t=> goalGroup.remove(t.sprite));
  targets.length = 0;
}
function spawnTargets(level){
  clearTargets();
  const count = 2 + (level>=3?1:0) + (level>=6?1:0);
  const values = [25,50,80,90,60,35,70];
  const usedPos = [];
  for(let i=0;i<count;i++){
    let x,y,tries=0;
    do {
      x = randRange(-GW/2+0.7, GW/2-0.7);
      y = randRange(0.7, GH-0.35);
      tries++;
    } while(usedPos.some(p=>Math.hypot(p.x-x,p.y-y)<0.9) && tries<20);
    usedPos.push({x,y});
    const v = values[(Math.random()*values.length)|0];
    makeTarget(v, x, y);
  }
}

/* ===================== AIM PREVIEW ===================== */
const previewMat = new THREE.LineBasicMaterial({ color:0xffe94e, transparent:true, opacity:0.85, linewidth:2 });
const previewGeo = new THREE.BufferGeometry();
const PREVIEW_POINTS = 40;
previewGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PREVIEW_POINTS*3), 3));
const previewLine = new THREE.Line(previewGeo, previewMat);
previewLine.visible = false;
scene.add(previewLine);

const reticle = new THREE.Mesh(new THREE.RingGeometry(0.12,0.17,20), new THREE.MeshBasicMaterial({ color:0xffffff, transparent:true, opacity:0.9, side:THREE.DoubleSide }));
reticle.visible = false;
scene.add(reticle);

/* ===================== CONFETTI ===================== */
const confettiColors = [0xffe94e, 0x4ee44e, 0x4ea0ff, 0xff5c8a, 0xff9d3d];
const confettiPool = [];
const CONFETTI_MAX = 90;
const confettiGeo = new THREE.PlaneGeometry(0.09,0.14);
for(let i=0;i<CONFETTI_MAX;i++){
  const mat = new THREE.MeshBasicMaterial({ color: confettiColors[i%confettiColors.length], side:THREE.DoubleSide, transparent:true });
  const m = new THREE.Mesh(confettiGeo, mat);
  m.visible = false;
  scene.add(m);
  confettiPool.push({ mesh:m, vel:new THREE.Vector3(), rotVel:0, life:0, maxLife:1 });
}
function burstConfetti(origin){
  let n=0;
  for(const p of confettiPool){
    if(p.life>0) continue;
    p.mesh.visible = true;
    p.mesh.position.set(origin.x + randRange(-1.2,1.2), origin.y + randRange(-0.2,0.6), origin.z + randRange(-0.4,0.4));
    p.vel.set(randRange(-2.2,2.2), randRange(3.5,6.5), randRange(-1,1));
    p.rotVel = randRange(-8,8);
    p.mesh.rotation.set(Math.random()*6,Math.random()*6,Math.random()*6);
    p.life = p.maxLife = randRange(1.1,1.9);
    n++;
    if(n>=46) break;
  }
}
function updateConfetti(dt){
  for(const p of confettiPool){
    if(p.life<=0){ if(p.mesh.visible) p.mesh.visible=false; continue; }
    p.life -= dt;
    p.vel.y -= 4.5*dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.mesh.rotation.x += p.rotVel*dt;
    p.mesh.rotation.y += p.rotVel*0.7*dt;
    p.mesh.material.opacity = clamp(p.life/p.maxLife, 0, 1);
    if(p.life<=0) p.mesh.visible = false;
  }
}

/* ===================== SAVE PARTICLES (simple parry puff) ===================== */
function burstPuff(origin){
  for(let i=0;i<14;i++){
    const p = confettiPool.find(c=>c.life<=0);
    if(!p) break;
    p.mesh.visible = true;
    p.mesh.material.color.set(0xffffff);
    p.mesh.position.copy(origin);
    const a = Math.random()*Math.PI*2;
    p.vel.set(Math.cos(a)*randRange(1.5,3.5), randRange(0.5,3), Math.sin(a)*randRange(1.5,3.5));
    p.rotVel = randRange(-6,6);
    p.life = p.maxLife = randRange(0.4,0.7);
  }
}

/* ===================== GAME STATE ===================== */
const HUD = {
  scoreVal: document.getElementById('scoreVal'),
  scorePopup: document.getElementById('scorePopup'),
  levelVal: document.getElementById('levelVal'),
  livesIcons: document.getElementById('livesIcons'),
  distBox: document.getElementById('distBox'),
  centerBanner: document.getElementById('centerBanner'),
  subBanner: document.getElementById('subBanner'),
  powerWrap: document.getElementById('powerWrap'),
  powerFill: document.getElementById('powerFill'),
  curveIndicator: document.getElementById('curveIndicator'),
  hint: document.getElementById('hint'),
};

const Game = {
  score: 0,
  best: parseInt(localStorage.getItem('fks_best')||'0',10),
  level: 1,
  lives: CFG.livesStart,
  goalsThisLevel: 0,
  state: 'intro', // intro|aiming|dragging|flight|result|gameover|paused
  presetIdx: 0,
  distance: PRESETS[0].dist,
  lateral: PRESETS[0].lateral,
  goalZ: -PRESETS[0].dist,
  ballStart: new THREE.Vector3(0, CFG.ballRadius, 0),
  paused: false,
};

function buildLivesUI(){
  HUD.livesIcons.innerHTML = '';
  for(let i=0;i<CFG.livesStart;i++){
    const el = document.createElement('div');
    el.className = 'lifeIcon';
    el.innerHTML = '<div class="ball"></div><div class="x">✕</div>';
    HUD.livesIcons.appendChild(el);
  }
}
function updateLivesUI(){
  const icons = HUD.livesIcons.children;
  const lost = CFG.livesStart - Game.lives;
  for(let i=0;i<icons.length;i++){
    icons[i].classList.toggle('lost', i < lost);
  }
}
buildLivesUI();

function setDistanceHud(){
  const preset = PRESETS[Game.presetIdx];
  HUD.distBox.textContent = preset.label;
}

function updateScoreHud(delta){
  HUD.scoreVal.textContent = Game.score;
  HUD.levelVal.textContent = Game.level;
  if(delta){
    HUD.scorePopup.textContent = '+'+delta;
    HUD.scorePopup.classList.remove('show');
    void HUD.scorePopup.offsetWidth;
    HUD.scorePopup.classList.add('show');
  }
}

function showBanner(text, cls, sub){
  HUD.centerBanner.textContent = text;
  HUD.centerBanner.className = cls;
  void HUD.centerBanner.offsetWidth;
  HUD.centerBanner.classList.add('show');
  HUD.subBanner.textContent = sub||'';
  HUD.subBanner.className = '';
  void HUD.subBanner.offsetWidth;
  HUD.subBanner.classList.add('show');
}

/* Positions the goal / ball for the current preset */
function applyPreset(idx, keepAttempt){
  Game.presetIdx = idx;
  const p = PRESETS[idx];
  Game.distance = p.dist;
  Game.lateral = p.lateral;
  Game.goalZ = -p.dist;
  goalGroup.position.set(0, 0, Game.goalZ);
  Keeper.reset(Game.goalZ);
  Game.ballStart.set(p.lateral, CFG.ballRadius, 0);
  setDistanceHud();
  resetForAiming();
}

/* Camera follows behind the ball, looking at goal center */
const camOffset = new THREE.Vector3();
function placeCamera(instant){
  const toGoal = new THREE.Vector3(0-Game.ballStart.x, 0, Game.goalZ-Game.ballStart.z).normalize();
  const back = toGoal.clone().multiplyScalar(-2.6);
  const target = new THREE.Vector3(Game.ballStart.x + back.x, 1.55, Game.ballStart.z + back.z + 0.4);
  if(instant){ camera.position.copy(target); }
  else camera.position.lerp(target, 0.15);
  const lookAt = new THREE.Vector3(Game.ballStart.x*0.3, 1.0, Game.goalZ + 0.5);
  camera.lookAt(lookAt);
}

/* ===================== BALL FLIGHT STATE ===================== */
const Flight = {
  active: false,
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  spinY: 0,
  time: 0,
  powerNorm: 0,
  scoredTargetBonus: 0,
  saved: false,
  resolved: false,
};

function resetForAiming(){
  Flight.active = false;
  Keeper.reset(Game.goalZ);
  spawnTargets(Game.level);
  ballMesh.position.copy(Game.ballStart);
  ballMesh.rotation.set(0,0,0);
  teeRing.position.set(Game.ballStart.x, 0.015, Game.ballStart.z);
  teeGlow.position.set(Game.ballStart.x, 0.005, Game.ballStart.z);
  previewLine.visible = false;
  reticle.visible = false;
  HUD.powerWrap.classList.remove('show');
  HUD.curveIndicator.classList.remove('show');
  HUD.hint.style.opacity = 1;
  Game.state = 'aiming';
  placeCamera(true);
}

function launchShot(dragDX, dragDY, dragLen){
  const range = CFG.dragPixelRange;
  const powerNorm = clamp(dragLen/range, 0.12, 1);
  const aimNorm = clamp(dragDX/range, -1, 1);
  const loftNorm = clamp(dragDY/range, 0, 1);

  const speed = lerp(CFG.speedMin, CFG.speedMax, powerNorm);
  const elevation = deg2rad(lerp(CFG.loftMinDeg, CFG.loftMaxDeg, loftNorm));
  const aimAngle = deg2rad(aimNorm * CFG.aimMaxDeg);
  const spinY = aimNorm * CFG.spinMax;

  const baseDir = new THREE.Vector3(0-Game.ballStart.x, 0, Game.goalZ-Game.ballStart.z).normalize();
  const rotated = baseDir.clone().applyAxisAngle(new THREE.Vector3(0,1,0), aimAngle);

  const vel = new THREE.Vector3(
    rotated.x*Math.cos(elevation)*speed,
    Math.sin(elevation)*speed,
    rotated.z*Math.cos(elevation)*speed
  );

  Flight.active = true;
  Flight.pos.copy(Game.ballStart);
  Flight.vel.copy(vel);
  Flight.spinY = spinY;
  Flight.time = 0;
  Flight.powerNorm = powerNorm;
  Flight.scoredTargetBonus = 0;
  Flight.saved = false;
  Flight.resolved = false;

  const reactionDelay = clamp(
    CFG.reactionBase - powerNorm*CFG.reactionPowerFactor - Game.level*CFG.reactionLevelFactor,
    CFG.reactionMin, CFG.reactionBase
  );
  Keeper.armForShot(reactionDelay);

  previewLine.visible = false;
  reticle.visible = false;
  HUD.powerWrap.classList.remove('show');
  HUD.curveIndicator.classList.remove('show');
  HUD.hint.style.opacity = 0;
  Game.state = 'flight';
}

/* Naive (no-curve) predicted crossing point at the goal plane — this is what the keeper "sees". */
const _predPos = new THREE.Vector3(), _predVel = new THREE.Vector3();
function predictNaiveCrossing(pos, vel, goalZ){
  _predPos.copy(pos); _predVel.copy(vel);
  let t=0;
  const dt=0.02;
  while(_predPos.z > goalZ && t<3){
    _predVel.y -= CFG.gravity*dt;
    _predPos.addScaledVector(_predVel, dt);
    t+=dt;
  }
  return { x:_predPos.x, y:Math.max(0.1,_predPos.y) };
}

/* Fast preview simulate for the drag arc (uses full physics incl. curve) */
function simulatePreview(dragDX, dragDY, dragLen, outPoints){
  const range = CFG.dragPixelRange;
  const powerNorm = clamp(dragLen/range, 0.12, 1);
  const aimNorm = clamp(dragDX/range, -1, 1);
  const loftNorm = clamp(dragDY/range, 0, 1);
  const speed = lerp(CFG.speedMin, CFG.speedMax, powerNorm);
  const elevation = deg2rad(lerp(CFG.loftMinDeg, CFG.loftMaxDeg, loftNorm));
  const aimAngle = deg2rad(aimNorm * CFG.aimMaxDeg);
  const spinY = aimNorm * CFG.spinMax;
  const baseDir = new THREE.Vector3(0-Game.ballStart.x, 0, Game.goalZ-Game.ballStart.z).normalize();
  const rotated = baseDir.clone().applyAxisAngle(new THREE.Vector3(0,1,0), aimAngle);
  const pos = Game.ballStart.clone();
  const vel = new THREE.Vector3(rotated.x*Math.cos(elevation)*speed, Math.sin(elevation)*speed, rotated.z*Math.cos(elevation)*speed);
  const dt = 0.035;
  let n=0;
  let landing = null;
  for(let i=0;i<PREVIEW_POINTS;i++){
    stepBallState(pos, vel, spinY, dt);
    outPoints[n*3]=pos.x; outPoints[n*3+1]=Math.max(pos.y,0.02); outPoints[n*3+2]=pos.z;
    n++;
    if(landing===null && pos.z <= Game.goalZ) landing = {x:pos.x, y:Math.max(pos.y,0.05)};
    if(pos.y < 0 && pos.z > Game.goalZ){ break; }
  }
  return { count:n, landing };
}

/* ===================== INPUT ===================== */
let dragging = false;
let dragStart = {x:0,y:0};
let dragCur = {x:0,y:0};

function pointerDown(e){
  if(Game.state !== 'aiming') return;
  dragging = true;
  const p = getPointer(e);
  dragStart.x = p.x; dragStart.y = p.y;
  dragCur.x = p.x; dragCur.y = p.y;
  Game.state = 'dragging';
  previewLine.visible = true;
  reticle.visible = true;
  HUD.powerWrap.classList.add('show');
  HUD.curveIndicator.classList.add('show');
  HUD.hint.style.opacity = 0;
  updateDragVisuals();
}
function pointerMove(e){
  if(!dragging) return;
  const p = getPointer(e);
  dragCur.x = p.x; dragCur.y = p.y;
  updateDragVisuals();
}
function pointerUp(e){
  if(!dragging) return;
  dragging = false;
  const dx = dragCur.x - dragStart.x;
  const dy = dragStart.y - dragCur.y; // screen y inverted: dragging UP => positive
  const len = Math.hypot(dx,dy);
  if(len < 18){
    // too small a drag — cancel, back to aiming
    Game.state = 'aiming';
    previewLine.visible = false;
    reticle.visible = false;
    HUD.powerWrap.classList.remove('show');
    HUD.curveIndicator.classList.remove('show');
    HUD.hint.style.opacity = 1;
    return;
  }
  launchShot(dx, dy, len);
}
function getPointer(e){
  const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
  return { x:t.clientX, y:t.clientY };
}
canvas.addEventListener('pointerdown', pointerDown);
window.addEventListener('pointermove', pointerMove);
window.addEventListener('pointerup', pointerUp);
window.addEventListener('pointercancel', pointerUp);

const previewPosArr = previewGeo.attributes.position.array;
function updateDragVisuals(){
  const dx = dragCur.x - dragStart.x;
  const dy = dragStart.y - dragCur.y;
  const len = Math.hypot(dx,dy);
  const range = CFG.dragPixelRange;
  const powerNorm = clamp(len/range, 0, 1);
  HUD.powerFill.style.height = (powerNorm*100).toFixed(0)+'%';
  const aimNorm = clamp(dx/range,-1,1);
  const curveMag = Math.abs(aimNorm);
  HUD.curveIndicator.textContent = curveMag<0.08 ? 'STRAIGHT SHOT' : (aimNorm>0 ? 'CURL BACK ◄ (aim ►)' : 'CURL BACK ► (aim ◄)');

  const res = simulatePreview(dx, dy, len, previewPosArr);
  previewGeo.attributes.position.needsUpdate = true;
  previewGeo.setDrawRange(0, res.count);
  if(res.landing){
    reticle.visible = true;
    reticle.position.set(clamp(res.landing.x,-GW/2-1,GW/2+1), Math.min(res.landing.y, GH+1), Game.goalZ+0.03);
  } else {
    reticle.visible = false;
  }
}

/* ===================== COLLISION / RESOLUTION ===================== */
function onTargetGoal(x,y){
  for(const t of targets){
    if(!t.alive) continue;
    if(Math.hypot(t.x-x, t.y-y) <= t.radius) return t;
  }
  return null;
}

function resolveShot(kind, opts){
  opts = opts || {};
  Flight.resolved = true;
  Flight.active = false;
  Game.state = 'result';

  if(kind === 'goal'){
    const bonus = opts.bonus || 0;
    const total = CFG.goalBasePoints + bonus;
    Game.score += total;
    if(Game.score > Game.best){ Game.best = Game.score; localStorage.setItem('fks_best', String(Game.best)); }
    Game.goalsThisLevel++;
    updateScoreHud(total);
    showBanner('GOAL!!!', 'goal', bonus? ('TARGET HIT +'+bonus) : 'NICE STRIKE');
    burstConfetti(new THREE.Vector3(opts.x||0, opts.y||1, Game.goalZ));
    if(Game.goalsThisLevel >= CFG.levelUpEvery){
      Game.goalsThisLevel = 0;
      Game.level++;
      spawnTargets(Game.level);
    }
  } else if(kind === 'save'){
    Game.lives--;
    updateLivesUI();
    showBanner('SAVED!', 'save', 'KEEPER DENIES YOU');
    burstPuff(opts.pos || new THREE.Vector3(0,1,Game.goalZ));
  } else {
    Game.lives--;
    updateLivesUI();
    showBanner(opts.text || 'MISS', 'miss', opts.sub || '');
  }

  setTimeout(()=>{
    if(Game.lives <= 0){
      endGame();
    } else {
      resetForAiming();
    }
  }, 1500);
}

function endGame(){
  Game.state = 'gameover';
  document.getElementById('finalScore').textContent = Game.score;
  document.getElementById('finalLevel').textContent = Game.level;
  document.getElementById('finalBest').textContent = Game.best;
  document.getElementById('gameOverOverlay').classList.add('show');
}

/* ===================== MAIN LOOP ===================== */
const clock = new THREE.Clock();
const SUBSTEP = 1/180;

function updateFlight(dt){
  if(!Flight.active) return;
  Flight.time += dt;
  let remaining = dt;
  while(remaining > 0){
    const step = Math.min(SUBSTEP, remaining);
    stepBallState(Flight.pos, Flight.vel, Flight.spinY, step);
    remaining -= step;

    // keeper reaction trigger
    if(Keeper.state === 'idle' && Flight.time >= Keeper.reactionDelay){
      const pred = predictNaiveCrossing(Flight.pos, Flight.vel, Game.goalZ);
      const err = CFG.keeperErrorBase * (1 - Game.level*0.04);
      const nx = pred.x + randRange(-err, err);
      const ny = pred.y + randRange(-err*0.6, err*0.6);
      Keeper.decide(nx, ny);
    }

    // ground collision before reaching goal -> miss
    if(Flight.pos.y <= CFG.ballRadius*0.6 && Flight.pos.z > Game.goalZ + 0.1){
      resolveShot('miss', { text:'MISS', sub:'INTO THE GROUND' });
      return;
    }

    // post / bar collision (only near the goal plane)
    if(Flight.pos.z <= Game.goalZ + 0.35 && Flight.pos.z >= Game.goalZ - 0.35){
      const postHitR = PR + CFG.ballRadius + 0.04;
      const dLeftPost = Math.abs(Flight.pos.x - (-GW/2));
      const dRightPost = Math.abs(Flight.pos.x - (GW/2));
      const nearPost = (dLeftPost < postHitR || dRightPost < postHitR) && Flight.pos.y < GH + 0.05;
      const nearBar = Math.abs(Flight.pos.y - GH) < postHitR && Math.abs(Flight.pos.x) < GW/2 + 0.15;
      if(nearPost){
        resolveShot('miss', { text:'OFF THE POST!', sub:'SO CLOSE' });
        return;
      }
      if(nearBar){
        resolveShot('miss', { text:'OFF THE BAR!', sub:'SO CLOSE' });
        return;
      }
    }

    // keeper save check once in dive/result state and ball near goal line
    if(Flight.pos.z <= Game.goalZ + 0.7 && Flight.pos.z >= Game.goalZ - 0.15){
      const hp = Keeper.handPositionWorld(new THREE.Vector3());
      const d = Flight.pos.distanceTo(hp);
      const bodyD = Math.hypot(Flight.pos.x-keeperGroup.position.x, Flight.pos.y-(keeperGroup.position.y+0.9));
      if((d < CFG.saveRadius || bodyD < CFG.saveRadius*0.9) && Keeper.state !== 'idle'){
        Keeper.state = 'result';
        resolveShot('save', { pos: Flight.pos.clone() });
        return;
      }
    }

    // crossing the goal plane
    if(Flight.pos.z <= Game.goalZ){
      const withinX = Math.abs(Flight.pos.x) <= GW/2 - 0.05;
      const withinY = Flight.pos.y >= 0.02 && Flight.pos.y <= GH - 0.02;
      if(withinX && withinY){
        const hit = onTargetGoal(Flight.pos.x, Flight.pos.y);
        if(hit){ hit.alive = false; hit.sprite.visible = false; }
        resolveShot('goal', { bonus: hit? hit.value : 0, x:Flight.pos.x, y:Flight.pos.y });
      } else {
        resolveShot('miss', { text:'MISS', sub: withinX? 'OVER THE BAR' : 'WIDE OF THE POST' });
      }
      return;
    }

    if(Flight.time > CFG.flightTimeout){
      resolveShot('miss', { text:'MISS', sub:'TIMED OUT' });
      return;
    }
  }
}

function updateBallVisual(){
  if(Flight.active){
    ballMesh.position.copy(Flight.pos);
    ballShadow.position.set(Flight.pos.x, 0.02, Flight.pos.z);
    const sc = clamp(1 - Flight.pos.y*0.18, 0.25, 1);
    ballShadow.scale.set(sc,sc,1);
    ballShadow.material.opacity = sc;
    const spd = Flight.vel.length();
    const axis = new THREE.Vector3(-Flight.vel.z, 0, Flight.vel.x).normalize();
    if(axis.lengthSq()>0.0001) ballMesh.rotateOnWorldAxis(axis, spd*SUBSTEP*3.2);
    ballMesh.rotateY(Flight.spinY*SUBSTEP*2);
  } else if(Game.state==='aiming' || Game.state==='dragging'){
    ballMesh.position.copy(Game.ballStart);
    ballShadow.position.set(Game.ballStart.x, 0.02, Game.ballStart.z);
    ballShadow.scale.set(1,1,1);
    ballShadow.material.opacity = 0.55;
  }
}

function updateTargets(dt){
  for(const t of targets){
    if(!t.alive) continue;
    t.bob += dt;
    t.sprite.position.y = t.y + Math.sin(t.bob*1.6)*0.06;
  }
}

function updateTeePulse(t){
  const s = 1 + Math.sin(t*3)*0.08;
  teeRing.scale.set(s,s,1);
}

let lastT = 0;
function animate(t){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.033);
  if(Game.paused){ renderer.render(scene, camera); return; }

  updateConfetti(dt);
  updateTargets(dt);
  Keeper.update(dt);
  if(Game.state==='flight') updateFlight(dt);
  updateBallVisual();
  if(Game.state==='aiming') updateTeePulse(performance.now()/1000);
  placeCamera(Game.state==='flight');

  reticle.rotation.z += dt*1.2;

  renderer.render(scene, camera);
}

/* ===================== UI WIRING ===================== */
document.getElementById('btnStart').addEventListener('click', ()=>{
  document.getElementById('startOverlay').classList.remove('show');
  applyPreset(0);
});
document.getElementById('btnRetry').addEventListener('click', ()=>{
  document.getElementById('gameOverOverlay').classList.remove('show');
  Game.score = 0; Game.level = 1; Game.lives = CFG.livesStart; Game.goalsThisLevel = 0;
  updateLivesUI(); updateScoreHud(0);
  applyPreset(Game.presetIdx);
});
document.getElementById('btnPause').addEventListener('click', ()=>{
  Game.paused = true;
  document.getElementById('pauseOverlay').classList.add('show');
});
document.getElementById('btnResume').addEventListener('click', ()=>{
  Game.paused = false;
  document.getElementById('pauseOverlay').classList.remove('show');
});
let muted = false;
document.getElementById('btnMute').addEventListener('click', (e)=>{
  muted = !muted;
  e.target.textContent = muted ? '🔇' : '🔊';
});
const presetBtn = document.getElementById('btnPreset');
const presetMenu = document.getElementById('presetMenu');
presetBtn.addEventListener('click', ()=> presetMenu.classList.toggle('open'));
presetMenu.querySelectorAll('button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const idx = parseInt(btn.dataset.preset,10);
    presetMenu.classList.remove('open');
    if(Game.state==='intro') return;
    applyPreset(idx);
  });
});

/* sponsor marquee content */
(function buildSponsor(){
  const track = document.getElementById('sponsorTrack');
  const items = ['⚽ FOOTBALL','🏆 GAME CUP','⚽ FOOTBALL','🏆 GAME CUP','⚽ FOOTBALL','🏆 GAME CUP'];
  let html = '';
  for(let i=0;i<2;i++){
    items.forEach(it=>{ html += `<div class="sp-item"><span class="w">${it}</span></div>`; });
  }
  track.innerHTML = html;
})();

resize();
placeCamera(true);
requestAnimationFrame(animate);

window.__FKS_DEBUG = {
  state: ()=> Game.state,
  game: ()=> Game,
  flight: ()=> Flight,
  keeper: ()=> Keeper,
  reticle: ()=> ({ x: reticle.position.x, y: reticle.position.y, visible: reticle.visible }),
};

})();
