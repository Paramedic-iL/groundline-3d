import * as T from './three.module.js';
import {INITIAL,LOCATIONS,coordinates,convert,fromXML,blocked,standHeight,ceilingAt,STEP_UP,PLAYER_STAND,PLAYER_CROUCH,inside} from './map-model.js?v=ground-v3';
import {FLAT,loadTerrain} from './terrain.js';
import {createWorld,person,disposeWorld} from './world.js?v=ground-v3';
import {facingMovement,lookVector,clampPitch} from './controls.js';
import {SatelliteMap,loadSatelliteCoverage,coverageFromPhoto,drapePhotoOnCoverage,GROUND_METERS} from './satellite.js';
import {analyzeImage,mergePhotoFeatures,mapFromPhoto,parseScale,photoSpanMeters,alignPhotoToCoverage} from './photo-stage.js';
import {loadCharacters,realisticPerson} from './characters.js';
import {createWeapon,alignWeapon} from './weapons.js';
const $=id=>document.getElementById(id),TAU=Math.PI*2;
const SPAWN_ENEMIES=false;
let renderer;
try{renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});}catch(e){$('fatal').hidden=false;throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;renderer.autoClear=false;$('viewport').appendChild(renderer.domElement);
const overhead=new T.OrthographicCamera(-40,40,40,-40,.1,600);overhead.up.set(0,0,-1);overhead.layers.enable(1);const HIP_FOV=70,ADS_ZOOM=3,firstPerson=new T.PerspectiveCamera(HIP_FOV,1,.025,450);firstPerson.layers.enable(2);const ray=new T.Raycaster(),aimRay=new T.Raycaster();const keys=new Set();
let viewMode='3d',assist=true,weaponModel=null,recoil=0,avatars=[],lookDrag=false,mapLeft=false,mapRight=false,showHelp=false,ads=0,adsWant=false,phonePreview=false;
const satellite=new SatelliteMap($('satellite-canvas'),$('satellite-status'));
const characterPromise=loadCharacters().then(ok=>{if(!ok)notify('Detailed character model unavailable — using fallback figures.');return ok;});
let W,map,pending=null,enemies=[],tracers=[],playerMesh,playerSprite,playerRing,atlasImage,textures=[],paused=true,ended=false,loading=false,requestId=0,soundOn=true,audioCtx,clock=0,last=performance.now(),noticeTimer,boundaryTimer=0,cache=new Map(),selectedTarget=null,visCache=new Map();
const player={x:0,z:0,y:0,vy:0,angle:0,pitch:0,hp:100,weapon:0,reload:0,cooldown:0,shooting:false,steps:0,grounded:true,crouch:false,running:false,jumpQueued:false};
const weapons=[{name:'AR-15',mag:30,capacity:30,reserve:150,damage:38,delay:.14,reload:1.7},{name:'Glock 17',mag:17,capacity:17,reserve:85,damage:29,delay:.27,reload:1.25}];
const stick={x:0,z:0,aimX:0,aimZ:0};let mouse={x:0,y:0,active:false};let width=innerWidth,height=innerHeight,half=42,fpRect;
function notify(message){$('notification').textContent=message;$('notification').classList.add('show');clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notification').classList.remove('show'),2600);}
function status(message,error=false){$('map-status').textContent=message;$('map-status').classList.toggle('error',error);}
function tone(frequency,duration=.08,volume=.08,type='triangle'){if(!soundOn)return;try{audioCtx??=new (window.AudioContext||window.webkitAudioContext)();audioCtx.resume();const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=type;o.frequency.setValueAtTime(frequency,audioCtx.currentTime);o.frequency.exponentialRampToValueAtTime(Math.max(25,frequency*.3),audioCtx.currentTime+duration);g.gain.setValueAtTime(volume,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+duration);o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+duration);}catch{}}
function unlockAudio(){if(!soundOn)return;try{audioCtx??=new (window.AudioContext||window.webkitAudioContext)();audioCtx.resume();}catch{}}
function gunSound(){if(!soundOn)return;try{audioCtx??=new (window.AudioContext||window.webkitAudioContext)();audioCtx.resume();const len=Math.floor(audioCtx.sampleRate*.12),buf=audioCtx.createBuffer(1,len,audioCtx.sampleRate),data=buf.getChannelData(0);for(let i=0;i<len;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/len,3);const source=audioCtx.createBufferSource(),gain=audioCtx.createGain(),filter=audioCtx.createBiquadFilter();source.buffer=buf;filter.type='lowpass';filter.frequency.value=player.weapon?1700:2600;gain.gain.value=.12;source.connect(filter);filter.connect(gain);gain.connect(audioCtx.destination);source.start();}catch{}}
function visible(a,b){
 const key=`${a.x>>0},${a.z>>0},${b.x>>0},${b.z>>0}`;
 const cached=visCache.get(key);if(cached&&clock-cached.t<.14)return cached.v;
 const delta=b.clone().sub(a),distance=delta.length();ray.set(a,delta.normalize());ray.far=distance-.25;
 const v=ray.intersectObjects(W.walls,false).length===0;
 visCache.set(key,{t:clock,v});if(visCache.size>120)visCache.clear();
 return v;
}
function clearInput(){keys.clear();player.shooting=false;lookDrag=false;stick.x=stick.z=stick.aimX=stick.aimZ=0;document.querySelectorAll('.stick-knob').forEach(n=>n.style.transform='');mouse.active=false;}
function attachSprite(group,texture,size=2.8){const m=new T.Mesh(new T.PlaneGeometry(size,size*700/627),new T.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.08,depthWrite:false,depthTest:false}));m.rotation.x=-Math.PI/2;m.position.y=2.2;m.layers.set(1);m.renderOrder=5;group.add(m);return m;}
const atlasPromise=new Promise(resolve=>{const img=new Image();img.onload=()=>{atlasImage=img;for(let i=0;i<2;i++){const c=document.createElement('canvas');c.width=627;c.height=700;c.getContext('2d').drawImage(img,i*627,0,627,700,0,0,627,700);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;textures.push(t);}drawWeapon();resolve(true);};img.onerror=()=>{notify('Character artwork could not load. Using 3D figures.');resolve(false);};img.src='./sprites.png';});
function drawWeapon(){if(weaponModel){firstPerson.remove(weaponModel);weaponModel.traverse(o=>o.geometry?.dispose());}weaponModel=createWeapon(player.weapon===1);firstPerson.add(weaponModel);alignWeapon(weaponModel,50,0,player.weapon===1);applyAdsVisual();}
function canAds(){return viewMode==='3d'&&player.weapon===0;}
function applyAdsVisual(){
 const fov=HIP_FOV/(1+ads*(ADS_ZOOM-1));
 if(Math.abs(firstPerson.fov-fov)>.01){firstPerson.fov=fov;firstPerson.updateProjectionMatrix();}
 if(weaponModel)weaponModel.visible=ads<.45;
 const overlay=$('scope-overlay');
 overlay.hidden=ads<.05;
 overlay.style.opacity=String(Math.min(1,ads*1.35));
 $('game').classList.toggle('scoped',ads>.25);
 const z=$('zoom-button');
 z.setAttribute('aria-pressed',String(adsWant&&canAds()));
 z.classList.toggle('on',adsWant&&canAds());
 z.disabled=!canAds();
}
function setAds(on){
 adsWant=!!(on&&canAds());
 if(!adsWant){ads=0;applyAdsVisual();}
}
function setView(mode){viewMode=mode;clearInput();if(document.pointerLockElement)document.exitPointerLock?.();$('game').classList.toggle('first-person',mode==='3d');$('view-mode').textContent=mode==='3d'?'2D view [V]':'3D view [V]';$('inset-label').textContent=mode==='3d'?'OVERHEAD VIEW':'WEAPON VIEW';$('aim-pad').querySelector('span').textContent=mode==='3d'?'LOOK':'AIM';$('inset-player-dot').hidden=!(mapRight&&mode==='3d');setAds(false);resize();notify(mode==='3d'?'3D view · click to capture mouse; Esc releases · wheel scopes the AR-15':'2D view · mouse aims; wheel looks up/down');}
function toggleAssist(){assist=!assist;selectedTarget=null;$('assist-toggle').textContent=assist?'Aim assist: on':'Aim assist: off';$('assist-toggle').setAttribute('aria-pressed',String(assist));notify(assist?'Aim assist on [J]':'Aim assist off [J]');}
function setMapLeft(on= !mapLeft){mapLeft=on;$('satellite-panel').hidden=!on;if(on&&map)satellite.paint(player.x,player.z,player.angle);notify(on?'Satellite map on [N]':'Satellite map off');}
function setMapRight(on= !mapRight){mapRight=on;$('fp-frame').hidden=!on;$('inset-player-dot').hidden=!(on&&viewMode==='3d');resize();notify(on?(viewMode==='3d'?'Overhead map on [M]':'Weapon view on [M]'):'Inset map off');}
function nativePhone(){return matchMedia('(pointer:coarse) and (max-height:500px), (pointer:coarse) and (max-width:480px)').matches;}
function applyPhoneLayout(){
 const on=phonePreview||nativePhone();
 document.body.classList.toggle('phone-preview',phonePreview&&!nativePhone());
 document.body.classList.toggle('phone-layout',on);
 if(on)screen.orientation?.lock?.('landscape').catch(()=>{});
 else{screen.orientation?.unlock?.();if(mapRight)setMapRight(false);}
 requestAnimationFrame(()=>requestAnimationFrame(resize));
}
function togglePhone(){
 phonePreview=!phonePreview;
 applyPhoneLayout();
 notify(phonePreview?'iPhone 17 Pro layout [P]':'Desktop layout');
}
function toggleHelp(){showHelp=!showHelp;$('desktop-help').hidden=!showHelp;$('help-toggle').setAttribute('aria-pressed',String(showHelp));}
function setPitch(value){player.pitch=clampPitch(value);$('pitch-control').value=String(Math.round(player.pitch*180/Math.PI));$('pitch-value').textContent=`${Math.round(player.pitch*180/Math.PI)}°`;}
function startMap(next){
 visCache.clear();firstPerson.removeFromParent();for(const a of avatars)a.dispose?.();avatars=[];if(W)disposeWorld(W.scene);map=next;pending=null;map.terrain??=FLAT;W=createWorld(map);W.scene.add(firstPerson);enemies=[];tracers=[];selectedTarget=null;ended=false;Object.assign(player,{x:map.spawn.x,z:map.spawn.z,y:standHeight(map.spawn.x,map.spawn.z,map.buildings,W.height(map.spawn.x,map.spawn.z),map.yards,map.stairs,null,map.roads),vy:0,angle:0,pitch:0,hp:100,weapon:0,reload:0,cooldown:0,shooting:false,steps:0,grounded:true,crouch:false,running:false,jumpQueued:false});weapons.forEach(w=>{w.mag=w.capacity;w.reserve=w.capacity*5;});setPitch(0);
 const own=realisticPerson(W.scene)||person(W.scene,0x727c47);avatars.push(own);playerMesh=own.group;playerMesh.position.set(player.x,player.y,player.z);playerSprite=null;if(textures[0])playerSprite=attachSprite(playerMesh,textures[0]);const ring=new T.Mesh(new T.RingGeometry(1.15,1.27,40),new T.MeshBasicMaterial({color:0xe8ef86,side:T.DoubleSide,depthTest:false,transparent:true,opacity:.8}));ring.rotation.x=-Math.PI/2;ring.layers.set(1);ring.renderOrder=6;W.scene.add(ring);playerRing=ring;
 if(SPAWN_ENEMIES){
  const roadPoints=[];for(const r of map.roads)for(let i=1;i<r.points.length;i++){const a=r.points[i-1],b=r.points[i],steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/12));for(let k=0;k<=steps;k++){const t=k/steps,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;if(Math.hypot(x,z)<map.radius-4&&!blocked(x,z,map.buildings,.6))roadPoints.push({x,z});}}
  const used=new Set(),candidates=W.slots.map(s=>({...s,dist:Math.hypot(s.x-player.x,s.z-player.z)})).filter(s=>s.dist>15&&s.dist<115).sort((a,b)=>a.dist-b.dist);
  for(const s of candidates){if(enemies.length>=10)break;if(used.has(s.building.id))continue;const head=new T.Vector3(s.x,s.y+1.25,s.z);const vantage=roadPoints.filter(p=>Math.hypot(p.x-s.x,p.z-s.z)<55).sort((a,b)=>Math.hypot(a.x-s.x,a.z-s.z)-Math.hypot(b.x-s.x,b.z-s.z)).slice(0,22).find(p=>visible(head,new T.Vector3(p.x,W.height(p.x,p.z)+1.65,p.z)));if(!vantage)continue;
   const body=realisticPerson(W.scene,true)||person(W.scene,0x714e3f);avatars.push(body);const rifle=createWeapon(false);rifle.position.set(-.22,1.18,-.16);rifle.rotation.y=0;rifle.scale.setScalar(.78);rifle.traverse(o=>o.layers.set(0));body.group.add(rifle);body.group.position.set(s.x,s.y,s.z);body.group.rotation.y=s.angle+Math.PI;const marker=new T.Mesh(new T.RingGeometry(1.05,1.22,24),new T.MeshBasicMaterial({color:0xf29b75,depthTest:false,transparent:true}));marker.rotation.x=-Math.PI/2;marker.position.y=2.35;marker.layers.set(1);marker.renderOrder=6;body.group.add(marker);if(textures[1])attachSprite(body.group,textures[1]);enemies.push({...s,group:body.group,marker,hp:100,cooldown:2+Math.random()*2,seen:false,alert:0});used.add(s.building.id);
  }
 }
 const sat=map.satellite,photo=!!(map.photo||sat?.photo);
 $('data-credit').innerHTML=photo?(map.real?'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · user-supplied aerial photo · <a href="./credits.html" target="_blank">Credits</a>':'User-supplied aerial photo · generated stage'):map.real?'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · <a href="./credits.html" target="_blank">Terrain & data credits</a>':'OpenStreetMap playground';
 satellite.setMap(map);drawWeapon();setAds(false);updateHUD();resize();
}
function updateHUD(){const w=weapons[player.weapon];$('hp').textContent=Math.max(0,Math.ceil(player.hp));$('hp-bar').style.width=`${Math.max(0,player.hp)}%`;$('hp-bar').style.background=player.hp<30?'#f29077':'#e8ef86';$('weapon-name').textContent=w.name;$('ammo').textContent=w.mag;$('reserve').textContent=`/ ${w.reserve}`;$('reload-status').textContent=player.reload>0?'RELOADING…':player.weapon?'SECONDARY':'PRIMARY';}
function reload(){if(paused||ended)return;const w=weapons[player.weapon];if(player.reload||w.mag===w.capacity||!w.reserve)return;player.reload=w.reload;tone(350,.15,.06);updateHUD();}
function switchWeapon(){if(paused||ended)return;player.weapon=1-player.weapon;player.reload=0;player.cooldown=.25;setAds(false);drawWeapon();tone(450,.04,.04);updateHUD();}
function trace(a,b,color){const line=new T.Line(new T.BufferGeometry().setFromPoints([a,b]),new T.LineBasicMaterial({color,transparent:true,opacity:.95,depthTest:true}));W.scene.add(line);tracers.push({line,life:.09});}
function eye(){return new T.Vector3(player.x,player.y+(player.crouch?1.05:1.65),player.z);}
function occupy(){return {fences:map.fences,trees:map.trees,y:player.y,h:player.crouch?PLAYER_CROUCH:PLAYER_STAND};}
function surfaceAt(x,z){return standHeight(x,z,map.buildings,W.height(x,z),map.yards,map.stairs,player.y,map.roads);}
function canOccupy(x,z,r){
 if(blocked(x,z,map.buildings,r,occupy()))return false;
 const rise=surfaceAt(x,z)-player.y;
 if(rise>STEP_UP){
  if(player.grounded)return false;
  if(player.y+.12<surfaceAt(x,z))return false;
 }
 return true;
}
function direction(){if(assist&&selectedTarget)return new T.Vector3(selectedTarget.x,selectedTarget.y+1.25,selectedTarget.z).sub(eye()).normalize();const d=lookVector(player.angle,player.pitch);return new T.Vector3(d.x,d.y,d.z);}
function shoot(){const w=weapons[player.weapon];if(player.cooldown>0||player.reload>0)return;if(w.mag<=0){reload();if(!w.reserve){player.cooldown=.5;tone(80,.035,.06);notify('Out of ammunition — switch weapon or restart.');}return;}w.mag--;player.cooldown=w.delay;gunSound();const a=eye(),d=direction();aimRay.set(a,d);aimRay.far=120;const walls=aimRay.intersectObjects([...W.walls,W.ground],false);let distance=walls.length?walls[0].distance:120,hit=null;for(const e of enemies){if(e.hp<=0)continue;const center=new T.Vector3(e.x,e.y+1.25,e.z);const intersection=aimRay.ray.intersectSphere(new T.Sphere(center,.66),new T.Vector3());if(intersection){const ed=intersection.distanceTo(a);if(ed<distance){distance=ed;hit=e;}}}const end=a.clone().addScaledVector(d,distance);trace(a.clone().addScaledVector(d,.65),end,0xffed9c);if(hit){hit.hp-=w.damage;hit.marker.material.color.set(0xfff3b0);if(hit.hp<=0){hit.group.visible=false;tone(600,.08,.03);if(SPAWN_ENEMIES&&enemies.length&&enemies.every(e=>e.hp<=0))finish(true);}}
 recoil=1;$('fp-flash').style.opacity='1';setTimeout(()=>$('fp-flash').style.opacity='0',65);updateHUD();}
