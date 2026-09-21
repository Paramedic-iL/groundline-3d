import * as T from './three.module.js';
import {inside,segmentDistance,closedRing,polygonArea,standHeight,STEP_UP,pullRingOffRoads,FLOOR_SLAB} from './map-model.js?v=well-v8';
import {mergeGeometries} from './BufferGeometryUtils.js';
const V=(x,y,z)=>new T.Vector3(x,y,z);
const mat=(color,extra={})=>new T.MeshStandardMaterial({color,roughness:.95,...extra});
function mesh(geometry,material,parent,x=0,y=0,z=0){const m=new T.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=false;m.receiveShadow=true;parent.add(m);return m;}
function commit(geoms,material,scene,walls,flags={}){
 if(!geoms.length)return;
 const g=mergeGeometries(geoms);if(!g)return;
 const m=new T.Mesh(g,material);m.castShadow=flags.cast!==false;m.receiveShadow=flags.receive!==false;scene.add(m);
 if(flags.occlude!==false)walls.push(m);
 for(const x of geoms)x.dispose();
}
function box(parent,w,h,d,color,x,y,z){return mesh(new T.BoxGeometry(w,h,d),mat(color),parent,x,y,z);}
function createDetailTexture(){
 const n=256,data=new Uint8Array(n*n*4);let seed=0x9e3779b9;
 const rnd=()=>{seed=Math.imul(seed,1664525)+1013904223>>>0;return seed/0xffffffff;};
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const i=(y*n+x)*4,grain=.52+rnd()*.28+.12*Math.sin(x*.37)*Math.sin(y*.31),speck=rnd()<.045?.22:0;
  const v=Math.max(0,Math.min(255,(grain-speck)*255));
  data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;
 }
 const texture=new T.DataTexture(data,n,n,T.RGBAFormat);
 texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.needsUpdate=true;texture.colorSpace='';
 return texture;
}
const WHITE=(()=>{const t=new T.DataTexture(new Uint8Array([255,255,255,255]),1,1,T.RGBAFormat);t.needsUpdate=true;t.colorSpace=T.SRGBColorSpace;return t;})();
function groundMaterial(satellite){
 const draped=!!satellite?.texture,detail=createDetailTexture();
 const material=mat(0xffffff,{map:draped?satellite.texture:WHITE,vertexColors:!draped,roughness:draped?.88:.95});
 material.onBeforeCompile=shader=>{
  shader.uniforms.detailMap={value:detail};
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>','#include <common>\nuniform sampler2D detailMap;')
   .replace('#include <color_fragment>','#include <color_fragment>\n{\n vec3 groundDetail=texture2D(detailMap,vMapUv*240.0).rgb;\n diffuseColor.rgb*=mix(vec3(0.80),vec3(1.14),groundDetail);\n}');
 };
 material.customProgramCacheKey=()=>`ground-detail-${draped?'sat':'flat'}`;
 material.userData.detail=detail;
 return material;
}
function addSky(scene){
 const geometry=new T.SphereGeometry(430,40,20),pos=geometry.attributes.position,colors=[];
 for(let i=0;i<pos.count;i++){
  const y=pos.getY(i),t=Math.max(0,Math.min(1,(y+30)/260));
  const c=new T.Color().lerpColors(new T.Color('#c5d0cc'),new T.Color('#6d92b8'),t*t);
  if(y<0)c.set('#8c988e');
  colors.push(c.r,c.g,c.b);
 }
 geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
 geometry.scale(-1,1,1);
 const sky=new T.Mesh(geometry,new T.MeshBasicMaterial({vertexColors:true,depthWrite:false,fog:false}));
 sky.renderOrder=-1;sky.raycast=()=>{};scene.add(sky);
 scene.background=new T.Color('#b9c6c6');
 scene.fog=new T.Fog('#b9c6c6',155,355);
}
function paintCover(groundGeo,map){
 const cover=map.cover||[];if(!cover.length)return;
 const canvas=map.satellite?.texture?.image;
 if(canvas?.getContext){
  const ctx=canvas.getContext('2d'),dim=canvas.width,size=480;
  const px=(x,z)=>[(x+size/2)/size*dim,(size/2-z)/size*dim];
  for(const patch of cover){
   if(patch.points.length<3)continue;
   ctx.beginPath();
   patch.points.forEach((p,i)=>{const q=px(p.x,p.z);i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);});
   ctx.closePath();
   ctx.fillStyle=patch.kind==='water'?'rgba(32,74,88,0.32)':patch.kind==='forest'?'rgba(36,72,34,0.2)':'rgba(58,98,42,0.16)';
   ctx.fill();
  }
  map.satellite.texture.needsUpdate=true;
  return;
 }
 const pos=groundGeo.attributes.position,colors=groundGeo.attributes.color;
 for(let i=0;i<pos.count;i++){
  const x=pos.getX(i),z=pos.getZ(i);
  for(const patch of cover){
   if(x<patch.minX||x>patch.maxX||z<patch.minZ||z>patch.maxZ||!inside(x,z,patch.points))continue;
   if(patch.kind==='water')colors.setXYZ(i,.18,.32,.36);
   else if(patch.kind==='forest')colors.setXYZ(i,.22,.32,.18);
   else colors.setXYZ(i,.32,.42,.22);
   break;
  }
 }
 colors.needsUpdate=true;
}
function wallRects(len,height,holes){
 const xs=[0,len];
 for(const h of holes){xs.push(h.x,h.x+h.w);}
 const unique=[...new Set(xs.map(v=>Math.round(Math.max(0,Math.min(len,v))*1000)/1000))].sort((a,b)=>a-b);
 const rects=[];
 for(let i=0;i<unique.length-1;i++){
  const x0=unique[i],x1=unique[i+1];if(x1-x0<.04)continue;
  const ys=[0,height];
  for(const h of holes){if(h.x<x1-.02&&h.x+h.w>x0+.02){ys.push(h.y,h.y+h.h);}}
  const uy=[...new Set(ys.map(v=>Math.round(Math.max(0,Math.min(height,v))*1000)/1000))].sort((a,b)=>a-b);
  for(let j=0;j<uy.length-1;j++){
   const y0=uy[j],y1=uy[j+1];if(y1-y0<.04)continue;
   const cx=(x0+x1)/2,cy=(y0+y1)/2;
   if(holes.some(h=>cx>h.x&&cx<h.x+h.w&&cy>h.y&&cy<h.y+h.h))continue;
   rects.push({x0,x1,y0,y1});
  }
 }
 return rects;
}
function addWater(scene,map,height){
 for(const patch of (map.cover||[]).filter(p=>p.kind==='water'&&p.points.length>=3&&p.points.length<=48).slice(0,12)){
  try{
   const mean=patch.points.reduce((s,p)=>s+height(p.x,p.z),0)/patch.points.length;
   const shape=new T.Shape(patch.points.map(p=>new T.Vector2(p.x,-p.z)));
   const geometry=new T.ExtrudeGeometry(shape,{depth:.06,bevelEnabled:false});
   const material=new T.MeshStandardMaterial({color:0x2a4d58,roughness:.16,metalness:.28,transparent:true,opacity:.62,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});
   const water=new T.Mesh(geometry,material);
   water.rotation.x=-Math.PI/2;water.position.y=mean+.05;water.castShadow=false;water.receiveShadow=true;water.raycast=()=>{};scene.add(water);
  }catch{/* skip degenerate OSM rings */}
 }
}
function addYards(scene,map,height){
 const padMat=mat(0x8d8774);
 for(const yard of map.yards||[]){
  if(yard.points.length<3)continue;
  try{
   const low=Math.min(...yard.points.map(q=>height(q.x,q.z)))-.08;
   const depth=Math.max(.12,yard.top-low);
   const shape=new T.Shape(yard.points.map(q=>new T.Vector2(q.x,-q.z)));
   for(const r of map.roads||[]){
    const half=(r.width||6)/2+.5;
    for(let i=1;i<r.points.length;i++){
     const a=r.points[i-1],b=r.points[i],len=Math.hypot(b.x-a.x,b.z-a.z);if(len<.4)continue;
     const nx=-(b.z-a.z)/len*half,nz=(b.x-a.x)/len*half;
     const hole=[{x:a.x+nx,z:a.z+nz},{x:b.x+nx,z:b.z+nz},{x:b.x-nx,z:b.z-nz},{x:a.x-nx,z:a.z-nz}];
     if(!hole.every(p=>inside(p.x,p.z,yard.points)))continue;
     const path=new T.Path();
     path.moveTo(hole[0].x,-hole[0].z);
     for(let k=1;k<hole.length;k++)path.lineTo(hole[k].x,-hole[k].z);
     path.closePath();shape.holes.push(path);
    }
   }
   const pad=mesh(new T.ExtrudeGeometry(shape,{depth,bevelEnabled:false}),padMat,scene,0,low,0);
   pad.rotation.x=-Math.PI/2;pad.castShadow=false;
  }catch{/* skip degenerate yard rings */}
 }
}
function addFences(scene,map,surface){
 const postMat=mat(0x3c3830),railMat=mat(0x4d473c),hedgeMat=mat(0x3a5c33),wallMat=mat(0x8b8676);
 const posts=[],rails=[],hedges=[],walls=[];
 const inHouse=(x,z)=>(map.buildings||[]).some(b=>x>=b.minX&&x<=b.maxX&&z>=b.minZ&&z<=b.maxZ&&b.points&&inside(x,z,b.points));
 for(const f of map.fences||[]){
  const hedge=f.kind==='hedge',masonry=f.kind==='wall'||f.kind==='retaining_wall'||f.kind==='city_wall';
  for(let i=1;i<f.points.length;i++){
   const a=f.points[i-1],b=f.points[i],len=Math.hypot(b.x-a.x,b.z-a.z);if(len<.25)continue;
   const dx=b.x-a.x,dz=b.z-a.z,yaw=Math.atan2(-dz,dx);
   const open=f.opening&&f.opening.i===i?f.opening:null;
   const spans=open?[[0,open.t0],[open.t1,1]]:[[0,1]];
   for(const [t0,t1] of spans){
    const sl=(t1-t0)*len;if(sl<.18)continue;
    const steps=Math.max(1,Math.ceil(sl/2.1));
    for(let s=0;s<=steps;s++){
     const t=t0+(t1-t0)*s/steps,x=a.x+dx*t,z=a.z+dz*t;
     if(inHouse(x,z))continue;
     const y=surface(x,z);
     if(!hedge){
      const pg=new T.BoxGeometry(.07,f.height,.07);pg.translate(x,y+f.height/2,z);posts.push(pg);
     }
    }
    for(let s=0;s<steps;s++){
     const u0=t0+(t1-t0)*s/steps,u1=t0+(t1-t0)*(s+1)/steps,mx=a.x+dx*(u0+u1)/2,mz=a.z+dz*(u0+u1)/2;
     if(inHouse(mx,mz))continue;
     const y=surface(mx,mz),seg=Math.hypot(dx*(u1-u0),dz*(u1-u0));
     if(hedge){
      const g=new T.BoxGeometry(seg,f.height,f.width||.38);g.rotateY(yaw);g.translate(mx,y+f.height/2,mz);hedges.push(g);
     }else if(masonry){
      const g=new T.BoxGeometry(seg,f.height,f.width||.22);g.rotateY(yaw);g.translate(mx,y+f.height/2,mz);walls.push(g);
     }else{
      for(const frac of [.38,.78]){
       const g=new T.BoxGeometry(seg,.07,.05);g.rotateY(yaw);g.translate(mx,y+f.height*frac,mz);rails.push(g);
      }
     }
    }
   }
  }
 }
 if(posts.length){const g=mergeGeometries(posts);if(g)mesh(g,postMat,scene);}
 if(rails.length){const g=mergeGeometries(rails);if(g)mesh(g,railMat,scene);}
 if(hedges.length){const g=mergeGeometries(hedges);if(g){const h=mesh(g,hedgeMat,scene);h.castShadow=false;}}
 if(walls.length){const g=mergeGeometries(walls);if(g)mesh(g,wallMat,scene);}
 for(const g of [...posts,...rails,...hedges,...walls])g.dispose();
}
function addTrees(scene,map,surface){
 const trunks=[],crowns=[],trunkMat=mat(0x5a4634),leafMat=mat(0x3f6b36);
 for(const t of (map.trees||[]).slice(0,180)){
  if(Math.hypot(t.x,t.z)>(map.radius||195)-6)continue;
  if(map.buildings.some(b=>t.x>=b.minX&&t.x<=b.maxX&&t.z>=b.minZ&&t.z<=b.maxZ&&inside(t.x,t.z,b.points)))continue;
  const y=surface(t.x,t.z),h=t.h||5.5,trunkH=h*.36,rad=.11+h*.018;
  const tg=new T.CylinderGeometry(rad*.68,rad,trunkH,5);tg.translate(t.x,y+trunkH/2,t.z);trunks.push(tg);
  const cg=new T.SphereGeometry(h*.27,6,5);cg.translate(t.x,y+trunkH+h*.17,t.z);crowns.push(cg);
 }
 if(trunks.length){const g=mergeGeometries(trunks);if(g){const m=mesh(g,trunkMat,scene);m.castShadow=true;}}
 if(crowns.length){const g=mergeGeometries(crowns);if(g){const c=mesh(g,leafMat,scene);c.castShadow=false;c.receiveShadow=false;}}
 for(const g of [...trunks,...crowns])g.dispose();
}
const STOREY=3.2;
function footprintHighLow(p,heightFn){
 const vals=[];
 for(const q of p)vals.push(heightFn(q.x,q.z));
 for(let i=0;i<p.length;i++){
  const a=p[i],c=p[(i+1)%p.length];
  vals.push(heightFn((a.x+c.x)/2,(a.z+c.z)/2));
 }
 const cx=p.reduce((s,q)=>s+q.x,0)/p.length,cz=p.reduce((s,q)=>s+q.z,0)/p.length;
 vals.push(heightFn(cx,cz));
 return {high:Math.max(...vals),low:Math.min(...vals)};
}
function nearestRoadPoint(x,z,roads){
 let best=Infinity,pt=null;
 for(const road of roads||[]){
  for(let i=1;i<road.points.length;i++){
   const a=road.points[i-1],b=road.points[i],dx=b.x-a.x,dz=b.z-a.z,len2=dx*dx+dz*dz||1;
   const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/len2));
   const qx=a.x+dx*t,qz=a.z+dz*t,d=Math.hypot(x-qx,z-qz);
   if(d<best){best=d;pt={x:qx,z:qz,d};}
  }
 }
 return pt;
}
function livableFloor(base,ground){
 const g=Math.min(ground,base);
 const extra=Math.max(0,Math.floor((base-g)/STOREY+1e-6));
 return base-extra*STOREY;
}
function sampleOut(e,t,heightFn,out=.4){
 const x=e.a.x+e.dx*t,z=e.a.z+e.dz*t;
 return heightFn(x+e.nx*out,z+e.nz*out);
}
function insetPoints(p,dist){
 if(!p||p.length<3)return p;
 const ring=[];
 for(let i=0;i<p.length;i++){
  const a=p[(i-1+p.length)%p.length],b=p[i],c=p[(i+1)%p.length];
  const l1=Math.hypot(b.x-a.x,b.z-a.z)||1,l2=Math.hypot(c.x-b.x,c.z-b.z)||1;
  let nx=(b.z-a.z)/l1+(c.z-b.z)/l2,nz=-(b.x-a.x)/l1-(c.x-b.x)/l2;
  if(inside(b.x+nx*.2,b.z+nz*.2,p)){nx=-nx;nz=-nz;}
  const nl=Math.hypot(nx,nz)||1;
  ring.push({x:b.x-nx/nl*dist,z:b.z-nz/nl*dist});
 }
 if(ring.length<3||polygonArea(ring)<4)return null;
 if(!inside(ring.reduce((s,q)=>s+q.x,0)/ring.length,ring.reduce((s,q)=>s+q.z,0)/ring.length,p))return null;
 return ring;
}
const STAIR_GOING=.62,STAIR_RISER_MIN=.10,STAIR_TREAD_MIN=.26,STAIR_RAIL_FLIGHT=.90,STAIR_RAIL_LANDING=1.05,STAIR_LANDING_RUN=1.20,CLEAR_MIN=2.50,STAIR_HEADROOM=2.20,STAIR_FLIGHT_MAX=16,STAIR_FLIGHT_MIN=3;
function stairKind(b,outdoor){
 const t=String(b?.tags?.building||''),levels=b?.levels||1;
 const pub=['public','civic','government','school','university','college','hospital','church','synagogue','mosque','train_station','retail','commercial','office','kindergarten'];
 if(pub.includes(t))return outdoor?'public_outdoor':'public';
 if(['apartments','residential','dormitory'].includes(t)||levels>=3||(!outdoor&&(b.area||0)>=90))return outdoor?'public_outdoor':'protected';
 return 'private';
}
function stairWidthMin(kind){return kind==='protected'||kind==='public'?1.1:kind==='public_outdoor'?.9:.8;}
function stairRiserMax(kind){return kind==='private'?.175:.2;}
function layoutStair(rise,kind,minWidth){
 const riserMax=stairRiserMax(kind);
 let n=Math.max(2,Math.round(rise/.16)),H=rise/n;
 while(H>riserMax+.001){n++;H=rise/n;}
 while(n>2&&H<STAIR_RISER_MIN){n--;H=rise/n;}
 if(H>riserMax){n++;H=rise/n;}
 let B=STAIR_GOING-2*H;
 while(B<STAIR_TREAD_MIN&&H>STAIR_RISER_MIN+.005){n++;H=rise/n;B=STAIR_GOING-2*H;}
 B=Math.max(STAIR_TREAD_MIN,B);
 if(2*H+B<.61)B=.61-2*H;
 if(2*H+B>.63)B=Math.max(STAIR_TREAD_MIN,.63-2*H);
 return {n,H,B,width:Math.max(stairWidthMin(kind),minWidth||0),kind};
}
function flightMax(kind,H){return kind==='private'&&H<=.155+.001?22:STAIR_FLIGHT_MAX;}
function splitFlights(n,kind,H){
 const max=flightMax(kind,H);
 if(n<=max)return [n];
 const a=Math.min(max,Math.max(STAIR_FLIGHT_MIN,Math.round(n/2)));
 const b=n-a;
 if(b<STAIR_FLIGHT_MIN||b>max){
  const c=Math.max(STAIR_FLIGHT_MIN,Math.min(max,Math.ceil(n/3)));
  return [c,c,n-2*c].filter(x=>x>=STAIR_FLIGHT_MIN);
 }
 return [a,b];
}
function railGeom(ax,ay,az,bx,by,bz){
 const dx=bx-ax,dy=by-ay,dz=bz-az,len=Math.hypot(dx,dy,dz)||.01;
 const g=new T.BoxGeometry(len,.045,.045);
 g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(1,0,0),new T.Vector3(dx/len,dy/len,dz/len)));
 g.translate((ax+bx)/2,(ay+by)/2,(az+bz)/2);
 return g;
}
function addRailRun(ax,az,bx,bz,y,h,opts){
 const dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz);
 if(len<.12)return;
 const posts=Math.max(2,Math.ceil(len/1.2));
 for(let p=0;p<=posts;p++){
  const t=p/posts,g=new T.BoxGeometry(.045,h,.045);
  g.translate(ax+dx*t,y+h/2,az+dz*t);opts.rail.push(g);
 }
 opts.rail.push(railGeom(ax,y+h,az,bx,y+h,bz));
}
function pickFlightRailSides(from,to,w,well,foot,outdoor){
 if(outdoor)return [-1,1];
 const dx=to.x-from.x,dz=to.z-from.z,len=Math.hypot(dx,dz)||1;
 const yaw=Math.atan2(-dz,dx),sx=Math.sin(yaw),cz=Math.cos(yaw);
 const mx=(from.x+to.x)/2,mz=(from.z+to.z)/2;
 const picked=[];
 for(const side of [-1,1]){
  const x=mx+side*(w/2+.12)*sx,z=mz+side*(w/2+.12)*cz;
  const wellSide=well&&(inside(x,z,well)||well.some((q,i)=>segmentDistance(x,z,q,well[(i+1)%well.length])<.45));
  const againstWall=foot&&wallDist(x,z,foot)<.5;
  if(wellSide||!againstWall)picked.push(side);
 }
 return picked.length?picked:[-1,1];
}
function railAroundWell(well,y,built,foot,opts,clip){
 if(!well||well.length<3||!opts?.rail)return;
 const cx=well.reduce((s,p)=>s+p.x,0)/well.length,cz=well.reduce((s,p)=>s+p.z,0)/well.length;
 const outset=clip?.outset??.08;
 const near=clip?.near;
 for(let i=0;i<well.length;i++){
  const a=well[i],b=well[(i+1)%well.length],mx=(a.x+b.x)/2,mz=(a.z+b.z)/2;
  if(near&&Math.hypot(mx-near.cx,mz-near.cz)>Math.max(near.depth,near.width)/2+.4)continue;
  const ox=mx-cx,oz=mz-cz,oL=Math.hypot(ox,oz)||1;
  const px=ox/oL*outset,pz=oz/oL*outset;
  if(foot&&wallDist(mx+px,mz+pz,foot)<.4)continue;
  const opening=(built||[]).some(s=>{
   if(s.flat||Math.abs((s.y1??0)-(s.y0??0))<.05)return false;
   const atStart=Math.abs(s.y0-y)<.22,atEnd=Math.abs(s.y1-y)<.22;
   if(!atStart&&!atEnd)return false;
   const end=atStart&&!atEnd?s.a:atEnd&&!atStart?s.b:Math.hypot(mx-s.a.x,mz-s.a.z)<Math.hypot(mx-s.b.x,mz-s.b.z)?s.a:s.b;
   return Math.hypot(mx-end.x,mz-end.z)<(s.width||1.1)/2+.38;
  });
  if(opening)continue;
  addRailRun(a.x+px,a.z+pz,b.x+px,b.z+pz,y,STAIR_RAIL_LANDING,opts);
 }
}
function addStairFlight(from,to,fromY,toY,spec,opts={}){
 const dx=to.x-from.x,dz=to.z-from.z,len=Math.hypot(dx,dz)||1;
 const nx=dx/len,nz=dz/len,n=spec.n,H=spec.H,B=spec.B,w=spec.width,kind=spec.kind||'private';
 const run=n*B,yaw=Math.atan2(-dz,dx);
 const start={x:to.x-nx*run,z:to.z-nz*run};
 const c=Math.cos(yaw),s=Math.sin(yaw);
 const world=(lx,ly,lz)=>({x:start.x+lx*c+lz*s,y:fromY+ly,z:start.z-lx*s+lz*c});
 const put=(geoms,bw,bh,bd,lx,ly,lz)=>{const g=new T.BoxGeometry(bw,bh,bd);g.rotateY(yaw);const p=world(lx,ly,lz);g.translate(p.x,p.y,p.z);geoms.push(g);};
 for(let i=0;i<n;i++){
  put(opts.stone,B+.02,.06,w,(i+.5)*B,(i+1)*H-.02,0);
  put(opts.stone,.04,H,w,i*B+.02,(i+.5)*H,0);
 }
 if(opts.cap!==false)put(opts.stone,.7,.07,w,run+.28,toY-fromY,0);
 const sides=opts.sides||[-1,1];
 const indoor=!!opts.indoor;
 const rise=toY-fromY;
 const soffit=(indoor&&opts.slabY!=null)?opts.slabY-fromY-FLOOR_SLAB:Infinity;
 for(const side of sides){
  const lz=side*(w/2+(indoor?-.05:.02)),posts=Math.max(2,Math.ceil(run/1.2));
  let handA=null,handB=null;
  for(let p=0;p<=posts;p++){
   const t=p/posts,ly=t*rise;
   if(ly>=soffit-.02)continue;
   const h=Math.max(.12,Math.min(STAIR_RAIL_FLIGHT,soffit-ly));
   put(opts.rail,.045,h,.045,t*run,ly+h/2,lz);
   const top=world(t*run,ly+h,lz);
   if(!handA)handA=top;handB=top;
  }
  if(handA&&handB)opts.rail.push(railGeom(handA.x,handA.y,handA.z,handB.x,handB.y,handB.z));
  if(opts.cap!==false)put(opts.rail,.045,STAIR_RAIL_LANDING,.045,run,rise+STAIR_RAIL_LANDING/2,lz);
 }
 return {a:start,b:to,width:w,y0:fromY,y1:toY,H,B,kind,n};
}
function addEntryStairs(from,to,fromY,toY,opts={}){
 const dx=to.x-from.x,dz=to.z-from.z,len=Math.hypot(dx,dz)||1;
 const nx=dx/len,nz=dz/len,kind=opts.kind||'private';
 let bottomY=fromY;
 if(opts.height)bottomY=Math.min(toY-.28,fromY,opts.height(from.x,from.z));
 const rise=toY-bottomY;if(rise<.28||rise>STOREY+.05)return null;
 const spec=layoutStair(rise,kind,opts.minWidth);
 return addStairFlight(from,to,bottomY,toY,spec,opts);
}
function addStairLanding(cx,cz,ux,uz,px,pz,depth,width,y,opts){
 const yaw=Math.atan2(-uz,ux);
 const g=new T.BoxGeometry(depth,.07,width);g.rotateY(yaw);g.translate(cx,y+.035,cz);opts.stone.push(g);
 if(opts.edgeRails!==false){
  const open=opts.open||{};
  const pt=(u,v)=>({x:cx+ux*u+px*v,z:cz+uz*u+pz*v});
  const edges=[
   {skip:open.v0,a:pt(-depth/2,-width/2),b:pt(depth/2,-width/2)},
   {skip:open.v1,a:pt(-depth/2,width/2),b:pt(depth/2,width/2)},
   {skip:open.u0,a:pt(-depth/2,-width/2),b:pt(-depth/2,width/2)},
   {skip:open.u1,a:pt(depth/2,-width/2),b:pt(depth/2,width/2)}
  ];
  for(const e of edges){
   if(e.skip)continue;
   const mx=(e.a.x+e.b.x)/2,mz=(e.a.z+e.b.z)/2;
   if(opts.footprint&&wallDist(mx,mz,opts.footprint)<.45)continue;
   addRailRun(e.a.x,e.a.z,e.b.x,e.b.z,y,STAIR_RAIL_LANDING,opts);
  }
 }
 const a={x:cx-ux*depth/2,z:cz-uz*depth/2},b={x:cx+ux*depth/2,z:cz+uz*depth/2};
 return {a,b,width,y0:y,y1:y,H:.16,B:.3,kind:opts.kind||'private',n:0,flat:true};
}
function rectPath(pts){
 const path=new T.Path();
 path.moveTo(pts[0].x,-pts[0].z);
 for(let i=1;i<pts.length;i++)path.lineTo(pts[i].x,-pts[i].z);
 path.closePath();
 return path;
}
function localCorners(o,ux,uz,px,pz,u0,u1,v0,v1){
 return [
  {x:o.x+ux*u0+px*v0,z:o.z+uz*u0+pz*v0},
  {x:o.x+ux*u1+px*v0,z:o.z+uz*u1+pz*v0},
  {x:o.x+ux*u1+px*v1,z:o.z+uz*u1+pz*v1},
  {x:o.x+ux*u0+px*v1,z:o.z+uz*u0+pz*v1}
 ];
}
function stairWellPath(s){
 if(s.well)return rectPath(s.well);
 const dx=s.b.x-s.a.x,dz=s.b.z-s.a.z,len=Math.hypot(dx,dz)||1;
 const ux=dx/len,uz=dz/len,px=-uz,pz=ux,w=(s.width||1.1)/2+.18;
 const t0=.02,t1=.94;
 return rectPath([
  {x:s.a.x+ux*len*t0+px*w,z:s.a.z+uz*len*t0+pz*w},
  {x:s.a.x+ux*len*t1+px*w,z:s.a.z+uz*len*t1+pz*w},
  {x:s.a.x+ux*len*t1-px*w,z:s.a.z+uz*len*t1-pz*w},
  {x:s.a.x+ux*len*t0-px*w,z:s.a.z+uz*len*t0-pz*w}
 ]);
}
function shapeArea(pts){
 let a=0;
 for(let i=0,j=pts.length-1;i<pts.length;j=i++)a+=pts[j].x*pts[i].y-pts[i].x*pts[j].y;
 return a;
}
function makePath(pts){
 const path=new T.Path();
 path.moveTo(pts[0].x,pts[0].y);
 for(let i=1;i<pts.length;i++)path.lineTo(pts[i].x,pts[i].y);
 path.closePath();
 return path;
}
function xzToShape(ring){return ring.map(q=>({x:q.x,y:-q.z}));}
function holePath(pts,outer){
 if(!pts||pts.length<3)return null;
 const cx=pts.reduce((s,p)=>s+p.x,0)/pts.length,cz=pts.reduce((s,p)=>s+p.z,0)/pts.length;
 const inset=pts.map(p=>{
  const dx=cx-p.x,dz=cz-p.z,L=Math.hypot(dx,dz)||1;
  let x=p.x+dx/L*.02,z=p.z+dz/L*.02;
  if(outer)for(let k=0;k<6&&!inside(x,z,outer);k++){x+=dx/L*.06;z+=dz/L*.06;}
  return {x,z};
 });
 if(outer&&inset.some(q=>!inside(q.x,q.z,outer)))return null;
 const sp=xzToShape(inset);
 const outerA=outer?shapeArea(xzToShape(outer)):1;
 if(shapeArea(sp)*outerA>0)sp.reverse();
 return makePath(sp);
}
function extrudeSlab(points,y,holes){
 const shape=new T.Shape(points.map(q=>new T.Vector2(q.x,-q.z)));
 for(const hole of holes||[])shape.holes.push(hole);
 const g=new T.ExtrudeGeometry(shape,{depth:FLOOR_SLAB,bevelEnabled:false});
 g.rotateX(-Math.PI/2);g.translate(0,y-FLOOR_SLAB,0);
 return g;
}
function reversePath(hole){
 const pts=hole.getPoints();if(pts.length<3)return hole;
 pts.reverse();
 return makePath(pts.map(p=>({x:p.x,y:p.y})));
}
function floorSlab(points,y,holes){
 const list=(holes||[]).filter(Boolean);
 const tryMake=hs=>{
  const g=extrudeSlab(points,y,hs);
  if(!g?.getAttribute?.('position')){g?.dispose?.();throw new Error('empty slab');}
  return g;
 };
 try{return tryMake(list);}catch{}
 try{return tryMake(list.map(reversePath));}catch{}
 const kept=[];
 for(const hole of list){
  const candidates=[hole,reversePath(hole)];
  let added=false;
  for(const c of candidates){
   try{const g=tryMake([...kept,c]);g.dispose();kept.push(c);added=true;break;}catch{}
  }
  if(!added)continue;
 }
 try{return tryMake(kept);}catch{return tryMake([]);}
}
function planStraight(o,ux,uz,px,pz,spec,ns,exitRun=STAIR_LANDING_RUN){
 const n=ns[0],w=spec.width,run=n*spec.B,exit=Math.max(.9,exitRun),hw=w/2;
 const foot=localCorners(o,ux,uz,px,pz,0,run+exit,-hw,hw);
 const hole=localCorners(o,ux,uz,px,pz,.02,run+.14,-hw+.02,hw-.02);
 const from={x:o.x,z:o.z},to={x:o.x+ux*run,z:o.z+uz*run};
 const land={cx:o.x+ux*(run+exit/2),cz:o.z+uz*(run+exit/2),depth:exit,width:w,ux,uz,px,pz,open:{u0:true}};
 return {fold:'straight',pts:foot,well:hole,flights:[{from,to,n,cap:true}],landings:[],exits:[land],holes:[hole]};
}
function planU(o,ux,uz,px,pz,spec,ns,exitRun=STAIR_LANDING_RUN){
 const w=spec.width,B=spec.B,gap=.16,n1=ns[0],n2=ns[1]||ns[0];
 const run1=n1*B,run2=n2*B,exit=Math.max(.9,exitRun),landU=Math.max(run1,run2+exit),landD=Math.max(w,.9),span=2*w+gap;
 const foot=localCorners(o,ux,uz,px,pz,0,landU+landD,0,span);
 const hole=localCorners(o,ux,uz,px,pz,exit-.14,landU+landD-.02,.02,span-.02);
 const v1=w/2,v2=w+gap+w/2;
 const f1from={x:o.x+ux*(landU-run1)+px*v1,z:o.z+uz*(landU-run1)+pz*v1};
 const f1to={x:o.x+ux*landU+px*v1,z:o.z+uz*landU+pz*v1};
 const f2from={x:o.x+ux*landU+px*v2,z:o.z+uz*landU+pz*v2};
 const f2to={x:o.x+ux*exit+px*v2,z:o.z+uz*exit+pz*v2};
 const land={cx:o.x+ux*(landU+landD/2)+px*(span/2),cz:o.z+uz*(landU+landD/2)+pz*(span/2),depth:landD,width:span,ux,uz,px,pz,open:{u0:true}};
 const out={cx:o.x+ux*(exit/2)+px*(span/2),cz:o.z+uz*(exit/2)+pz*(span/2),depth:exit,width:span,ux,uz,px,pz,open:{u1:true}};
 return {fold:'U',pts:foot,well:hole,flights:[{from:f1from,to:f1to,n:n1,cap:false},{from:f2from,to:f2to,n:n2,cap:false}],landings:[land],exits:[out],holes:[hole]};
}
function planL(o,ux,uz,px,pz,spec,ns,exitRun=STAIR_LANDING_RUN){
 const w=spec.width,B=spec.B,n1=ns[0],n2=ns[1]||ns[0],run1=n1*B,run2=n2*B,land=Math.max(w,STAIR_LANDING_RUN);
 const exit=Math.max(.9,exitRun);
 const foot=localCorners(o,ux,uz,px,pz,0,run1+land,0,w+run2+exit);
 const u0=.02,u1=run1+land-.02,v0=.02,v1=w-.02,v2=w+run2+.14,uInner=run1+.02;
 const hole=[
  {x:o.x+ux*u0+px*v0,z:o.z+uz*u0+pz*v0},
  {x:o.x+ux*u1+px*v0,z:o.z+uz*u1+pz*v0},
  {x:o.x+ux*u1+px*v2,z:o.z+uz*u1+pz*v2},
  {x:o.x+ux*uInner+px*v2,z:o.z+uz*uInner+pz*v2},
  {x:o.x+ux*uInner+px*v1,z:o.z+uz*uInner+pz*v1},
  {x:o.x+ux*u0+px*v1,z:o.z+uz*u0+pz*v1}
 ];
 const f1from={x:o.x+px*(w/2),z:o.z+pz*(w/2)};
 const f1to={x:o.x+ux*run1+px*(w/2),z:o.z+uz*run1+pz*(w/2)};
 const f2from={x:o.x+ux*(run1+land/2)+px*w,z:o.z+uz*(run1+land/2)+pz*w};
 const f2to={x:o.x+ux*(run1+land/2)+px*(w+run2),z:o.z+uz*(run1+land/2)+pz*(w+run2)};
 const landC={cx:o.x+ux*(run1+land/2)+px*(land/2),cz:o.z+uz*(run1+land/2)+pz*(land/2),depth:land,width:land,ux,uz,px,pz,open:{u0:true,v1:true}};
 const out={cx:o.x+ux*(run1+land/2)+px*(w+run2+exit/2),cz:o.z+uz*(run1+land/2)+pz*(w+run2+exit/2),depth:exit,width:w,ux:px,uz:pz,px:ux,pz:uz,open:{u0:true}};
 return {fold:'L',pts:foot,well:hole,flights:[{from:f1from,to:f1to,n:n1,cap:false},{from:f2from,to:f2to,n:n2,cap:false}],landings:[landC],exits:[out],holes:[hole]};
}
function chooseFold(b,n,run,span){
 if(n<STAIR_FLIGHT_MIN*2)return 'straight';
 const id=Math.abs(Number(b.id)||0),style=id%3;
 if(style===0&&n<=STAIR_FLIGHT_MAX&&run+1.1<span)return 'straight';
 if((b.area||0)<80)return style===1?'L':'U';
 if(style===1)return 'L';
 return 'U';
}
function flightsForFold(n,fold,kind,H){
 if(fold==='straight'){
  if(n<=flightMax(kind,H))return [n];
  fold='U';
 }
 const a=Math.max(STAIR_FLIGHT_MIN,Math.min(STAIR_FLIGHT_MAX,Math.round(n/2)));
 const b=n-a;
 if(b<STAIR_FLIGHT_MIN||b>STAIR_FLIGHT_MAX)return splitFlights(n,kind,H);
 return [a,b];
}
function tryPlan(p,o,ux,uz,px,pz,spec,fold,minClear=0,exitRun=STAIR_LANDING_RUN){
 const ns=flightsForFold(spec.n,fold,spec.kind,spec.H);
 const plan=fold==='straight'&&ns.length===1?planStraight(o,ux,uz,px,pz,spec,ns,exitRun):fold==='L'?planL(o,ux,uz,px,pz,spec,ns,exitRun):planU(o,ux,uz,px,pz,spec,ns,exitRun);
 if(!plan||!plan.pts.every(q=>inside(q.x,q.z,p)))return null;
 if(minClear>0&&!stairWalkClear(plan,p,minClear))return null;
 return plan;
}
function wallDist(x,z,p){
 let best=Infinity;
 for(let i=0;i<p.length;i++)best=Math.min(best,segmentDistance(x,z,p[i],p[(i+1)%p.length]));
 return best;
}
function stairWalkClear(plan,p,clear){
 const spots=[];
 for(const f of plan.flights||[]){
  const dx=f.to.x-f.from.x,dz=f.to.z-f.from.z,len=Math.hypot(dx,dz)||1;
  spots.push(f.from,f.to,{x:(f.from.x+f.to.x)/2,z:(f.from.z+f.to.z)/2});
  spots.push({x:f.from.x-dx/len*.85,z:f.from.z-dz/len*.85});
 }
 for(const q of spots){
  if(!inside(q.x,q.z,p)||wallDist(q.x,q.z,p)<clear)return false;
 }
 return true;
}
function inEntranceLobby(x,z,door,depth){
 if(!door)return false;
 const vx=x-door.mid.x,vz=z-door.mid.z;
 const along=vx*door.tx+vz*door.tz,inw=-(vx*door.nx+vz*door.nz);
 const half=Math.max(1.15,(door.w||1.72)/2+.5);
 return Math.abs(along)<half&&inw>-.2&&inw<depth+.15;
}
function planClearsLobby(plan,door,depth){
 if(!door)return true;
 const hits=q=>inEntranceLobby(q.x,q.z,door,depth);
 if(plan.pts.some(hits))return false;
 for(const f of plan.flights||[])if(hits(f.from)||hits(f.to))return false;
 return true;
}
function placeInteriorPlan(p,edges,spec,b,door){
 const span=Math.max(b.maxX-b.minX,b.maxZ-b.minZ)-.9;
 const preferred=chooseFold(b,spec.n,spec.n*spec.B,span);
 const order=[preferred,'U','L','straight'].filter((f,i,a)=>a.indexOf(f)===i);
 const depths=b.area>=80?[1.8,1.45,1.15]:[1.45,1.15,.95];
 const insets=b.area>=80?[.95,.78,.58]:[.78,.58,.45];
 const clears=b.area>=80?[.82,.64,0]:[.64,0];
 const exits=b.area>=80?[STAIR_LANDING_RUN,.95]:[STAIR_LANDING_RUN,.9];
 const ranked=edges.map((e,i)=>({e,i,door:door&&i===door.i})).sort((a,b)=>a.door-b.door);
 for(const minClear of clears)for(const inset of insets)for(const depth of depths)for(const exitRun of exits)for(const fold of order)for(const {e,i,door:onDoor}of ranked){
  const ax=e.dx/e.len,az=e.dz/e.len,px=-e.nx,pz=-e.nz;
  for(const t of [.18,.32,.5,.68,.82]){
   if(onDoor&&door){
    const along=t*e.len,doorMid=door.doorX!=null?door.doorX+(door.w||1.72)/2:e.len/2;
    if(Math.abs(along-doorMid)<depth+1.1)continue;
   }
   for(const sign of [1,-1]){
    const o={x:e.a.x+ax*e.len*t+px*inset,z:e.a.z+az*e.len*t+pz*inset};
    const plan=tryPlan(p,o,ax*sign,az*sign,px,pz,spec,fold,minClear,exitRun);
    if(plan&&planClearsLobby(plan,door,depth))return plan;
   }
  }
 }
 return null;
}
function markWell(s,well,wellY0,wellY1,fold,holes){
 s.well=well;s.wellY0=wellY0;s.wellY1=wellY1;s.fold=fold;s.holes=holes;return s;
}
function buildInteriorStairs(p,plan,y0,y1,spec,opts){
 const H=spec.H,built=[];
 let y=y0;
 const well=plan.well||plan.pts,holes=plan.holes||[well],wellY0=y0,wellY1=y1;
 const railOpts={...opts,footprint:p,edgeRails:false};
 for(let i=0;i<plan.flights.length;i++){
  const f=plan.flights[i],n=f.n,yTop=y+n*H;
  const sides=pickFlightRailSides(f.from,f.to,spec.width,well,p,false);
  const stair=addStairFlight(f.from,f.to,y,Math.min(y1,yTop),{...spec,n},{...opts,cap:f.cap,sides,indoor:true,slabY:y1});
  if(stair)built.push(markWell(stair,well,wellY0,wellY1,plan.fold,holes));
  if(plan.landings[i]){
   const L=plan.landings[i];
   const land=addStairLanding(L.cx,L.cz,L.ux,L.uz,L.px,L.pz,L.depth,L.width,yTop,{...railOpts,open:L.open});
   built.push(markWell(land,well,wellY0,wellY1,plan.fold,holes));
   railAroundWell(well,yTop,built,p,opts,{near:L,outset:.06});
  }
  y=yTop;
 }
 for(const L of plan.exits||[]){
  const land=addStairLanding(L.cx,L.cz,L.ux,L.uz,L.px,L.pz,L.depth,L.width,y1,{...railOpts,open:L.open});
  built.push(markWell(land,well,wellY0,wellY1,plan.fold,holes));
 }
 railAroundWell(well,y1,built,p,opts,{outset:.1});
 return built;
}
function lotRing(b,fences){
 const cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2;
 for(const f of fences||[]){
  const ring=closedRing(f.points);if(!ring||!inside(cx,cz,ring))continue;
  const area=polygonArea(ring);if(area<b.area*1.05||area>b.area*18)continue;
  return ring;
 }
 return null;
}
function pushYard(map,yardKeys,ring,top){
 if(!ring||ring.length<3||!Number.isFinite(top))return;
 const minX=Math.min(...ring.map(q=>q.x)),maxX=Math.max(...ring.map(q=>q.x));
 const minZ=Math.min(...ring.map(q=>q.z)),maxZ=Math.max(...ring.map(q=>q.z));
 const key=`${minX.toFixed(1)},${minZ.toFixed(1)},${maxX.toFixed(1)},${maxZ.toFixed(1)}`;
 const prev=map.yards.find(y=>y.key===key);
 if(prev){prev.top=Math.max(prev.top,top);return;}
 yardKeys.add(key);
 map.yards.push({key,points:ring,top,minX,maxX,minZ,maxZ});
}
function doorApproachY(e,t,heightFn){
 let y=-Infinity;
 for(const along of [t-0.4/Math.max(e.len,.01),t,t+0.4/Math.max(e.len,.01)]){
  const u=Math.max(0,Math.min(1,along)),px=e.a.x+e.dx*u,pz=e.a.z+e.dz*u;
  for(const out of [.1,.3,.5])y=Math.max(y,heightFn(px+e.nx*out,pz+e.nz*out));
 }
 return y;
}
function doorLandingY(mid,e,map,heightFn){
 let y=-Infinity;
 for(const out of [.2,.55,1.0]){
  const x=mid.x+e.nx*out,z=mid.z+e.nz*out;
  y=Math.max(y,standHeight(x,z,map.buildings,heightFn(x,z),map.yards,[],null,map.roads));
 }
 return y;
}
function otherClearance(x,z,buildings,skipId){
 let best=Infinity;
 for(const o of buildings||[]){
  if(o.id===skipId||!o.points||o.points.length<3)continue;
  if(x<(o.minX??-1e9)-12||x>(o.maxX??1e9)+12||z<(o.minZ??-1e9)-12||z>(o.maxZ??1e9)+12)continue;
  if(inside(x,z,o.points))return 0;
  for(let i=0;i<o.points.length;i++){
   const d=segmentDistance(x,z,o.points[i],o.points[(i+1)%o.points.length]);
   if(d<best)best=d;
  }
 }
 return best;
}
function fenceClearance(x,z,fences){
 let best=Infinity;
 for(const f of fences||[]){
  const thick=(f.width||.08)/2,pts=f.points,open=f.opening;
  if(!pts||pts.length<2)continue;
  for(let i=1;i<pts.length;i++){
   const a=pts[i-1],b=pts[i];
   if(open&&open.i===i){
    const dx=b.x-a.x,dz=b.z-a.z;
    const p0={x:a.x+dx*open.t0,z:a.z+dz*open.t0},p1={x:a.x+dx*open.t1,z:a.z+dz*open.t1};
    best=Math.min(best,segmentDistance(x,z,a,p0)-thick,segmentDistance(x,z,p1,b)-thick);
    continue;
   }
   best=Math.min(best,segmentDistance(x,z,a,b)-thick);
  }
 }
 return best;
}
function cutFenceGate(fences,mid,nx,nz,width,depth){
 const px=-nz,pz=nx,hw=Math.max(.7,(width||1.72)/2+.28),reach=Math.max(2.2,depth||2.6);
 for(const f of fences||[]){
  const pts=f.points;if(!pts||pts.length<2)continue;
  let bestI=-1,bestT=.5,bestD=Infinity;
  for(let i=1;i<pts.length;i++){
   const a=pts[i-1],b=pts[i],len=Math.hypot(b.x-a.x,b.z-a.z)||1;
   const steps=Math.max(2,Math.ceil(len/.35));
   for(let k=0;k<=steps;k++){
    const t=k/steps,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
    const along=(x-mid.x)*nx+(z-mid.z)*nz,lat=Math.abs((x-mid.x)*px+(z-mid.z)*pz);
    if(along>-.2&&along<reach&&lat<hw+.2){
     const d=Math.hypot(x-mid.x,z-mid.z);
     if(d<bestD){bestD=d;bestI=i;bestT=t;}
    }
   }
  }
  if(bestI<0)continue;
  const a=pts[bestI-1],b=pts[bestI],len=Math.hypot(b.x-a.x,b.z-a.z)||1;
  const half=Math.min(1.2,Math.max(.85,(width||1.72)/2+.4),len*.48);
  const t0=Math.max(0,bestT-half/len),t1=Math.min(1,bestT+half/len);
  if(t1-t0<.45)continue;
  if(f.opening&&f.opening.i===bestI){
   f.opening.t0=Math.min(f.opening.t0,t0);
   f.opening.t1=Math.max(f.opening.t1,t1);
  }else f.opening={i:bestI,t0,t1};
 }
}
const APPROACH_WALK=.9;
function corridorClearance(mid,nx,nz,width,depth,buildings,skipId,fences){
 const px=-nz,pz=nx,hw=Math.max(.4,(width||1.72)/2+.08);
 let min=Infinity;
 const reach=Math.max(APPROACH_WALK,depth||APPROACH_WALK);
 const step=Math.max(.3,reach/8);
 for(let along=.12;along<=reach+.001;along+=step){
  for(const lat of [-hw,0,hw]){
   const x=mid.x+nx*along+px*lat,z=mid.z+nz*along+pz*lat;
   min=Math.min(min,otherClearance(x,z,buildings,skipId),fenceClearance(x,z,fences));
   if(min<=.32)return 0;
  }
 }
 return min;
}
function approachDepth(rise,doorW){
 if(!(rise>.45))return APPROACH_WALK;
 const spec=layoutStair(rise,'public_outdoor',doorW);
 return spec.n*spec.B+APPROACH_WALK;
}
function scoreDoorSlot(e,doorX,doorW,heightFn,buildings,skipId,floorHigh,fences){
 const t=(doorX+doorW/2)/e.len;
 const mid={x:e.a.x+e.dx*t,z:e.a.z+e.dz*t};
 const sidewalk=doorApproachY(e,t,heightFn);
 const rise=Math.max(0,floorHigh-sidewalk);
 const width=Math.max(doorW,stairWidthMin('public_outdoor'));
 const gap=corridorClearance(mid,e.nx,e.nz,width,approachDepth(rise,doorW),buildings,skipId,fences);
 return {doorX,mid,sidewalk,rise,gap,roadDist:e.roadDist,len:e.len};
}
function pickStreetEntrance(edges,doorW,heightFn,buildings,skipId,floorHigh,fences){
 const slots=[];
 for(let i=0;i<edges.length;i++){
  const e=edges[i];
  if(e.len<=doorW+1.2)continue;
  const lo=.4,hi=e.len-doorW-.4;if(hi<lo)continue;
  const n=Math.max(1,Math.round((hi-lo)/.95));
  for(let k=0;k<=n;k++)slots.push({i,...scoreDoorSlot(e,lo+(hi-lo)*(n?k/n:0),doorW,heightFn,buildings,skipId,floorHigh,fences)});
 }
 if(!slots.length)return {i:-1,doorX:0};
 const good=slots.filter(s=>s.gap>=APPROACH_WALK);
 const pool=good.length?good:slots;
 const near=Math.min(...pool.map(s=>s.roadDist));
 const front=good.length&&near<22?pool.filter(s=>s.roadDist<=near+10):pool;
 const use=front.length?front:pool;
 if(good.length)use.sort((a,b)=>a.sidewalk-b.sidewalk||a.roadDist-b.roadDist||b.gap-a.gap||b.len-a.len);
 else use.sort((a,b)=>b.gap-a.gap||a.sidewalk-b.sidewalk||a.roadDist-b.roadDist||b.len-a.len);
 return use[0];
}
function addDoorFrame(e,doorX,doorW,doorH,sill,thick,frameGeoms,leafGeoms){
 const yaw=Math.atan2(-e.dz,e.dx),t=(doorX+doorW/2)/e.len,jamb=.14;
 const ox=e.a.x+e.dx*t-e.nx*(thick/2+.03),oz=e.a.z+e.dz*t-e.nz*(thick/2+.03);
 const c=Math.cos(yaw),s=Math.sin(yaw);
 const put=(geoms,bw,bh,bd,lx,ly,lz,spin=0)=>{
  const g=new T.BoxGeometry(bw,bh,bd);if(spin)g.rotateY(spin);g.rotateY(yaw);
  g.translate(ox+lx*c+lz*s,sill+ly,oz-lx*s+lz*c);geoms.push(g);
 };
 put(frameGeoms,jamb,doorH+.04,.18,-doorW/2-jamb/2,doorH/2,0);
 put(frameGeoms,jamb,doorH+.04,.18,doorW/2+jamb/2,doorH/2,0);
 put(frameGeoms,doorW+jamb*2,.14,.18,0,doorH+.07,0);
 put(frameGeoms,doorW,.08,.2,0,.04,0);
 put(leafGeoms,doorW*.46,doorH-.08,.05,-doorW/2+doorW*.24,doorH/2-.02,.02,.55);
}
export function createWorld(map){
 const scene=new T.Scene();addSky(scene);const terrain=map.terrain,height=terrain.height;
 scene.add(new T.HemisphereLight(0xd8e6f0,0x6a6550,1.75));const sun=new T.DirectionalLight(0xfff0cb,2.45);sun.position.set(-75,140,65);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-110,right:110,top:110,bottom:-110,near:1,far:320});sun.shadow.bias=-.0005;sun.shadow.normalBias=.08;sun.shadow.autoUpdate=false;scene.add(sun);
 const groundGeo=new T.PlaneGeometry(480,480,64,64);groundGeo.rotateX(-Math.PI/2);const pos=groundGeo.attributes.position;const colors=[];for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i),y=height(x,z);pos.setY(i,y);const c=new T.Color().setHSL(.19+Math.sin(x*.09)*.012,.14,.34+.025*Math.sin(x*.23+z*.31)+.01*Math.cos(z*.7));colors.push(c.r,c.g,c.b);}groundGeo.setAttribute('color',new T.Float32BufferAttribute(colors,3));groundGeo.computeVertexNormals(); paintCover(groundGeo,map);const ground=mesh(groundGeo,groundMaterial(map.satellite),scene);ground.castShadow=false;
 addWater(scene,map,height);
 const pixels=new Uint8Array(128*128*4);let seed=713;for(let i=0;i<pixels.length;i+=4){seed=(seed*1664525+1013904223)>>>0;const n=150+(seed%60);pixels[i]=pixels[i+1]=pixels[i+2]=n;pixels[i+3]=255;}const asphalt=new T.DataTexture(pixels,128,128,T.RGBAFormat);asphalt.wrapS=asphalt.wrapT=T.RepeatWrapping;asphalt.needsUpdate=true;asphalt.colorSpace=T.SRGBColorSpace;
 const roadMat=mat(0x777d80,{map:asphalt}),curbMat=mat(0xb9bbaf),pathMat=mat(0x969383),markMat=mat(0xd6d2b7);const roadMeshes=[];
 function addRoadGeometry(verts,indices,material){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(verts,3));const uv=[];for(let i=0;i<verts.length;i+=3)uv.push(verts[i]/5,verts[i+2]/5);g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();const m=mesh(g,material,scene);m.material.side=T.DoubleSide;m.castShadow=false;roadMeshes.push(m);}
 function strip(a,b,width,offset,material){let len=Math.hypot(b.x-a.x,b.z-a.z);if(len<.01)return;const nx=-(b.z-a.z)/len*width/2,nz=(b.x-a.x)/len*width/2;const verts=[],indices=[],steps=Math.ceil(len/2);for(let i=0;i<=steps;i++){const t=i/steps,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;verts.push(x+nx,height(x+nx,z+nz)+offset,z+nz,x-nx,height(x-nx,z-nz)+offset,z-nz);if(i<steps){const k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}}addRoadGeometry(verts,indices,material);}
 function junction(p,r,offset,material){const v=[p.x,height(p.x,p.z)+offset,p.z],ind=[];for(let i=0;i<=16;i++){const a=i/16*Math.PI*2,x=p.x+Math.cos(a)*r,z=p.z+Math.sin(a)*r;v.push(x,height(x,z)+offset,z);if(i<16)ind.push(0,i+1,i+2);}addRoadGeometry(v,ind,material);}
 const joints=new Map();for(const road of map.roads){for(let i=1;i<road.points.length;i++){let a=road.points[i-1],b=road.points[i];if(Math.min(Math.hypot(a.x,a.z),Math.hypot(b.x,b.z))>230)continue;const len=Math.hypot(b.x-a.x,b.z-a.z);if(len>500||len<.01)continue;strip(a,b,road.width+1.9,.055,curbMat);strip(a,b,road.width,.09,road.width<=3?pathMat:roadMat);for(const p of [a,b]){const key=`${p.x.toFixed(1)},${p.z.toFixed(1)}`;if(!joints.has(key)||joints.get(key).width<road.width)joints.set(key,{p,width:road.width});}if(road.width>=6&&len>8){for(let t=1;t<len-3;t+=7){const p={x:a.x+(b.x-a.x)*t/len,z:a.z+(b.z-a.z)*t/len},q={x:a.x+(b.x-a.x)*(t+2.8)/len,z:a.z+(b.z-a.z)*(t+2.8)/len};strip(p,q,.13,.105,markMat);}}}}
 for(const {p,width}of joints.values()){junction(p,(width+1.9)/2,.051,curbMat);junction(p,width/2,.086,width<=3?pathMat:roadMat);}
 for(const material of [roadMat,curbMat,pathMat,markMat]){const parts=roadMeshes.filter(m=>m.material===material);if(!parts.length)continue;const combined=mergeGeometries(parts.map(m=>m.geometry));const merged=mesh(combined,material,scene);merged.castShadow=false;for(const m of parts){scene.remove(m);m.geometry.dispose();}}
 const walls=[],slots=[];
 const wallMats=[mat(0xb8b5a0),mat(0xc4c0aa),mat(0xaaa997),mat(0xced0be)],roofMat=mat(0x969e91,{side:T.DoubleSide}),earthMat=mat(0x7a7564),floorMat=mat(0x7a7668,{side:T.DoubleSide});
 const frameMat=mat(0x3c3830),leafMat=mat(0x2a2620),stoneMat=mat(0x8a8580),railMat=mat(0x32322e),clutterMat=mat(0x606d70);
 const thick=.2,doorW=1.72,winW=1.05,winH=1.35;
 const wallBuckets=wallMats.map(()=>[]),earthAll=[],fills=[],floors=[],roofs=[],clutter=[],stone=[],rail=[],frames=[],leaves=[];
 map.yards=[];map.stairs=[];
 const yardKeys=new Set();
 for(const b of map.buildings){
  const p=b.points,cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2;
  const {high:cornerHigh,low:cornerLow}=footprintHighLow(p,height);
  const edges=[];
  for(let i=0;i<p.length;i++){
   const a=p[i],c=p[(i+1)%p.length],dx=c.x-a.x,dz=c.z-a.z,len=Math.hypot(dx,dz);if(len<.4)continue;
   let nx=dz/len,nz=-dx/len;if(inside((a.x+c.x)/2+nx*.2,(a.z+c.z)/2+nz*.2,p)){nx=-nx;nz=-nz;}
   const columns=Math.min(14,Math.max(1,Math.floor(len/3.8))),levels=Math.min(7,b.levels);
   const mx=(a.x+c.x)/2,mz=(a.z+c.z)/2,out={x:mx+nx*2.2,z:mz+nz*2.2};
   const road=nearestRoadPoint(out.x,out.z,map.roads);
   edges.push({a,c,dx,dz,len,nx,nz,columns,levels,mx,mz,out,roadDist:road?road.d:1e9,roadY:road?height(road.x,road.z):height(out.x,out.z)});
  }
  // Main floor is the highest ground in the footprint — a level plane, not a buried cut.
  b.base=cornerHigh;b.low=cornerLow-.08;b.shell=[];b.doors=[];
  b.storeys=[b.base];
  const doorH=(b.area<85&&(b.levels||1)<2)?1.4:2.12;
  let doorAt=-1,doorX=0,approachY=cornerLow;
  const picked=pickStreetEntrance(edges,doorW,height,map.buildings,b.id,cornerHigh,map.fences);
  if(picked.i>=0){doorAt=picked.i;doorX=picked.doorX;approachY=picked.sidewalk;}
  else{
   let bestLen=0;for(let i=0;i<edges.length;i++)if(edges[i].len>bestLen){bestLen=edges[i].len;doorAt=i;}
   if(doorAt>=0){const de=edges[doorAt];doorX=Math.max(.4,de.len/2-doorW/2);approachY=doorApproachY(de,(doorX+doorW/2)/de.len,height);}
  }
  if(doorAt>=0&&approachY>b.base)b.base=approachY;
  const drop=Math.max(0,b.base-cornerLow,b.base-approachY);
  b.storeys=[b.base];
  for(let k=1;k<=Math.min(4,Math.floor(drop/STOREY));k++){
   const y=b.base-k*STOREY;
   if(y<cornerLow-.2)break;
   b.storeys.push(y);
  }
  for(let i=1;i<Math.min(8,b.levels||1);i++){
   const y=b.base+i*STOREY;
   if(y+CLEAR_MIN>b.base+b.height+.05)break;
   b.storeys.push(y);
  }
  const entryY=b.storeys.filter(s=>s>=approachY-.12).reduce((m,s)=>Math.min(m,s),b.base);
  if(doorAt>=0){
   const e=edges[doorAt],lo=.4,hi=e.len-doorW-.4;
   if(hi>=lo){
    let best=scoreDoorSlot(e,doorX,doorW,height,map.buildings,b.id,entryY,map.fences);
    const n=Math.max(1,Math.round((hi-lo)/.8));
    for(let k=0;k<=n;k++){
     const s=scoreDoorSlot(e,lo+(hi-lo)*(n?k/n:0),doorW,height,map.buildings,b.id,entryY,map.fences);
     if(s.gap>best.gap+.05&&Math.abs(s.sidewalk-approachY)<.35)best=s;
    }
    doorX=best.doorX;
   }
  }
  const entryRel=entryY-b.base;
  const inner=insetPoints(p,thick+.08);
  const fillLevel=b.storeys.reduce((m,s)=>Math.min(m,s),b.base);
  const fillTop=Math.min(fillLevel,b.base-.04);
  const fillH=Math.max(.08,fillTop-b.low);
  b.fillLevel=fillLevel;b.fillH=fillH;
  if(fillH>.4){
   const ring=pullRingOffRoads(lotRing(b,map.fences),map.roads);
   if(ring)pushYard(map,yardKeys,ring,fillLevel);
  }
  if(inner){
   const fillShape=new T.Shape(inner.map(q=>new T.Vector2(q.x,-q.z)));
   const fillG=new T.ExtrudeGeometry(fillShape,{depth:fillH+.02,bevelEnabled:false});fillG.rotateX(-Math.PI/2);fillG.translate(0,b.low,0);fills.push(fillG);
  }
  const wells=[];
  const levelsY=[...new Set(b.storeys)].sort((a,c)=>a-c);
  let doorHint=null;
  if(doorAt>=0){
   const de=edges[doorAt],t=(doorX+doorW/2)/de.len,tl=de.len||1;
   doorHint={i:doorAt,mid:{x:de.a.x+de.dx*t,z:de.a.z+de.dz*t},nx:de.nx,nz:de.nz,tx:de.dx/tl,tz:de.dz/tl,w:doorW,doorX};
  }
  if(levelsY.length>1&&edges.length){
   const kind=stairKind(b,false),minW=stairWidthMin(kind);
   const rise=levelsY[1]-levelsY[0],spec=layoutStair(rise,kind,minW);
   const plan=placeInteriorPlan(inner||p,edges,spec,b,doorHint)||(inner?placeInteriorPlan(p,edges,spec,b,doorHint):null);
   if(plan){
    for(let k=1;k<levelsY.length;k++){
     const pairSpec=layoutStair(levelsY[k]-levelsY[k-1],kind,minW);
     const built=buildInteriorStairs(p,plan,levelsY[k-1],levelsY[k],pairSpec,{kind,stone,rail});
     for(const stair of built){map.stairs.push(stair);wells.push(stair);}
    }
   }
  }
  const wellAt=y=>{
   const seen=new Set(),holes=[];
   for(const s of wells){
    if((s.wellY0??s.y0)+.05>=y||(s.wellY1??s.y1)+.02<y)continue;
    const polys=(s.holes&&s.holes.length)?s.holes:(s.well?[s.well]:[]);
    for(const poly of polys){
     const key=(poly||[]).map(q=>`${q.x.toFixed(2)},${q.z.toFixed(2)}`).join('|');
     if(!key||seen.has(key))continue;seen.add(key);
     const h=holePath(poly,p);
     if(h)holes.push(h);
    }
   }
   return holes;
  };
  const lowest=levelsY[0];
  for(const y of levelsY){
   if(y<=lowest+.05)continue;
   floors.push(floorSlab(p,y,wellAt(y)));
  }
  const roofG=new T.ExtrudeGeometry(new T.Shape(p.map(q=>new T.Vector2(q.x,-q.z))),{depth:FLOOR_SLAB,bevelEnabled:false});roofG.rotateX(-Math.PI/2);roofG.translate(0,b.base+b.height,0);roofs.push(roofG);
  if(inside(cx,cz,p)&&b.area>80){
   const ac=new T.BoxGeometry(2.3,.45,1.2);ac.translate(cx,b.base+b.height+.22,cz);clutter.push(ac);
  }
  const parts=[],earthParts=[];
  const wallMatIndex=Number(b.id)%4||0;
  for(let ei=0;ei<edges.length;ei++){
   const e=edges[ei],hasDoor=ei===doorAt&&e.len>doorW+1.2,holes=[];
   const overlapsDoor=(x0,y,w,h)=>hasDoor&&x0<doorX+doorW&&x0+w>doorX&&y<entryRel+doorH&&y+h>entryRel;
   const windowOk=(storey,gnd)=>storey+1.05>=gnd+.25&&storey>=livableFloor(b.base,gnd)-.02;
   if(hasDoor)holes.push({x:doorX,y:entryRel,w:doorW,h:doorH,door:true});
   for(let floorI=0;floorI<e.levels;floorI++)for(let col=0;col<e.columns;col++){
    const x0=(col+.5)/e.columns*e.len-winW/2;if(x0<.18||x0+winW>e.len-.18)continue;
    const gnd=sampleOut(e,(col+.5)/e.columns,height);
    const storey=b.base+floorI*STOREY;
    if(!windowOk(storey,gnd)||overlapsDoor(x0,storey-b.base+1.05,winW,winH))continue;
    holes.push({x:x0,y:storey-b.base+1.05,w:winW,h:winH});
   }
   for(let k=1;k<b.storeys.length;k++){
    if(b.storeys[k]>b.base-.1)continue;
    for(let col=0;col<e.columns;col++){
    const x0=(col+.5)/e.columns*e.len-winW/2;if(x0<.18||x0+winW>e.len-.18)continue;
    const gnd=sampleOut(e,(col+.5)/e.columns,height);
    if(!windowOk(b.storeys[k],gnd)||overlapsDoor(x0,b.storeys[k]-b.base+1.05,winW,winH))continue;
    holes.push({x:x0,y:b.storeys[k]-b.base+1.05,w:winW,h:winH});
   }}
   if(hasDoor){
    const t0=doorX/e.len,t1=(doorX+doorW)/e.len;
    const da={x:e.a.x+e.dx*t0,z:e.a.z+e.dz*t0},db={x:e.a.x+e.dx*t1,z:e.a.z+e.dz*t1};
    b.shell.push({a:e.a,b:da,thick},{a:db,b:e.c,thick});
    b.doors.push({a:da,b:db,bottom:entryY,top:entryY+doorH,thick});
    addDoorFrame(e,doorX,doorW,doorH,entryY,thick,frames,leaves);
    const mid={x:(da.x+db.x)/2,z:(da.z+db.z)/2};
    cutFenceGate(map.fences,mid,e.nx,e.nz,doorW,Math.max(2.6,approachDepth(Math.max(0,entryY-approachY),doorW)));
    const landingY=doorLandingY(mid,e,map,height);
    if(entryY-landingY>.45){
     const kind=stairKind(b,true),width=Math.max(doorW,stairWidthMin(kind));
     const surface=(x,z)=>standHeight(x,z,map.buildings,height(x,z),map.yards,[],null,map.roads);
     let startY=Math.min(entryY-.28,landingY,approachY);
     const guess=layoutStair(Math.max(.28,entryY-startY),kind,width);
     const run0=guess.n*guess.B+.12;
     for(const t of [1,.75,.45,.2]){
      const x=mid.x+e.nx*run0*t,z=mid.z+e.nz*run0*t;
      startY=Math.min(startY,surface(x,z),height(x,z));
     }
     startY=Math.max(startY,entryY-STOREY);
     const rise=entryY-startY;
     if(rise>.45&&corridorClearance(mid,e.nx,e.nz,width,Math.min(2.4,approachDepth(rise,doorW)),map.buildings,b.id,map.fences)>0){
      const spec=layoutStair(rise,kind,width);
      const from={x:mid.x+e.nx*(spec.n*spec.B+.08),z:mid.z+e.nz*(spec.n*spec.B+.08)};
      const footY=Math.min(startY,surface(from.x,from.z),height(from.x,from.z));
      const stair=addStairFlight(from,mid,Math.max(footY,entryY-STOREY),entryY,spec,{kind,stone,rail});
      if(stair)map.stairs.push(stair);
     }
    }
   }else b.shell.push({a:e.a,b:e.c,thick});
   const yaw=Math.atan2(-e.dz,e.dx);
   const segs=Math.max(e.columns,Math.ceil(e.len/2.2));
   for(let s=0;s<segs;s++){
    const x0=s/segs*e.len,x1=(s+1)/segs*e.len,tm=(x0+x1)/2/e.len,span=x1-x0;
    const gnd=Math.min(b.base,sampleOut(e,tm,height));
    let live=livableFloor(b.base,gnd);
    const onDoor=hasDoor&&x0<doorX+doorW&&x1>doorX;
    if(onDoor)live=entryY;
    const wallBottom=live-b.base,wallTop=b.height;
    if(live-gnd>.08){
     const eh=live-gnd,along=tm;
     const inset=onDoor?thick/2:thick/2+.04;
     const wx=e.a.x+e.dx*along-e.nx*inset,wz=e.a.z+e.dz*along-e.nz*inset;
     const g=new T.BoxGeometry(span+.02,eh,onDoor?thick+.06:thick+.1);g.rotateY(yaw);g.translate(wx,gnd+eh/2,wz);earthParts.push(g);
    }
    const local=holes.filter(h=>{
     if(h.x>=x1-.01||h.x+h.w<=x0+.01||h.y+h.h<=wallBottom+.05||h.y>=wallTop)return false;
     if(h.door&&Math.abs(wallBottom-entryRel)>.05)return false;
     return true;
    }).map(h=>({x:h.x-x0,y:h.y-wallBottom,w:h.w,h:h.h}));
    for(const r of wallRects(span,wallTop-wallBottom,local)){
     const rw=r.x1-r.x0,hh=r.y1-r.y0,along=(x0+(r.x0+r.x1)/2)/e.len;
     const wx=e.a.x+e.dx*along-e.nx*thick/2,wz=e.a.z+e.dz*along-e.nz*thick/2,wy=b.base+wallBottom+r.y0+hh/2;
     const g=new T.BoxGeometry(rw,hh,thick);g.rotateY(yaw);g.translate(wx,wy,wz);parts.push(g);
    }
   }
   if(hasDoor){
    const along=(doorX+doorW/2)/e.len;
    const wx=e.a.x+e.dx*along-e.nx*thick/2,wz=e.a.z+e.dz*along-e.nz*thick/2;
    const sill=new T.BoxGeometry(doorW+.04,.1,thick+.08);sill.rotateY(yaw);sill.translate(wx,entryY+.05,wz);parts.push(sill);
   }
   for(let col=0;col<e.columns;col++){
    const t=(col+.5)/e.columns,x=e.a.x+e.dx*t,z=e.a.z+e.dz*t,ix=x-e.nx*1.25,iz=z-e.nz*1.25;
    if(!inside(ix,iz,p)||Math.hypot(ix,iz)>=map.radius-8)continue;
    if(p.some((pt,i)=>segmentDistance(ix,iz,pt,p[(i+1)%p.length])<.7))continue;
    slots.push({x:ix,z:iz,y:b.base,angle:Math.atan2(e.nx,e.nz),building:b,floor:0,type:'interior'});
   }
  }
  if(parts.length)wallBuckets[wallMatIndex].push(...parts);
  if(earthParts.length)earthAll.push(...earthParts);
 }
 commit(fills,earthMat,scene,walls,{cast:false});
 commit(floors,floorMat,scene,walls,{cast:false});
 commit(roofs,roofMat,scene,walls);
 for(let i=0;i<wallMats.length;i++)commit(wallBuckets[i],wallMats[i],scene,walls);
 commit(earthAll,earthMat,scene,walls,{cast:false});
 commit(clutter,clutterMat,scene,walls,{cast:false,occlude:false});
 commit(frames,frameMat,scene,walls,{cast:false,occlude:false});
 commit(leaves,leafMat,scene,walls,{cast:false,occlude:false});
 commit(stone,stoneMat,scene,walls,{cast:false,occlude:false});
 commit(rail,railMat,scene,walls,{cast:false,occlude:false});
 const lotSurface=(x,z)=>{
  let y=height(x,z);
  for(const yard of map.yards||[]){
   if(x<yard.minX-.4||x>yard.maxX+.4||z<yard.minZ-.4||z>yard.maxZ+.4)continue;
   const ring=yard.points;
   if(inside(x,z,ring)||ring.some((p,i)=>segmentDistance(x,z,p,ring[(i+1)%ring.length])<.35))y=Math.max(y,yard.top);
  }
  return y;
 };
 addYards(scene,map,height);
 addFences(scene,map,lotSurface);
 addTrees(scene,map,lotSurface);
 // A subtle boundary keeps players within the actually downloaded area.
 const edgePoints=[];for(let i=0;i<=64;i++){const a=i/64*Math.PI*2,x=Math.cos(a)*map.radius,z=Math.sin(a)*map.radius;edgePoints.push(V(x,height(x,z)+.2,z));}scene.add(new T.Line(new T.BufferGeometry().setFromPoints(edgePoints),new T.LineBasicMaterial({color:0xd9e58e,transparent:true,opacity:.4})));
 scene.updateMatrixWorld(true);
 return {scene,walls,ground,sun,slots,terrain,height};
}
export function person(scene,color){const group=new T.Group();scene.add(group);const body=mesh(new T.CapsuleGeometry(.23,.55,4,6),mat(color),group,0,.9,0);mesh(new T.SphereGeometry(.22,8,6),mat(0x8c826e),group,0,1.57,0);box(group,.44,.2,.4,0x353b32,0,1.7,0);box(group,.14,.52,.15,color,-.16,.27,0);box(group,.14,.52,.15,color,.16,.27,0);box(group,.14,.13,.8,0x25292a,.19,1.19,-.4);return {group,body,update(_dt,_moving=0,flags={}){group.scale.set(1,flags.crouch?.62:1,1);}};}
export function disposeWorld(scene){const gs=new Set(),ms=new Set(),ts=new Set();scene.traverse(o=>{if(o.geometry)gs.add(o.geometry);if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{ms.add(m);if(m.userData?.detail)ts.add(m.userData.detail);});});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());ts.forEach(t=>t.dispose());}
