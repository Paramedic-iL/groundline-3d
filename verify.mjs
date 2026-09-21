import fs from 'node:fs';
import assert from 'node:assert/strict';
import {convert,coordinates,blocked,training,LOCATIONS,landKind,PLAYER_STAND,PLAYER_CROUCH,inside,standHeight,ceilingAt,STEP_UP,closedRing,onRoad,segmentDistance,FLOOR_SLAB} from './dist/map-model.js';
import {FLAT,decode,tileXY} from './dist/terrain.js';
import {createWorld,disposeWorld} from './dist/world.js';
import {analyzeRaster,parseScale,photoSpanMeters} from './dist/photo-stage.js';
assert.deepEqual(coordinates('31.714529, 35.101434'),[31.714529,35.101434]);
for(const bad of ['','91,1','31','NaN,7','1,2,3'])assert.throws(()=>coordinates(bad));
assert.equal(decode(128,0,0),0);assert.equal(decode(129,2,128),258.5);
assert.equal(Math.floor(tileXY(31.714529,35.101434).x),9789);
assert.equal(landKind({natural:'water'}),'water');
assert.equal(landKind({landuse:'forest'}),'forest');
assert.equal(landKind({leisure:'park'}),'park');
assert.equal(landKind({highway:'residential'}),null);
for(const place of LOCATIONS){const data=JSON.parse(fs.readFileSync(`dist/${place.file}`,'utf8'));const map=convert(data,place.lat,place.lon,place.name);map.terrain=FLAT;assert(Array.isArray(map.cover));assert(Array.isArray(map.fences));assert(Array.isArray(map.trees));assert(!blocked(map.spawn.x,map.spawn.z,map.buildings,1,{fences:map.fences,trees:map.trees}));const world=createWorld(map);assert(world.walls.length>=6);assert(world.slots.length>5);assert(map.buildings.some(b=>b.doors?.length));assert(map.buildings.every(b=>b.base!=null));let vertices=0;world.scene.traverse(o=>{if(o.geometry?.attributes.position){const a=o.geometry.attributes.position.array;assert([...a].every(Number.isFinite));vertices+=a.length/3;}});console.log(`${place.name}: ${map.buildings.length} buildings, ${map.fences.length} fences, ${map.trees.length} trees, ${world.slots.length} generated façade positions, valid spawn, ${vertices} finite vertices`);disposeWorld(world.scene);}
const t=training();assert(!blocked(t.spawn.x,t.spawn.z,t.buildings,.55,{fences:t.fences,trees:t.trees}));assert(blocked(-40,-48,t.buildings));assert(t.fences.length>=1);assert(t.trees.length>=1);const trainMap={...t,terrain:FLAT};const tw=createWorld(trainMap);assert(Array.isArray(t.yards));
const tall=t.buildings.find(b=>b.doors?.[0]&&b.doors[0].top-b.doors[0].bottom>1.8);
const low=t.buildings.find(b=>b.doors?.[0]&&b.doors[0].top-b.doors[0].bottom<1.6);
assert(tall&&low,'training yard needs both standing and crouch doors');
function doorSample(b,outward){
 const d=b.doors[0],mx=(d.a.x+d.b.x)/2,mz=(d.a.z+d.b.z)/2;
 let nx=d.b.z-d.a.z,nz=-(d.b.x-d.a.x),len=Math.hypot(nx,nz)||1;nx/=len;nz/=len;
 if(inside(mx+nx*.4,mz+nz*.4,b.points)===!!outward){nx=-nx;nz=-nz;}
 return {x:mx+nx*outward,z:mz+nz*outward};
}
const outside=doorSample(tall,1.1),gap=doorSample(tall,0),insidePt=doorSample(tall,-1.1);
assert(!blocked(outside.x,outside.z,t.buildings,.48,{y:0,h:PLAYER_STAND}),'approach to door');
assert(!blocked(gap.x,gap.z,t.buildings,.48,{y:0,h:PLAYER_STAND}),'stand through tall door');
assert(!blocked(insidePt.x,insidePt.z,t.buildings,.48,{y:0,h:PLAYER_STAND}),'enter interior');
assert(!blocked(gap.x,gap.z,t.buildings,.48,{y:tall.doors[0].bottom-STEP_UP+.03,h:PLAYER_STAND}),'step up through a door');
assert(blocked(gap.x,gap.z,t.buildings,.48,{y:tall.doors[0].bottom-STEP_UP-.1,h:PLAYER_STAND}),'cannot walk through from below a step');
const lowGap=doorSample(low,0);
assert(blocked(lowGap.x,lowGap.z,t.buildings,.48,{y:0,h:PLAYER_STAND}),'standing blocked by low lintel');
assert(!blocked(lowGap.x,lowGap.z,t.buildings,.4,{y:0,h:PLAYER_CROUCH}),'crouch fits low door');
assert(t.buildings.every(b=>b.base>=0),'door sill is never below ground');
{
 const multi=t.buildings.find(b=>b.levels>=2&&b.area>80);
 assert(multi,'training has a multi-storey house');
 assert(multi.storeys.some(s=>Math.abs(s-(multi.base+3.2))<.05),'upper storey sits one Israeli floor-to-floor above the entrance floor');
 const indoor=(trainMap.stairs||[]).filter(s=>inside((s.a.x+s.b.x)/2,(s.a.z+s.b.z)/2,multi.points)&&!s.flat&&s.y1-s.y0>.35);
 assert(indoor.length>=1,'stairs connect the storeys');
 assert(indoor.every(s=>(s.n||Math.round((s.y1-s.y0)/s.H))<=16),'indoor flights have at most 16 risers');
 assert(indoor.every(s=>s.width>=.8&&s.H>=.10&&s.H<=.175&&s.B>=.26),'interior stairs follow private Israeli riser/tread/width');
 function roomPoint(b,stairs){
  const cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2;
  const clear=(x,z)=>inside(x,z,b.points)&&!(stairs||[]).some(s=>s.well&&inside(x,z,s.well));
  if(clear(cx,cz))return {x:cx,z:cz};
  for(const dx of [1.6,-1.6,2.4,-2.4])for(const dz of [1.6,-1.6,2.4])if(clear(cx+dx,cz+dz))return {x:cx+dx,z:cz+dz};
  return {x:cx,z:cz};
 }
 const room=roomPoint(multi,trainMap.stairs);
 const nextFloor=multi.storeys.filter(s=>s>multi.base+.5).sort((a,c)=>a-c)[0];
 const up=Math.max(...multi.storeys.filter(s=>s>=multi.base));
 const floorY=standHeight(room.x,room.z,t.buildings,0,trainMap.yards,trainMap.stairs,multi.base+.05);
 assert(Math.abs(floorY-multi.base)<.08,`ground storey is walkable ${floorY} vs ${multi.base}`);
 const upperY=standHeight(room.x,room.z,t.buildings,0,trainMap.yards,trainMap.stairs,up);
 assert(Math.abs(upperY-up)<.08,`upper storey is walkable ${upperY} vs ${up}`);
 const ceil=ceilingAt(room.x,room.z,t.buildings,multi.base+.05,trainMap.stairs);
 assert(ceil!=null&&Math.abs(ceil-(nextFloor-FLOOR_SLAB))<.12,`upper floor is the ceiling of the room below ${ceil} vs ${nextFloor-FLOOR_SLAB}`);
 const onStair=indoor.find(s=>s.y1-s.y0>1)||indoor[0];
 const sx=(onStair.a.x+onStair.b.x)/2,sz=(onStair.a.z+onStair.b.z)/2,sy=(onStair.y0+onStair.y1)/2;
 const headroom=ceilingAt(sx,sz,t.buildings,sy,trainMap.stairs);
 assert(headroom==null||headroom>=sy+PLAYER_STAND-.05,`can stand on the stairs, ceiling ${headroom} at ${sy}`);
 assert(Math.abs(tall.doors[0].bottom)<.08,'street door sits on the ground floor');
 {
  const d=multi.doors[0],mx=(d.a.x+d.b.x)/2,mz=(d.a.z+d.b.z)/2;
  let nx=d.b.z-d.a.z,nz=-(d.b.x-d.a.x),nl=Math.hypot(nx,nz)||1;nx/=nl;nz/=nl;
  if(inside(mx+nx*.4,mz+nz*.4,multi.points)){nx=-nx;nz=-nz;}
  const tx=(d.b.x-d.a.x)/nl,tz=(d.b.z-d.a.z)/nl;
  const first=indoor.find(s=>Math.abs(s.y0-d.bottom)<.12)||indoor[0];
  for(const pt of [first.a,first.b,...(first.well||[])]){
   const vx=pt.x-mx,vz=pt.z-mz,along=vx*tx+vz*tz,inw=-(vx*nx+vz*nz);
   assert(!(Math.abs(along)<1.15&&inw>-.1&&inw<1.15),`entrance lobby stays clear of the stair ${along.toFixed(2)},${inw.toFixed(2)}`);
  }
 }
 const flight=indoor[0];
 let prevY=flight.y0;
 const len=Math.hypot(flight.b.x-flight.a.x,flight.b.z-flight.a.z)||1,step=.12/len;
 for(let u=0;u<=1.001;u+=step){
  const x=flight.a.x+(flight.b.x-flight.a.x)*Math.min(1,u),z=flight.a.z+(flight.b.z-flight.a.z)*Math.min(1,u);
  const y=standHeight(x,z,t.buildings,0,trainMap.yards,trainMap.stairs,prevY);
  assert(y-prevY<=STEP_UP+.02,`interior stair t=${u.toFixed(2)} rises ${y-prevY}`);
  prevY=y;
 }
 function assertFloorLanding(b,stairs,buildings,groundAt,yards){
  const flights=stairs.filter(s=>!s.flat&&s.y1-s.y0>.35&&inside((s.a.x+s.b.x)/2,(s.a.z+s.b.z)/2,b.points));
  const arrivals=flights.filter(s=>(b.storeys||[]).some(y=>Math.abs(s.y1-y)<.08));
  assert(arrivals.length>=1,'a flight arrives on a storey');
  for(const s of arrivals){
   const top=standHeight(s.b.x,s.b.z,buildings,groundAt(s.b.x,s.b.z),yards,stairs,s.y1);
   assert(top>=s.y1-.08,`top nosing is walkable ${top} vs ${s.y1}`);
   assert(top-s.y1<=STEP_UP+.02,`no jump at the top nosing ${top-s.y1}`);
   const pads=stairs.filter(p=>p.flat&&Math.abs(p.y1-s.y1)<.08&&inside((p.a.x+p.b.x)/2,(p.a.z+p.b.z)/2,b.points));
   assert(pads.length>=1,`1.20 m landing at storey ${s.y1}`);
   for(const p of pads){
    const cx=(p.a.x+p.b.x)/2,cz=(p.a.z+p.b.z)/2;
    const stand=standHeight(cx,cz,buildings,groundAt(cx,cz),yards,stairs,s.y1);
    assert(stand>=s.y1-.08,`walk off onto the landing ${stand} vs ${s.y1}`);
    assert(stand-s.y1<=STEP_UP+.02,`landing is the floor, not a ledge ${stand-s.y1}`);
   }
  }
 }
 assertFloorLanding(multi,trainMap.stairs,t.buildings,()=>0,trainMap.yards);
}
disposeWorld(tw.scene);
const slope={height:(x)=>x*.45,real:false,label:'test slope'};
const sloped=training();
sloped.roads=[...sloped.roads,{width:2,points:[{x:-50,z:-37},{x:-32,z:-37}],name:'',kind:'footway'}];
const slopeMap={...sloped,terrain:slope};
const sw=createWorld(slopeMap);
for(const b of sloped.buildings){
 const highs=b.points.map(q=>q.x*.45);
 const high=Math.max(...highs),low=Math.min(...highs);
 assert(b.base>=high-.15,`floor at least at highest footprint ground, got ${b.base} vs ${high}`);
 assert(b.storeys[0]===b.base);
 assert(b.storeys.length>=1+Math.min(4,Math.floor((high-low)/3.2)));
 assert(b.doors.length>=1,`every building has a doorway id=${b.id}`);
 assert(b.doors.every(d=>b.storeys.some(s=>Math.abs(d.bottom-s)<.02)),'street door sits on a storey');
 for(const d of b.doors){
  const g=slope.height((d.a.x+d.b.x)/2);
  const mx=(d.a.x+d.b.x)/2,mz=(d.a.z+d.b.z)/2;
  let nx=d.b.z-d.a.z,nz=-(d.b.x-d.a.x),nl=Math.hypot(nx,nz)||1;nx/=nl;nz/=nl;
  if(inside(mx+nx*.4,mz+nz*.4,b.points)){nx=-nx;nz=-nz;}
  const ox=mx+nx*.6,oz=mz+nz*.6;
  assert(d.bottom>=g-.05,`door below ground ${d.bottom} vs ${g} id=${b.id}`);
  assert(d.bottom-g<=3.25,`door ${d.bottom-g}m above ground at ${g}, base ${b.base} storeys ${b.storeys} id=${b.id}`);
  if(d.bottom-g>.45){
   const pad=standHeight(ox,oz,sloped.buildings,slope.height(ox),slopeMap.yards,[]);
   const hasStairs=(slopeMap.stairs||[]).some(s=>Math.abs(s.y1-d.bottom)<.06&&Math.hypot((s.a.x+s.b.x)/2-mx,(s.a.z+s.b.z)/2-mz)<5);
   assert(hasStairs||d.bottom-pad<=STEP_UP+.05,`enter by stairs or filled pad id=${b.id}`);
   if(d.bottom-pad<=STEP_UP+.05){
    assert(!hasStairs,`no stairway when the fill is already door-high id=${b.id}`);
   }
  }
 }
}
assert((slopeMap.stairs||[]).every(s=>{
 const going=2*s.H+s.B;
 return s.B>=.26&&s.H>=.10&&s.H<=.20&&going>=.60&&going<=.64&&s.width>=.8;
}),'stairs follow Israeli riser/tread/width rules');
const fenced=sloped.buildings.find(b=>b.minX>-54&&b.maxX<-26&&b.minZ>-62&&b.maxZ<-34);
assert(fenced,'training slope has a house inside the fence');
const yard=slopeMap.yards.find(y=>inside((fenced.minX+fenced.maxX)/2,(fenced.minZ+fenced.maxZ)/2,y.points));
assert(yard,'fenced leftover is filled to a pad');
assert(Math.abs(yard.top-fenced.fillLevel)<.05,'yard pad is the ground filling level');
const postY=standHeight(-54,-48,sloped.buildings,slope.height(-54),slopeMap.yards,slopeMap.stairs);
assert(postY>=fenced.fillLevel-.08,`fence sits on fill ${postY} vs ${fenced.fillLevel}, ground ${slope.height(-54)}`);
assert(postY-slope.height(-54)>.5,'fence is not planted on raw downhill ground');
{
 const pathX=-50,pathZ=-37,pathG=slope.height(pathX);
 const pathY=standHeight(pathX,pathZ,sloped.buildings,pathG,slopeMap.yards,slopeMap.stairs,null,slopeMap.roads);
 assert(Math.abs(pathY-pathG)<.12,`fill must not bury a walking path ${pathY} vs ${pathG}`);
 const yardRing=closedRing(yard.points)||yard.points;
 assert(!inside(pathX,pathZ,yardRing)||onRoad(pathX,pathZ,slopeMap.roads,.35),'walking path is clipped out of the yard pad');
}
const indoor=slopeMap.stairs.filter(s=>!s.flat&&s.y1-s.y0>.35&&inside((s.a.x+s.b.x)/2,(s.a.z+s.b.z)/2,fenced.points));
assert(indoor.length>=1,'interior flights between storeys');
assert(Math.max(...indoor.map(s=>s.y1))-Math.min(...indoor.map(s=>s.y0))>=3.1,'stairs climb a full storey');
const flight=indoor[0];
{
 const mx=(flight.a.x+flight.b.x)/2,mz=(flight.a.z+flight.b.z)/2,expect=(flight.y0+flight.y1)/2;
 const midY=standHeight(mx,mz,sloped.buildings,slope.height(mx),slopeMap.yards,slopeMap.stairs,flight.y0+.5);
 assert(Math.abs(midY-expect)<.4,`walk the flight, not the upper slab: ${midY} vs ${expect}`);
 const len=Math.hypot(flight.b.x-flight.a.x,flight.b.z-flight.a.z)||1,step=.12/len;
 let prevY=flight.y0;
 for(let t=0;t<=1.001;t+=step){
  const x=flight.a.x+(flight.b.x-flight.a.x)*Math.min(1,t),z=flight.a.z+(flight.b.z-flight.a.z)*Math.min(1,t);
  const y=standHeight(x,z,sloped.buildings,slope.height(x),slopeMap.yards,slopeMap.stairs,prevY);
  assert(y-prevY<=STEP_UP+.02,`stair sample t=${t.toFixed(2)} rises ${y-prevY} from ${prevY} to ${y}`);
  assert(prevY-y<=STEP_UP+.02,`stair sample t=${t.toFixed(2)} drops ${prevY-y} from ${prevY} to ${y}`);
  prevY=y;
 }
 assert(Math.abs(prevY-flight.y1)<=.08,`walk finishes on the flight top ${prevY} vs ${flight.y1}`);
 {
  const arrivals=indoor.filter(s=>fenced.storeys.some(y=>Math.abs(s.y1-y)<.08));
  assert(arrivals.length>=1,'slope house flight arrives on a storey');
  for(const s of arrivals){
   const top=standHeight(s.b.x,s.b.z,sloped.buildings,slope.height(s.b.x),slopeMap.yards,slopeMap.stairs,s.y1);
   assert(top>=s.y1-.08,`slope top nosing is walkable ${top} vs ${s.y1}`);
   const pads=slopeMap.stairs.filter(p=>p.flat&&Math.abs(p.y1-s.y1)<.08&&inside((p.a.x+p.b.x)/2,(p.a.z+p.b.z)/2,fenced.points));
   assert(pads.length>=1,`slope house has a floor landing at ${s.y1}`);
   for(const p of pads){
    const cx=(p.a.x+p.b.x)/2,cz=(p.a.z+p.b.z)/2;
    const stand=standHeight(cx,cz,sloped.buildings,slope.height(cx),slopeMap.yards,slopeMap.stairs,s.y1);
    assert(stand>=s.y1-.08,`walk off slope stair onto the landing ${stand} vs ${s.y1}`);
   }
  }
 }
 assert(indoor.every(s=>(s.n||Math.round((s.y1-s.y0)/s.H))<=16),'indoor flights have at most 16 risers');
 assert(flight.width>=1.1,'interior stairwell is wide enough to walk in top-down');
  const doorStair=slopeMap.stairs.find(s=>!s.flat&&s!==flight&&s.y1-s.y0>.45&&s.y1-s.y0<3.1&&!inside((s.a.x+s.b.x)/2,(s.a.z+s.b.z)/2,fenced.points));
  if(doorStair){
   const t=.4,dx=doorStair.a.x+(doorStair.b.x-doorStair.a.x)*t,dz=doorStair.a.z+(doorStair.b.z-doorStair.a.z)*t;
   const sy=doorStair.y0+(doorStair.y1-doorStair.y0)*t;
   const walk=standHeight(dx,dz,sloped.buildings,slope.height(dx),slopeMap.yards,[doorStair],sy);
   assert(Math.abs(walk-sy)<=STEP_UP+.05||Math.abs(walk-doorStair.y1)<=.05,`door stairs are walkable without a jump ${walk} vs ${sy}`);
   let doorY=doorStair.y0,doorLen=Math.hypot(doorStair.b.x-doorStair.a.x,doorStair.b.z-doorStair.a.z)||1,doorStep=.12/doorLen;
   for(let u=0;u<=1.001;u+=doorStep){
    const x=doorStair.a.x+(doorStair.b.x-doorStair.a.x)*Math.min(1,u),z=doorStair.a.z+(doorStair.b.z-doorStair.a.z)*Math.min(1,u);
    const y=standHeight(x,z,sloped.buildings,slope.height(x),slopeMap.yards,[doorStair],doorY);
    assert(y-doorY<=STEP_UP+.02,`door stair t=${u.toFixed(2)} rises ${y-doorY}`);
    doorY=y;
   }
  }
}
disposeWorld(sw.scene);
{
 const box=(id,x0,z0,x1,z1)=>({id,points:[{x:x0,z:z0},{x:x1,z:z0},{x:x1,z:z1},{x:x0,z:z1}],tags:{},area:(x1-x0)*(z1-z0),height:6.4,levels:2,verified:false,minX:x0,maxX:x1,minZ:z0,maxZ:z1});
 const tight={name:'alley',real:false,lat:null,lon:null,radius:90,cover:[],fences:[],trees:[],yards:[],stairs:[],spawn:{x:5,z:-20},
  buildings:[box(9001,0,0,10,12),box(9002,12,0,22,12)],
  roads:[{width:2,points:[{x:11,z:-30},{x:11,z:30}],name:'',kind:'footway'},{width:6,points:[{x:-20,z:-8},{x:40,z:-8}],name:'',kind:'residential'}]};
 const alleyMap={...tight,terrain:{height:(x)=>-x*.4,real:false,label:'alley slope'}};
 const aw=createWorld(alleyMap);
 const left=tight.buildings.find(b=>b.id===9001),right=tight.buildings.find(b=>b.id===9002);
 assert(left.doors.length&&right.doors.length,'crowded houses still have doors');
 const mid=b=>{const d=b.doors[0];return {x:(d.a.x+d.b.x)/2,z:(d.a.z+d.b.z)/2};};
 const lm=mid(left),rm=mid(right);
 assert(lm.x<9.15,`left door must not face the 2 m alley, got x=${lm.x}`);
 assert(rm.x>12.85,`right door must not face the 2 m alley, got x=${rm.x}`);
 for(const b of [left,right]){
  const d=b.doors[0],mx=(d.a.x+d.b.x)/2,mz=(d.a.z+d.b.z)/2;
  let nx=d.b.z-d.a.z,nz=-(d.b.x-d.a.x),nl=Math.hypot(nx,nz)||1;nx/=nl;nz/=nl;
  if(inside(mx+nx*.4,mz+nz*.4,b.points)){nx=-nx;nz=-nz;}
  const other=b===left?right:left;
  for(const out of [.5,.9,1.8,2.7])assert(!inside(mx+nx*out,mz+nz*out,other.points),`approach ${out}m from door ${b.id} hits the neighbour`);
  const stair=(alleyMap.stairs||[]).find(s=>Math.hypot(s.b.x-mx,s.b.z-mz)<1.2);
  if(stair){
   let gap=Infinity;
   for(let i=0;i<other.points.length;i++){
    gap=Math.min(gap,segmentDistance(stair.a.x,stair.a.z,other.points[i],other.points[(i+1)%other.points.length]));
    if(inside(stair.a.x,stair.a.z,other.points))gap=0;
   }
   assert(gap>=.85,`stair foot for ${b.id} needs walking room beside the neighbour, gap ${gap}`);
  }
 }
 disposeWorld(aw.scene);
}
const html=fs.readFileSync('dist/index.html','utf8'),js=fs.readFileSync('dist/game.js','utf8');const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));for(const match of js.matchAll(/\$\('([^']+)'\)/g))assert(ids.has(match[1]),`Missing DOM id: ${match[1]}`);
const data=JSON.parse(fs.readFileSync('dist/initial-map.json','utf8'));
const real=convert(data,LOCATIONS[0].lat,LOCATIONS[0].lon,LOCATIONS[0].name);
const lot856=real.fences.find(f=>String(f.id)==='yard-665202856');
if(lot856){
 const ring=closedRing(lot856.points)||lot856.points.slice(0,-1);
 let buried=0;
 for(const road of real.roads.filter(r=>['footway','path','steps','pedestrian','cycleway'].includes(r.kind))){
  for(let i=1;i<road.points.length;i++){
   const a=road.points[i-1],c=road.points[i],len=Math.hypot(c.x-a.x,c.z-a.z),steps=Math.max(1,Math.ceil(len/1.4));
   for(let k=0;k<=steps;k++){
    const t=k/steps,x=a.x+(c.x-a.x)*t,z=a.z+(c.z-a.z)*t;
    if(inside(x,z,ring))buried++;
   }
  }
 }
 assert(!buried,`inferred yard 665202856 covers ${buried} footway samples`);
}
const raster=new Uint8ClampedArray(64*64*4).fill(120);
for(let y=8;y<20;y++)for(let x=8;x<24;x++){const i=(y*64+x)*4;raster[i]=190;raster[i+1]=90;raster[i+2]=60;raster[i+3]=255;}
for(let y=36;y<44;y++)for(let x=36;x<44;x++){const i=(y*64+x)*4;raster[i]=40;raster[i+1]=110;raster[i+2]=50;raster[i+3]=255;}
const photo=analyzeRaster(raster,64,64,200);
assert(photo.buildings.length>=1,`photo roofs: ${photo.buildings.length}`);
assert(photo.trees.length>=1,`photo trees: ${photo.trees.length}`);
assert(photo.roads.length>=1);
assert.equal(parseScale('1:500'),500);
assert.equal(parseScale('1:3000'),3000);
assert.throws(()=>parseScale('2:500'));
const photoM=photoSpanMeters({width:2000,height:1500},500);
assert(photoM>200&&photoM<400,`1:500 on a 2000px image should be a few hundred metres, got ${photoM}`);
for(const file of ['game.js','world.js','map-model.js','terrain.js','three.module.js','style.css','sprites.png','initial-map.json','telaviv-map.json','credits.html','Soldier.glb','characters.js','GLTFLoader.js','SkeletonUtils.js','BufferGeometryUtils.js','weapons.js','controls.js','satellite.js','photo-stage.js','icon.png','satellite-9789-6668.jpg','satellite-9774-6649.jpg'])assert(fs.existsSync(`dist/${file}`),`Missing asset ${file}`);
console.log('Coordinate validation, terrain decoding, map geometry, collision spawn and local assets passed. Browser/mobile interaction QA not performed.');