function finish(win){ended=true;paused=true;clearInput();document.exitPointerLock?.();$('pause-title').textContent=win?'Sector clear.':'You’re down.';$('pause-copy').textContent=win?'All hostiles eliminated. Explore another location or replay this sector.':'Restart the sector to try again.';$('resume').hidden=true;if(!$('pause-dialog').open)$('pause-dialog').showModal();}
function openPause(){if($('map-dialog').open||$('pause-dialog').open)return;paused=true;clearInput();document.exitPointerLock?.();$('pause-title').textContent='Paused.';$('pause-copy').textContent='Take a breath. The sector can wait.';$('resume').hidden=false;$('pause-dialog').showModal();}
function resume(){if(ended||!map||!W)return;$('pause-dialog').close();$('map-dialog').close();paused=false;clearInput();if(SPAWN_ENEMIES&&enemies.length===0)notify('No enemy positions fit this map. Explore it, or choose another.');}
function openMaps(){paused=true;clearInput();document.exitPointerLock?.();$('pause-dialog').close();if(!$('map-dialog').open)$('map-dialog').showModal();$('deploy').hidden=!(pending||map);}
async function enterSector(){
 if(pending){
  setLoading(true);status('Generating the playground…');
  await Promise.all([atlasPromise,characterPromise]);
  await new Promise(r=>requestAnimationFrame(r));
  startMap(pending);
  setLoading(false);
  $('map-summary').textContent+=SPAWN_ENEMIES?` ${enemies.length} generated enemies.`:' Combat off while the playground is tuned.';
  status('Ready. Playground built from your chosen location.');
 }
 if(!map||!W)return;
 resume();
}
function setLoading(value){loading=value;for(const id of ['load-map','deploy','photo-stage'])$(id).disabled=value;}
async function loadPhotoStage(file){
 if(loading||!file)return false;const id=++requestId;paused=true;clearInput();setLoading(true);$('map-summary').hidden=true;
 try{
  const scaleN=parseScale($('photo-scale').value);
  const [lat,lon]=coordinates($('photo-coords').value||$('location-input').value);
  $('location-input').value=`${lat}, ${lon}`;
  status('Reading aerial photo. Sizing it from 1:'+scaleN+'…');
  const image=await createImageBitmap(file);
  const photoMeters=photoSpanMeters(image,scaleN);
  const features=analyzeImage(image,photoMeters);
  const half=Math.max(205,photoMeters/2+40);
  await Promise.all([atlasPromise,characterPromise]);if(id!==requestId)return false;
  status('Loading streets and Sentinel-2 at those coordinates, then lining the photo up as a second layer…');
  let data=null,sat=null;
  try{
   const bundled=LOCATIONS.find(p=>Math.abs(p.lat-lat)<.00002&&Math.abs(p.lon-lon)<.00002);
   if(bundled){const r=await fetch(`./${bundled.file}`);if(r.ok)data=await r.json();}
   if(!data){
    const span=half/111320,dx=span/Math.cos(lat*Math.PI/180);
    const bbox=[lon-dx,lat-span,lon+dx,lat+span].join(',');
    const r=await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`);
    if(!r.ok)throw Error('The map service could not load this area. Check the coordinates.');
    data=fromXML(await r.text());
   }
   sat=await loadSatelliteCoverage(lat,lon,Math.max(650,photoMeters+120)).catch(()=>null);
  }catch(err){status(err.message||'Map data unavailable — draping the photo alone.',true);}
  if(id!==requestId)return false;
  let next;
  if(data){
   const osm=convert(data,lat,lon,'Aerial photo sector');
   osm.terrain=await loadTerrain(lat,lon).catch(()=>FLAT);
   const align=alignPhotoToCoverage(image,sat,photoMeters,GROUND_METERS);
   align.scaleN=scaleN;
   osm.satellite=drapePhotoOnCoverage(sat||{},image,photoMeters,align,GROUND_METERS);
   osm.photo=true;
   mergePhotoFeatures(osm,features);
   next=osm;
  }else{
   next=mapFromPhoto(image,'Aerial photo stage',photoMeters);
   next.lat=lat;next.lon=lon;
   next.satellite=coverageFromPhoto(image,lat,lon,photoMeters,GROUND_METERS,{scaleN});
   next.terrain={...FLAT,label:'Flat terrain under aerial photo'};
  }
  if(id!==requestId)return false;
  startMap(next);
  $('map-summary').textContent=`Photo 1:${scaleN} at ${lat.toFixed(5)}, ${lon.toFixed(5)} · ~${photoMeters.toFixed(0)} m across · ${next.buildings.length} buildings · ${next.fences?.length||0} fences · ${next.trees?.length||0} trees. ${next.satellite?.label||''}. North-up photo is layered on the map data.`;
  $('map-summary').hidden=false;$('deploy').hidden=false;
  status(next.real?'Ready. Photo aligned to the mapped coordinates. Enter sector to play.':'Ready. Photo sized from the scale; map outlines were unavailable.');return true;
 }catch(e){status(e.message||'The aerial photo could not be read.',true);return false;}
 finally{if(id===requestId)setLoading(false);}
}
async function loadMap(lat,lon,name){if(loading)return false;const id=++requestId;paused=true;clearInput();setLoading(true);status('Loading real roads and building outlines…');$('map-summary').hidden=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),22000);try{
 const bundled=LOCATIONS.find(p=>Math.abs(p.lat-lat)<.00002&&Math.abs(p.lon-lon)<.00002);let data;
 if(bundled){const r=await fetch(`./${bundled.file}`,{signal:controller.signal});if(!r.ok)throw Error('The bundled map could not load. Please retry.');data=await r.json();name=bundled.name;}else{const span=205/111320,dx=span/Math.cos(lat*Math.PI/180);const bbox=[lon-dx,lat-span,lon+dx,lat+span].join(',');const r=await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`,{signal:controller.signal});if(!r.ok)throw Error(r.status===429?'The map service is busy. Wait a little, then try again.':'The map service could not load this area. Try a nearby location.');data=fromXML(await r.text());}
 const next=convert(data,lat,lon,name||'Selected coordinates');status('Building map. Reading elevation and newest Sentinel-2 mosaic…');
 const [terrain,coverage]=await Promise.all([loadTerrain(lat,lon).catch(()=>FLAT),loadSatelliteCoverage(lat,lon).catch(()=>null)]);
 next.terrain=terrain;next.satellite=coverage;
 if(id!==requestId)return false;pending=next;cache.set(`${lat},${lon}`,next);const verified=next.buildings.filter(b=>b.verified).length;const parks=(next.cover||[]).filter(c=>c.kind!=='water').length,water=(next.cover||[]).filter(c=>c.kind==='water').length;
 $('map-summary').textContent=`${next.buildings.length} mapped buildings · ${verified} with mapped height/levels · ${next.buildings.length-verified} estimated. ${next.cover?.length||0} landcover patches (${parks} park/forest, ${water} water). ${next.fences?.length||0} fences · ${next.trees?.length||0} trees. ${next.terrain.label}. ${coverage?.label||'No satellite'}. Enter sector to generate the playground.`;
 $('map-summary').hidden=false;$('deploy').hidden=false;
 status(next.terrain.real?(coverage?.draped?'Location ready. Enter sector to build streets, buildings and terrain.':'Location ready. Elevation loaded; satellite drape unavailable. Enter sector to build.'):'Location ready, but elevation could not load. Terrain will be flat. Enter sector to build.',!next.terrain.real);return true;
 }catch(e){status(e.name==='AbortError'?'Map request timed out. Try again.':e.message,true);return false;}finally{clearTimeout(timer);if(id===requestId)setLoading(false);}}
