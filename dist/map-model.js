export const INITIAL = [31.163931271887215, 34.53230754534885];
export const LOCATIONS = [
 {name:'Your selected area',lat:31.714529247844197,lon:35.10143442409436,file:'initial-map.json'},
 {name:'Tel Aviv',lat:32.0668,lon:34.7731,file:'telaviv-map.json'}
];
export const STEP_UP=.42,PLAYER_STAND=1.72,PLAYER_CROUCH=1.08,FLOOR_SLAB=.36;
export function coordinates(value){
 const parts=String(value).trim().split(/[,\s]+/);
 if(parts.length!==2||parts.some(v=>v===''))throw Error('Enter two numbers: latitude, longitude.');
 const [lat,lon]=parts.map(Number);
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>80||Math.abs(lon)>180)throw Error('Use a latitude between −80 and 80 and longitude between −180 and 180.');
 return [lat,lon];
}
export function inside(x,z,points){let c=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if(((a.z>z)!==(b.z>z))&&(x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x))c=!c;}return c;}
export function segmentDistance(x,z,a,b){const dx=b.x-a.x,dz=b.z-a.z;const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-a.x-t*dx,z-a.z-t*dz);}
export function polygonArea(p){let a=0;for(let i=0,j=p.length-1;i<p.length;j=i++)a+=p[j].x*p[i].z-p[i].x*p[j].z;return Math.abs(a/2);}
export function closedRing(points){
 if(points.length<4)return null;
 if(Math.hypot(points[0].x-points.at(-1).x,points[0].z-points.at(-1).z)>.8)return null;
 const ring=points.slice(0,-1);
 return ring.length>=3?ring:null;
}
function uhash(n){n=Math.imul(n^n>>>16,2246822507);n=Math.imul(n^n>>>13,3266489909);return ((n^n>>>16)>>>0)/4294967296;}
export function fenceKind(tags){
 const b=tags.barrier;
 if(['gate','stile','entrance','lift_gate','swing_gate','hampshire_gate'].includes(b))return null;
 if(['fence','wall','hedge','retaining_wall','city_wall','guard_rail'].includes(b))return b;
 if(tags.natural==='hedge')return 'hedge';
 return null;
}
export function markFenceOpening(f){
 const ring=closedRing(f.points);
 f.closed=!!ring;
 delete f.opening;
 if(!ring)return f;
 let best=0,idx=-1;
 for(let i=1;i<f.points.length;i++){
  const len=Math.hypot(f.points[i].x-f.points[i-1].x,f.points[i].z-f.points[i-1].z);
  if(len>best){best=len;idx=i;}
 }
 if(idx<0||best<3.4)return f;
 const half=Math.min(1.15,best*.28);
 f.opening={i:idx,t0:.5-half/best,t1:.5+half/best};
 return f;
}
function fenceHits(x,z,f,r){
 const thick=(f.width||.08)/2+r,pts=f.points,open=f.opening;
 for(let i=1;i<pts.length;i++){
  const a=pts[i-1],b=pts[i];
  if(open&&open.i===i){
   const dx=b.x-a.x,dz=b.z-a.z;
   const p0={x:a.x+dx*open.t0,z:a.z+dz*open.t0},p1={x:a.x+dx*open.t1,z:a.z+dz*open.t1};
   if(segmentDistance(x,z,a,p0)<thick||segmentDistance(x,z,p1,b)<thick)return true;
   continue;
  }
  if(segmentDistance(x,z,a,b)<thick)return true;
 }
 return false;
}
export function blocked(x,z,buildings,r=.55,context){
 const fences=context?.fences||[],trees=context?.trees||[];
 const playerY=context?.y,playerH=context?.h??PLAYER_STAND,playerTop=(playerY??0)+playerH;
 if(buildings.some(b=>{
  if(x<b.minX-r||x>b.maxX+r||z<b.minZ-r||z>b.maxZ+r)return false;
  if(b.doors&&playerY!=null){
   for(const d of b.doors){
    if(segmentDistance(x,z,d.a,d.b)<(d.thick||.22)+r)return playerY<d.bottom-STEP_UP||playerTop>d.top+.03;
   }
  }
  if(b.shell)return b.shell.some(w=>segmentDistance(x,z,w.a,w.b)<(w.thick||.22)+r);
  return inside(x,z,b.points)||b.points.some((p,i)=>segmentDistance(x,z,p,b.points[(i+1)%b.points.length])<r);
 }))return true;
 for(const f of fences)if(fenceHits(x,z,f,r))return true;
 for(const t of trees)if(Math.hypot(x-t.x,z-t.z)<.36+r)return true;
 return false;
}
export function lowHeadroom(x,z,buildings,y,stairs){
 const top=y+PLAYER_STAND;
 const ceil=ceilingAt(x,z,buildings,y,stairs);
 if(ceil!=null&&ceil<top-.02)return true;
 for(const b of buildings||[]){
  if(!b.doors||x<(b.minX??-1e9)-1||x>(b.maxX??1e9)+1||z<(b.minZ??-1e9)-1||z>(b.maxZ??1e9)+1)continue;
  for(const d of b.doors){
   if(segmentDistance(x,z,d.a,d.b)<(d.thick||.22)+.52&&top>d.top+.03)return true;
  }
 }
 return false;
}
function inStairWell(x,z,s,r=.28){
 if(!s)return false;
 const half=(s.width||1.1)/2+r;
 if(segmentDistance(x,z,s.a,s.b)<=half)return true;
 const rings=[s.well,...(s.holes||[])].filter(h=>h&&h.length>=3);
 for(const ring of rings){
  if(inside(x,z,ring))return true;
  if(ring.some((p,i)=>segmentDistance(x,z,p,ring[(i+1)%ring.length])<r))return true;
 }
 return false;
}
function stairCovers(s,playerY){
 const lo=Math.min(s.wellY0??s.y0,s.y0),hi=Math.max(s.wellY1??s.y1,s.y1);
 return playerY>=lo-.35&&playerY<=hi+.45;
}
export function inWellVoid(x,z,stairs,y){
 let inWell=false;
 for(const s of stairs||[]){
  if(!stairCovers(s,y)||!inStairWell(x,z,s))continue;
  inWell=true;
  const half=(s.width||1.1)/2+.24;
  if(segmentDistance(x,z,s.a,s.b)<=half)return false;
  if(Math.hypot(x-s.b.x,z-s.b.z)<half+.8&&Math.abs(y-(s.y1??0))<=STEP_UP+.12)return false;
 }
 return inWell;
}
export function standHeight(x,z,buildings,groundY,yards,stairs,playerY,roads){
 let y=groundY,stairY=-Infinity,onFlight=false,bestScore=Infinity;
 const paved=roads&&onRoad(x,z,roads,.35);
 for(const yard of yards||[]){
  if(paved)break;
  if(x<yard.minX-.4||x>yard.maxX+.4||z<yard.minZ-.4||z>yard.maxZ+.4)continue;
  const ring=yard.points,onLot=inside(x,z,ring)||ring.some((p,i)=>segmentDistance(x,z,p,ring[(i+1)%ring.length])<.35);
  if(onLot)y=Math.max(y,yard.top);
 }
 for(const s of stairs||[]){
  const half=(s.width||1.5)/2+.18;
  const onRun=segmentDistance(x,z,s.a,s.b)<=half;
  const nearTop=Math.hypot(x-s.b.x,z-s.b.z)<half+.85;
  if(!onRun&&!(nearTop&&(playerY==null||Math.abs(playerY-s.y1)<=STEP_UP+.2)))continue;
  const dx=s.b.x-s.a.x,dz=s.b.z-s.a.z,len2=dx*dx+dz*dz||1,run=Math.sqrt(len2);
  const tRaw=((x-s.a.x)*dx+(z-s.a.z)*dz)/len2;
  if(s.flat||Math.abs((s.y1??0)-(s.y0??0))<.05){
   const sy=s.y1,score=playerY==null?-sy:Math.abs(sy-playerY);
   if(score<bestScore){bestScore=score;stairY=sy;onFlight=false;}
   continue;
  }
  const t=Math.max(0,Math.min(1,tRaw));
  const tLand=Math.max(.62,1-Math.min(run*.28,.85)/run);
  const onLanding=!onRun||t>=tLand||tRaw>=.92||(nearTop&&tRaw>.7)||tRaw>1;
  const sy=onLanding?s.y1:s.y0+(s.y1-s.y0)*(t/tLand);
  const score=playerY==null?-sy:Math.abs(sy-playerY);
  if(score<bestScore){bestScore=score;stairY=sy;onFlight=onRun&&tRaw>.02&&!onLanding;}
 }
 if(stairY>-Infinity)y=Math.max(y,stairY);
 const openWells=(stairs||[]).filter(s=>inStairWell(x,z,s));
 for(const b of buildings){
  if(b.base==null||x<b.minX||x>b.maxX||z<b.minZ||z>b.maxZ||!inside(x,z,b.points))continue;
  const floors=b.storeys?.length?b.storeys:[b.base];
  let floor=-Infinity;
  if(playerY==null)floor=floors[0];
  else{
   for(const f of floors){
    if(openWells.some(s=>stairCovers(s,f-.2)&&(s.wellY0??s.y0)+.05<f&&f<=(s.wellY1??s.y1)+.02))continue;
    if(f<=playerY+STEP_UP&&f>=floor)floor=f;
   }
   if(floor===-Infinity){
    let best=Infinity;
    for(const f of floors){const d=Math.abs(f-playerY);if(d<best){best=d;floor=f;}}
   }
  }
  if(onFlight&&floor>stairY+.02)continue;
  if(floor>-Infinity)y=Math.max(y,floor);
 }
 return y;
}
export function ceilingAt(x,z,buildings,playerY,stairs){
 if(playerY==null)return null;
 for(const b of buildings){
  if(b.base==null||x<b.minX||x>b.maxX||z<b.minZ||z>b.maxZ||!inside(x,z,b.points))continue;
  const on=(stairs||[]).find(s=>inStairWell(x,z,s)&&stairCovers(s,playerY));
  const floors=[...new Set(b.storeys||[b.base])].sort((a,c)=>a-c);
  const next=floors.find(f=>f>playerY+STEP_UP+.12);
  if(on){
   const top=Math.max(on.wellY1??-Infinity,on.y1??-Infinity);
   const above=floors.find(f=>f>top+.12);
   return above==null?b.base+(b.height||3.2)-FLOOR_SLAB:above-FLOOR_SLAB;
  }
  if(next==null)return b.base+(b.height||3.2)-FLOOR_SLAB;
  return next-FLOOR_SLAB;
 }
 return null;
}
function record(points,tags,id){const area=polygonArea(points);if(area<14||area>18000)return null;const levels=Number(tags['building:levels']);const mappedHeight=parseFloat(tags.height);const verified=Number.isFinite(mappedHeight)&&mappedHeight>0||Number.isFinite(levels)&&levels>0;const floors=Number.isFinite(levels)&&levels>0?Math.max(1,Math.round(levels)):Number.isFinite(mappedHeight)&&mappedHeight>0?Math.max(1,Math.round(mappedHeight/3.2)):2+(Number(id)%3===0?1:0);const h=Number.isFinite(mappedHeight)&&mappedHeight>0?mappedHeight:floors*3.2;return {id,points,tags,area,height:Math.min(90,Math.max(2.6,h)),levels:Math.min(28,floors),verified:!!verified,minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z))};}
export function landKind(tags){
 const n=tags.natural,l=tags.landuse,lei=tags.leisure;
 if(['water','bay','strait','wetland'].includes(n)||['reservoir','basin','salt_pond'].includes(l))return 'water';
 if(['wood','forest','scrub'].includes(n)||['forest','wood'].includes(l))return 'forest';
 if(['grassland','heath','fell'].includes(n)||['grass','meadow','farmland','orchard','vineyard','greenfield','recreation_ground','village_green','allotments'].includes(l)||['park','garden','pitch','golf_course','recreation_ground','playground','common'].includes(lei))return 'park';
 return null;
}
function nearRoad(x,z,roads,tol){
 return (roads||[]).some(r=>{
  for(let i=1;i<r.points.length;i++)if(segmentDistance(x,z,r.points[i-1],r.points[i])<(r.width||6)/2+tol)return true;
  return false;
 });
}
export function onRoad(x,z,roads,extra=.45){return nearRoad(x,z,roads,extra);}
function edgeHitsRoad(x0,z0,x1,z1,roads,extra){
 const len=Math.hypot(x1-x0,z1-z0),n=Math.max(2,Math.ceil(len/1.1));
 for(let i=0;i<=n;i++){const t=i/n;if(nearRoad(x0+(x1-x0)*t,z0+(z1-z0)*t,roads,extra))return true;}
 return false;
}
export function pullRingOffRoads(ring,roads,extra=.7){
 if(!ring||ring.length<3||!(roads||[]).length)return ring;
 const dense=[];
 for(let i=0;i<ring.length;i++){
  const a=ring[i],b=ring[(i+1)%ring.length],len=Math.hypot(b.x-a.x,b.z-a.z)||1,n=Math.max(1,Math.ceil(len/1.3));
  for(let k=0;k<n;k++)dense.push({x:a.x+(b.x-a.x)*k/n,z:a.z+(b.z-a.z)*k/n});
 }
 const cx=dense.reduce((s,p)=>s+p.x,0)/dense.length,cz=dense.reduce((s,p)=>s+p.z,0)/dense.length;
 const out=[];
 for(const p of dense){
  let x=p.x,z=p.z;
  for(let n=0;n<12&&nearRoad(x,z,roads,extra);n++){
   const dx=cx-x,dz=cz-z,L=Math.hypot(dx,dz)||1;
   x+=dx/L*.4;z+=dz/L*.4;
  }
  if(nearRoad(x,z,roads,extra*.55))continue;
  const last=out.at(-1);if(last&&Math.hypot(x-last.x,z-last.z)<.35)continue;
  out.push({x,z});
 }
 if(out.length<3||polygonArea(out)<8)return null;
 return out;
}
function inferYardFences(buildings,fences,trees,roads){
 const houses=buildings.filter(b=>b.area>=40&&b.area<=320&&b.levels<=3);
 if(!houses.length||fences.length>houses.length*.2)return;
 for(const b of houses){
  const cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2;
  if(fences.some(f=>{const ring=closedRing(f.points);return ring&&inside(cx,cz,ring);}))continue;
  const pad=3.4+(Number(b.id||0)%5)*.35,extra=.7;
  let minX=b.minX-pad,maxX=b.maxX+pad,minZ=b.minZ-pad,maxZ=b.maxZ+pad;
  for(let n=0;n<48&&edgeHitsRoad(minX,minZ,minX,maxZ,roads,extra);n++)minX=Math.min(b.minX-.3,minX+.25);
  for(let n=0;n<48&&edgeHitsRoad(maxX,minZ,maxX,maxZ,roads,extra);n++)maxX=Math.max(b.maxX+.3,maxX-.25);
  for(let n=0;n<48&&edgeHitsRoad(minX,minZ,maxX,minZ,roads,extra);n++)minZ=Math.min(b.minZ-.3,minZ+.25);
  for(let n=0;n<48&&edgeHitsRoad(minX,maxZ,maxX,maxZ,roads,extra);n++)maxZ=Math.max(b.maxZ+.3,maxZ-.25);
  if(maxX-minX<b.maxX-b.minX+.45||maxZ-minZ<b.maxZ-b.minZ+.45)continue;
  if(edgeHitsRoad(minX,minZ,maxX,minZ,roads,extra)||edgeHitsRoad(minX,maxZ,maxX,maxZ,roads,extra)||edgeHitsRoad(minX,minZ,minX,maxZ,roads,extra)||edgeHitsRoad(maxX,minZ,maxX,maxZ,roads,extra))continue;
  if(buildings.some(o=>o!==b&&o.minX<maxX-.9&&o.maxX>minX+.9&&o.minZ<maxZ-.9&&o.maxZ>minZ+.9))continue;
  const pts=[{x:minX,z:minZ},{x:maxX,z:minZ},{x:maxX,z:maxZ},{x:minX,z:maxZ},{x:minX,z:minZ}];
  if(pts.some(p=>nearRoad(p.x,p.z,roads,1.2)))continue;
  let cut=false;
  for(const r of roads||[]){
   for(let i=1;!cut&&i<r.points.length;i++){
    const a=r.points[i-1],c=r.points[i],len=Math.hypot(c.x-a.x,c.z-a.z),steps=Math.max(1,Math.ceil(len/2));
    for(let k=0;k<=steps;k++){
     const t=k/steps,x=a.x+(c.x-a.x)*t,z=a.z+(c.z-a.z)*t;
     if(x>minX&&x<maxX&&z>minZ&&z<maxZ&&!inside(x,z,b.points)){cut=true;break;}
    }
   }
  }
  if(cut)continue;
  fences.push(markFenceOpening({id:`yard-${b.id}`,points:pts,kind:'fence',width:.08,height:1.15,inferred:true}));
  const candidates=[{x:minX+1.3,z:minZ+1.3},{x:maxX-1.3,z:minZ+1.3},{x:minX+1.3,z:maxZ-1.3}];
  for(const p of candidates){
   if(inside(p.x,p.z,b.points)||nearRoad(p.x,p.z,roads,1.2)||trees.some(t=>Math.hypot(t.x-p.x,t.z-p.z)<4))continue;
   trees.push({x:p.x,z:p.z,h:4.8+(Number(b.id||0)%4)*.7,scattered:true});
   break;
  }
 }
}
function scatterForest(cover,buildings,existing){
 const trees=existing.slice();
 const taken=existing.map(t=>[t.x,t.z]);
 for(const patch of cover){
  if(patch.kind!=='forest'&&patch.kind!=='park')continue;
  const density=patch.kind==='forest'?70:160;
  const want=Math.min(patch.kind==='forest'?36:10,Math.max(patch.kind==='forest'?3:0,Math.floor(patch.area/density)));
  if(!want)continue;
  const seed=Math.abs((patch.minX*17|0)^(patch.minZ*31|0)^(patch.area|0));
  let added=0;
  for(let i=0;i<want*8&&added<want&&trees.length<180;i++){
   const x=patch.minX+uhash(seed+i*3)*(patch.maxX-patch.minX);
   const z=patch.minZ+uhash(seed+i*3+1)*(patch.maxZ-patch.minZ);
   if(!inside(x,z,patch.points)||buildings.some(b=>x>=b.minX-1.2&&x<=b.maxX+1.2&&z>=b.minZ-1.2&&z<=b.maxZ+1.2&&inside(x,z,b.points)))continue;
   if(taken.some(p=>Math.hypot(x-p[0],z-p[1])<5.5))continue;
   trees.push({x,z,h:4.4+uhash(seed+i*3+2)*4.2,scattered:true});
   taken.push([x,z]);added++;
  }
 }
 return trees;
}
export function convert(data,lat,lon,name='Selected coordinates'){
 const cos=Math.cos(lat*Math.PI/180),project=p=>({x:(p.lon-lon)*111320*cos,z:(lat-p.lat)*111320});
 const buildings=[],roads=[],cover=[],fences=[],trees=[];
 for(const e of data.elements||[]){
  const tags=e.tags||{};
  if((e.type==='node'||(!e.geometry&&Number.isFinite(e.lat)))&&tags.natural==='tree'){
   const p=project({lat:e.lat,lon:e.lon});
   if(Number.isFinite(p.x)&&Number.isFinite(p.z)&&Math.hypot(p.x,p.z)<210)trees.push({x:p.x,z:p.z,h:4.2+(Number(e.id||0)%7)*.65});
   continue;
  }
  if(!e.geometry)continue;
  let points=e.geometry.map(project).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.z));if(points.length<2)continue;
  if(tags.building&&tags.building!=='no'&&points.length>=4){const ring=closedRing(points);if(!ring)continue;const b=record(ring,tags,e.id);if(b&&b.minX<210&&b.maxX>-210&&b.minZ<210&&b.maxZ>-210)buildings.push(b);}
  else if(tags.highway&&!['proposed','construction'].includes(tags.highway)){const width=Number(tags.width)||(['footway','path','steps','cycleway'].includes(tags.highway)?2:['residential','service','living_street'].includes(tags.highway)?6:8);roads.push({points,width:Math.min(16,Math.max(1.5,width)),name:tags['name:en']||tags.name||'',kind:tags.highway});}
  else if(fenceKind(tags)&&points.length>=2){
   const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minZ=Math.min(...points.map(p=>p.z)),maxZ=Math.max(...points.map(p=>p.z));
   if(minX<210&&maxX>-210&&minZ<210&&maxZ>-210){
    const kind=fenceKind(tags);
    fences.push(markFenceOpening({id:e.id,points,kind,width:kind==='hedge'?.38:kind==='wall'||kind==='retaining_wall'?.22:.08,height:Number(tags.height)||(kind==='hedge'?1.45:kind==='wall'?1.6:1.15)}));
   }
  }
  else if(tags.natural==='tree_row'){
   for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],len=Math.hypot(b.x-a.x,b.z-a.z),steps=Math.max(1,Math.ceil(len/6.5));
    for(let k=0;k<=steps;k++){const t=k/steps,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;if(Math.hypot(x,z)<210)trees.push({x,z,h:4.8+(i+k)%4*.6});}
   }
  }
  else {const kind=landKind(tags),ring=closedRing(points);if(!kind||!ring)continue;const area=polygonArea(ring),minX=Math.min(...ring.map(p=>p.x)),maxX=Math.max(...ring.map(p=>p.x)),minZ=Math.min(...ring.map(p=>p.z)),maxZ=Math.max(...ring.map(p=>p.z));if(area>=20&&area<=120000&&minX<210&&maxX>-210&&minZ<210&&maxZ>-210)cover.push({kind,points:ring,area,minX,maxX,minZ,maxZ});}
 }
 if(buildings.length<3||roads.length<1)throw Error('Insufficient mapped buildings or roads here. Choose a nearby built-up area. No fictional streets were substituted.');
 inferYardFences(buildings,fences,trees,roads);
 const map={name,lat,lon,buildings,roads,cover,fences,trees:scatterForest(cover,buildings,trees),yards:[],stairs:[],real:true,radius:195};map.spawn=findSpawn(map);return map;
}
export function findSpawn(map){let best=null,bestD=Infinity;for(const road of map.roads){for(let i=1;i<road.points.length;i++){const a=road.points[i-1],b=road.points[i];const length=Math.hypot(a.x-b.x,a.z-b.z),steps=Math.max(1,Math.ceil(length/4));for(let j=0;j<=steps;j++){const t=j/steps,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t,d=Math.hypot(x,z);if(d<bestD&&d<map.radius-5&&!blocked(x,z,map.buildings,1,{fences:map.fences,trees:map.trees})){best={x,z};bestD=d;}}}}if(!best)throw Error('No safe playable spawn was found on these mapped roads. Try another location.');return best;}
export function fromXML(text){
 const doc=new DOMParser().parseFromString(text,'text/xml');
 if(doc.querySelector('parsererror'))throw Error('The map service returned invalid data.');
 const nodeEls=[...doc.querySelectorAll('osm > node')];
 const nodes=new Map(nodeEls.map(n=>[n.getAttribute('id'),{lat:Number(n.getAttribute('lat')),lon:Number(n.getAttribute('lon'))}]));
 const ways=[...doc.querySelectorAll('osm > way')].map(w=>({id:w.getAttribute('id'),type:'way',tags:Object.fromEntries([...w.querySelectorAll('tag')].map(t=>[t.getAttribute('k'),t.getAttribute('v')])),geometry:[...w.querySelectorAll('nd')].map(n=>nodes.get(n.getAttribute('ref'))).filter(Boolean)}));
 const tagged=nodeEls.filter(n=>n.querySelector('tag')).map(n=>{
  const tags=Object.fromEntries([...n.querySelectorAll('tag')].map(t=>[t.getAttribute('k'),t.getAttribute('v')]));
  return {id:n.getAttribute('id'),type:'node',lat:Number(n.getAttribute('lat')),lon:Number(n.getAttribute('lon')),tags};
 }).filter(n=>n.tags.natural==='tree');
 return {elements:[...ways,...tagged]};
}
export function training(){
 const buildings=[];let id=1;
 for(const x of [-40,-19,19,40])for(const z of [-48,-22,7,35]){const small=id%5===2;const w=small?5.6:12+(id%3),d=small?8:16;const b=record([{x:x-w/2,z:z-d/2},{x:x+w/2,z:z-d/2},{x:x+w/2,z:z+d/2},{x:x-w/2,z:z+d/2}],small?{'building:levels':'1'}:{},id++);b.verified=false;buildings.push(b);}
 const fences=[markFenceOpening({id:'train-fence',kind:'fence',width:.08,height:1.15,points:[{x:-54,z:-62},{x:-26,z:-62},{x:-26,z:-34},{x:-54,z:-34},{x:-54,z:-62}]})];
 const trees=[{x:8,z:14,h:6.1},{x:-9,z:20,h:5.2},{x:24,z:-12,h:7},{x:-22,z:8,h:5.6},{x:12,z:-28,h:6.4}];
 return {name:'Training yard',real:false,lat:null,lon:null,radius:90,buildings,cover:[],fences,trees,yards:[],stairs:[],spawn:{x:0,z:25},roads:[{width:9,points:[{x:0,z:-95},{x:0,z:95}],name:'TRAINING',kind:'residential'},{width:7,points:[{x:-90,z:-7},{x:90,z:-7}],name:'',kind:'residential'},{width:6,points:[{x:-90,z:53},{x:90,z:53}],name:'',kind:'residential'}]};
}