function insetBox(){if(!mapRight||$('fp-frame').hidden)return null;const area=$('fp-area').getBoundingClientRect(),canvas=renderer.domElement.getBoundingClientRect(),w=area.width,h=area.height;if(w<8||h<8||canvas.width<8)return null;return{left:area.left-canvas.left,bottom:canvas.bottom-area.bottom,width:w,height:h};}
function resize(){width=$('game').clientWidth;height=$('game').clientHeight;renderer.setSize(width,height);half=width<700?39:44;fpRect=insetBox();const mainAspect=width/Math.max(1,height),insetOn=!!fpRect,insetAspect=insetOn?fpRect.width/Math.max(1,fpRect.height):mainAspect;if(viewMode==='2d'){overhead.left=-half*mainAspect;overhead.right=half*mainAspect;firstPerson.aspect=insetAspect;}else{firstPerson.aspect=mainAspect;overhead.left=-half*insetAspect;overhead.right=half*insetAspect;}overhead.top=half;overhead.bottom=-half;overhead.updateProjectionMatrix();firstPerson.updateProjectionMatrix();}
window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
function nearestTarget(){if(!assist)return null;let best=null,bestScore=.13;const a=eye(),d=lookVector(player.angle,player.pitch),forward=new T.Vector3(d.x,d.y,d.z);for(const e of enemies){if(e.hp<=0)continue;const target=new T.Vector3(e.x,e.y+1.25,e.z),delta=target.clone().sub(a),dist=delta.length();if(dist>90)continue;const diff=forward.angleTo(delta);if(diff<bestScore&&visible(a,target)){best=e;bestScore=diff;}}return best;}
function update(dt){clock+=dt;player.cooldown=Math.max(0,player.cooldown-dt);if(player.reload>0){player.reload-=dt;if(player.reload<=0){player.reload=0;const w=weapons[player.weapon],n=Math.min(w.capacity-w.mag,w.reserve);w.mag+=n;w.reserve-=n;tone(600,.055,.04);updateHUD();}}
 if(Math.hypot(stick.aimX,stick.aimZ)>.1){player.angle+=stick.aimX*2.2*dt;setPitch(player.pitch-stick.aimZ*1.5*dt);}else if(viewMode==='2d'&&mouse.active){const mx=(mouse.x/width*2-1)*half*width/height,mz=(mouse.y/height*2-1)*half;player.angle=Math.atan2(mx,-mz);}if(keys.has('PageUp'))setPitch(player.pitch+dt);if(keys.has('PageDown'))setPitch(player.pitch-dt);
 const wantCrouch=keys.has('KeyC');
 const standClear=!blocked(player.x,player.z,map.buildings,.5,{fences:map.fences,trees:map.trees,y:player.y,h:PLAYER_STAND});
 player.crouch=wantCrouch||!standClear;
 player.running=!player.crouch&&(keys.has('ShiftLeft')||keys.has('ShiftRight'));
 if(player.jumpQueued&&player.grounded){player.vy=7.2;player.grounded=false;player.crouch=false;}
 player.jumpQueued=false;
 const forward=-stick.z+(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0),strafe=stick.x+(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);const move=facingMovement(player.angle,forward,strafe),len=Math.hypot(move.x,move.z);
 const speed=player.crouch?2.35:player.running?8.6:5.4,radius=player.crouch?.4:.48;
 let nx=player.x+move.x*speed*dt,nz=player.z+move.z*speed*dt;
 if(Math.hypot(nx,nz)<map.radius-1){if(canOccupy(nx,player.z,radius))player.x=nx;if(canOccupy(player.x,nz,radius))player.z=nz;}
 else if(clock-boundaryTimer>3){notify('Edge of the downloaded sector');boundaryTimer=clock;}
 const gy=surfaceAt(player.x,player.z);
 const head=player.crouch?PLAYER_CROUCH:PLAYER_STAND;
 const cap=ceilingAt(player.x,player.z,map.buildings,player.y,map.stairs);
 if(player.grounded){
  if(gy>=player.y-STEP_UP&&gy<=player.y+STEP_UP){player.y=gy;player.vy=0;}
  else if(gy<player.y-STEP_UP)player.grounded=false;
 }else{
  player.vy-=17*dt;player.y+=player.vy*dt;
  if(player.y<=gy&&player.vy<=0){player.y=gy;player.vy=0;player.grounded=true;}
 }
 if(cap!=null&&player.y+head>cap){player.y=Math.max(gy,cap-head);if(player.vy>0)player.vy=0;}
 if(len>.01)player.steps+=dt*(player.running?14:player.crouch?6:10);playerMesh.position.set(player.x,player.y,player.z);playerMesh.rotation.y=-player.angle;
 for(let i=0;i<avatars.length;i++)avatars[i].update?.(dt,i===0?Math.min(1,len):0,i===0?{crouch:player.crouch,run:player.running}:undefined);selectedTarget=nearestTarget();if(player.shooting)shoot();
 const pEye=eye();for(const e of enemies){if(e.hp<=0)continue;const head=new T.Vector3(e.x,e.y+1.25,e.z),dist=head.distanceTo(pEye);e.group.visible=true;e.cooldown-=dt;if(e.cooldown<.65&&e.cooldown>0){e.marker.material.color.set(0xffd693);e.marker.scale.setScalar(1+Math.sin(clock*16)*.12);}else{e.marker.material.color.set(selectedTarget===e?0xe8ef86:0xef946e);e.marker.scale.setScalar(1);}if(dist<64&&visible(head,pEye)){e.group.rotation.y=Math.atan2(-(player.x-e.x),-(player.z-e.z));if(e.cooldown<=0){trace(head,pEye.clone().add(new T.Vector3((Math.random()-.5)*1.2,0,(Math.random()-.5)*1.2)),0xff8a67);tone(100,.07,.025);if(Math.random()<.64){player.hp-=7;$('damage').style.opacity='.45';setTimeout(()=>$('damage').style.opacity='0',140);updateHUD();if(player.hp<=0){finish(false);break;}}e.cooldown=2.4+Math.random()*1.4;}}}
 if(playerMesh&&playerSprite)playerSprite.position.y=(player.crouch?1.35:2.2)+Math.sin(player.steps)*.05;
}
function render(){const now=performance.now(),dt=Math.min(.04,(now-last)/1000);last=now;
 if(!W){renderer.setClearColor(0x11191c);renderer.setScissorTest(false);renderer.setViewport(0,0,width,height);renderer.clear();requestAnimationFrame(render);return;}
 const adsTarget=adsWant&&canAds()?1:0;ads+=(adsTarget-ads)*Math.min(1,dt*16);if(Math.abs(ads-adsTarget)<.01)ads=adsTarget;applyAdsVisual();
 if(!paused&&!ended)update(dt);recoil=Math.max(0,recoil-dt*10);for(let i=tracers.length-1;i>=0;i--){const t=tracers[i];if(!paused)t.life-=dt;if(t.life<=0){W.scene.remove(t.line);t.line.geometry.dispose();t.line.material.dispose();tracers.splice(i,1);}}
 overhead.position.set(player.x,player.y+200,player.z);overhead.lookAt(player.x,player.y,player.z);if(playerRing)playerRing.position.set(player.x,player.y+.18,player.z);const heading=(player.angle*180/Math.PI%360+360)%360;$('heading').textContent=`${String(Math.round(heading)%360).padStart(3,'0')}° · ${Math.round(player.pitch*180/Math.PI)}°`;$('aim-label').textContent=assist?(selectedTarget?'Street · assisted':'Assist on · drag to look'):'Manual aim · drag to look';const a=eye(),d=direction();firstPerson.position.copy(a);firstPerson.lookAt(a.clone().add(d));aimRay.set(a,d);aimRay.far=120;const hits=aimRay.intersectObjects(W.walls,false);const targetDistance=selectedTarget?new T.Vector3(selectedTarget.x,selectedTarget.y+1.25,selectedTarget.z).distanceTo(a):(hits[0]?.distance||120);alignWeapon(weaponModel,targetDistance,recoil,player.weapon===1);
 if(W.sun)W.sun.shadow.needsUpdate=!paused;
 renderer.setScissorTest(false);renderer.setViewport(0,0,width,height);renderer.clear();if(playerMesh)playerMesh.visible=viewMode==='2d';renderer.render(W.scene,viewMode==='2d'?overhead:firstPerson);
 const rect=insetBox();
 if(rect){
  renderer.setScissorTest(true);renderer.setScissor(rect.left,rect.bottom,rect.width,rect.height);renderer.setViewport(rect.left,rect.bottom,rect.width,rect.height);renderer.clear();if(playerMesh)playerMesh.visible=viewMode==='3d';renderer.render(W.scene,viewMode==='3d'?overhead:firstPerson);if(playerMesh)playerMesh.visible=true;renderer.setScissorTest(false);
 }else if(playerMesh)playerMesh.visible=true;
 if(!paused&&mapLeft)satellite.paint(player.x,player.z,player.angle);requestAnimationFrame(render);}
function look(dx,dy){const s=.003/(1+ads*(ADS_ZOOM-1));player.angle+=dx*s;setPitch(player.pitch-dy*s);mouse.active=false;}
renderer.domElement.addEventListener('pointermove',e=>{if(paused)return;if(viewMode==='3d'){if(document.pointerLockElement===renderer.domElement||lookDrag)look(e.movementX||0,e.movementY||0);}else if(e.pointerType!=='touch')mouse={x:e.clientX,y:e.clientY,active:true};});renderer.domElement.addEventListener('pointerdown',e=>{if(paused)return;unlockAudio();if(viewMode==='3d'){lookDrag=true;if(e.pointerType!=='touch'&&e.button===0&&!document.pointerLockElement&&!document.body.classList.contains('phone-layout')){try{const p=renderer.domElement.requestPointerLock?.();p?.catch?.(()=>notify('Drag the view to look around.'));}catch{}}}if(e.pointerType!=='touch'&&e.button===0){player.shooting=true;if(viewMode==='2d')mouse={x:e.clientX,y:e.clientY,active:true};}renderer.domElement.setPointerCapture(e.pointerId);});renderer.domElement.addEventListener('pointerup',e=>{if(e.pointerType!=='touch')player.shooting=false;lookDrag=false;});renderer.domElement.addEventListener('pointercancel',clearInput);renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());renderer.domElement.addEventListener('wheel',e=>{if(paused)return;e.preventDefault();if(canAds())setAds(e.deltaY<0);else if(viewMode==='2d')setPitch(player.pitch-e.deltaY*.001);},{passive:false});window.addEventListener('wheel',e=>{if(paused||e.target.tagName==='INPUT')return;e.preventDefault();if(canAds())setAds(e.deltaY<0);else if(viewMode==='2d')setPitch(player.pitch-e.deltaY*.001);},{passive:false});window.addEventListener('pointerup',e=>{if(e.pointerType!=='touch')player.shooting=false;});
let insetPointer=null,insetX=0,insetY=0;$('fp-area').addEventListener('pointerdown',e=>{if(paused||viewMode==='3d')return;insetPointer=e.pointerId;insetX=e.clientX;insetY=e.clientY;$('fp-area').setPointerCapture(e.pointerId);});$('fp-area').addEventListener('pointermove',e=>{if(e.pointerId!==insetPointer)return;look(e.clientX-insetX,e.clientY-insetY);insetX=e.clientX;insetY=e.clientY;});for(const kind of ['pointerup','pointercancel','lostpointercapture'])$('fp-area').addEventListener(kind,()=>insetPointer=null);
function bindStick(id,aim){const pad=$(id),knob=pad.querySelector('.stick-knob');let pid=null;const move=e=>{const r=pad.getBoundingClientRect(),radius=r.width*.34;let x=(e.clientX-r.left-r.width/2)/radius,z=(e.clientY-r.top-r.height/2)/radius;const len=Math.hypot(x,z);if(len>1){x/=len;z/=len;}knob.style.transform=`translate(${x*radius}px,${z*radius}px)`;if(aim){stick.aimX=x;stick.aimZ=z;mouse.active=false;}else{stick.x=x;stick.z=z;}};pad.addEventListener('pointerdown',e=>{if(paused||pid!==null)return;e.preventDefault();pid=e.pointerId;pad.setPointerCapture(pid);move(e);});pad.addEventListener('pointermove',e=>{if(e.pointerId===pid)move(e);});const up=e=>{if(e.pointerId!==pid)return;pid=null;knob.style.transform='';if(aim)stick.aimX=stick.aimZ=0;else stick.x=stick.z=0;};pad.addEventListener('pointerup',up);pad.addEventListener('pointercancel',up);pad.addEventListener('lostpointercapture',up);}bindStick('move-pad',false);bindStick('aim-pad',true);
function inspectView(){
 const r=n=>Math.round(n*1000)/1000;
 const a=eye(),d=direction();
 aimRay.set(a,d);aimRay.far=80;
 const hits=W?aimRay.intersectObjects([...W.walls,W.ground],false):[];
 const hit=hits[0];
 const groundHere=W?W.height(player.x,player.z):0;
 const insideB=map.buildings.find(b=>inside(player.x,player.z,b.points));
 const nearby=map.buildings.filter(b=>{
  const dx=(b.minX+b.maxX)/2-player.x,dz=(b.minZ+b.maxZ)/2-player.z;
  return Math.hypot(dx,dz)<28||b===insideB;
 }).slice(0,8).map(b=>{
  const doors=(b.doors||[]).map(door=>{
   const mx=(door.a.x+door.b.x)/2,mz=(door.a.z+door.b.z)/2;
   const gnd=W.height(mx,mz);
   return {mid:{x:r(mx),z:r(mz)},bottom:r(door.bottom),top:r(door.top),ground:r(gnd),sillMinusFloor:r(door.bottom-b.base),sillMinusGround:r(door.bottom-gnd),sillMinusPlayer:r(door.bottom-player.y),dist:r(Math.hypot(mx-player.x,mz-player.z))};
  });
  return {id:b.id,area:r(b.area||0),levels:b.levels,height:r(b.height||0),base:r(b.base),low:r(b.low),storeys:(b.storeys||[]).map(r),playerInside:b===insideB,doors};
 });
 const stairs=(map.stairs||[]).filter(s=>Math.hypot((s.a.x+s.b.x)/2-player.x,(s.a.z+s.b.z)/2-player.z)<20).slice(0,6).map(s=>({y0:r(s.y0),y1:r(s.y1),width:r(s.width),rise:r(s.y1-s.y0),dist:r(Math.hypot((s.a.x+s.b.x)/2-player.x,(s.a.z+s.b.z)/2-player.z))}));
 return {
  map:map.name,view:viewMode,
  player:{x:r(player.x),y:r(player.y),z:r(player.z),eyeY:r(a.y),angle:r(player.angle*180/Math.PI),pitch:r(player.pitch*180/Math.PI),ground:r(groundHere),feetMinusGround:r(player.y-groundHere)},
  look:{dir:{x:r(d.x),y:r(d.y),z:r(d.z)},hit:hit?{x:r(hit.point.x),y:r(hit.point.y),z:r(hit.point.z),dist:r(hit.distance),hitMinusFloor:insideB?r(hit.point.y-insideB.base):null,hitMinusFeet:r(hit.point.y-player.y),hitMinusEye:r(hit.point.y-a.y)}:null},
  insideBuilding:insideB?insideB.id:null,
  buildings:nearby,
  stairs
 };
}
async function copyViewDump(){
 if(!map||!W){notify('No sector to dump');return;}
 const json=JSON.stringify(inspectView(),null,2);
 try{await navigator.clipboard.writeText(json);notify('View dump copied — paste it in chat');}
 catch{window.prompt('Copy view dump',json);}
}
window.addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();if(e.code==='Escape'){e.preventDefault();if($('pause-dialog').open&&!ended)resume();else if(!$('map-dialog').open){if(map)openPause();else openMaps();}return;}if(!e.repeat&&e.code==='KeyF'&&map&&W){e.preventDefault();copyViewDump();return;}if(paused)return;keys.add(e.code);if(!e.repeat&&e.code==='KeyR')reload();if(!e.repeat&&e.code==='KeyQ')switchWeapon();if(!e.repeat&&e.code==='Space')player.jumpQueued=true;});window.addEventListener('keyup',e=>{keys.delete(e.code);});window.addEventListener('blur',()=>{clearInput();if(map&&!paused)openPause();});document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();if(map&&!paused)openPause();}});
$('map-form').addEventListener('submit',e=>{e.preventDefault();try{const [lat,lon]=coordinates($('location-input').value);$('photo-coords').value=`${lat}, ${lon}`;loadMap(lat,lon);}catch(err){status(err.message,true);}});$('photo-stage').onclick=()=>{try{parseScale($('photo-scale').value);coordinates($('photo-coords').value);$('photo-input').click();}catch(err){status(err.message,true);}};$('photo-input').addEventListener('change',e=>{const file=e.target.files?.[0];e.target.value='';if(file)loadPhotoStage(file);});$('maps').onclick=openMaps;$('pause-map').onclick=openMaps;$('close-map').onclick=()=>{if(!loading&&map)resume();};$('deploy').onclick=enterSector;$('pause').onclick=()=>{if(map)openPause();else openMaps();};$('resume').onclick=resume;$('restart').onclick=()=>{if(!map)return;startMap(map);$('pause-dialog').close();paused=false;};$('sound').onclick=()=>{soundOn=!soundOn;$('sound').textContent=soundOn?'Sound on':'Sound off';if(soundOn)unlockAudio();tone(400,.08,.05);};for(const id of ['map-dialog','pause-dialog'])$(id).addEventListener('cancel',e=>{e.preventDefault();if(!loading&&!ended&&map)resume();});
// Optional browser agent tools use exactly the same visible actions and state.
if(document.modelContext?.registerTool){const life=new AbortController();for(const tool of [{name:'read_game_state',description:'Read current map provenance, terrain availability, health and remaining enemies.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({map:map?.name,coordinates:map?.real?[map.lat,map.lon]:null,realGeometry:map?.real,realElevation:map?.terrain?.real,paused,health:player.hp,remaining:enemies.filter(e=>e.hp>0).length})},{name:'load_game_location',description:'Pause the game and load a real map by coordinates. Keeps map selection open for the player to enter.',inputSchema:{type:'object',properties:{latitude:{type:'number',minimum:-80,maximum:80},longitude:{type:'number',minimum:-180,maximum:180}},required:['latitude','longitude'],additionalProperties:false},annotations:{readOnlyHint:false},execute:async input=>{const [lat,lon]=coordinates(`${input.latitude},${input.longitude}`);if(loading)throw Error('A map is already loading.');openMaps();$('location-input').value=`${lat}, ${lon}`;$('photo-coords').value=`${lat}, ${lon}`;const ok=await loadMap(lat,lon);if(!ok)throw Error($('map-status').textContent);return {ready:true,name:pending?.name,buildings:pending?.buildings.length,realElevation:pending?.terrain?.real,note:'Enter sector to generate the playground'};}}]){try{Promise.resolve(document.modelContext.registerTool(tool,{signal:life.signal})).catch(()=>{});}catch{}}window.addEventListener('pagehide',()=>life.abort(),{once:true});}
$('view-mode').onclick=$('swap-inset').onclick=()=>setView(viewMode==='2d'?'3d':'2d');$('help-toggle').onclick=toggleHelp;$('assist-toggle').onclick=toggleAssist;$('pitch-control').addEventListener('input',e=>setPitch(Number(e.target.value)*Math.PI/180));$('level-aim').onclick=()=>setPitch(0);$('fire-button').addEventListener('pointerdown',e=>{if(paused)return;e.preventDefault();player.shooting=true;$('fire-button').setPointerCapture(e.pointerId);});for(const type of ['pointerup','pointercancel','lostpointercapture'])$('fire-button').addEventListener(type,()=>player.shooting=false);$('zoom-button').addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();if(paused)return;if(!canAds()){notify('Scope is AR-15 only');return;}setAds(!adsWant);});$('switch-button').addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();switchWeapon();});$('jump-button').addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();if(paused)return;player.jumpQueued=true;});$('phone-map').addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();if(paused)return;setMapRight(true);});$('close-inset').addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();setMapRight(false);});window.addEventListener('keydown',e=>{if(e.repeat||e.target.tagName==='INPUT')return;if(e.code==='KeyV')setView(viewMode==='2d'?'3d':'2d');if(e.code==='KeyJ'||e.code==='KeyH')toggleAssist();if(e.code==='KeyN'){e.preventDefault();setMapLeft();}if(e.code==='KeyM'){e.preventDefault();setMapRight();}if(e.code==='KeyP'){e.preventDefault();togglePhone();}if(e.key==='?'||e.code==='Slash'){e.preventDefault();toggleHelp();}});document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement&&viewMode==='3d'&&!paused&&map)openPause();});
resize();applyPhoneLayout();matchMedia('(pointer:coarse) and (max-height:500px), (pointer:coarse) and (max-width:480px)').addEventListener('change',applyPhoneLayout);requestAnimationFrame(render);$('location-input').value=`${INITIAL[0]}, ${INITIAL[1]}`;$('photo-coords').value=`${INITIAL[0]}, ${INITIAL[1]}`;openMaps();status('Choose a location. The playground is generated only after you enter the sector.');
