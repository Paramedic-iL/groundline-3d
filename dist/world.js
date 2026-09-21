import * as T from './three.module.js';
import {inside,segmentDistance,closedRing,polygonArea,standHeight} from './map-model.js';
import {mergeGeometries} from './BufferGeometryUtils.js';
const V=(x,y,z)=>new T.Vector3(x,y,z);
const mat=(color,extra={})=>new T.MeshStandardMaterial({color,roughness:.95,...extra});
function mesh(geometry,material,parent,x=0,y=0,z=0){const m=new T.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
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
   const pad=mesh(new T.ExtrudeGeometry(shape,{depth,bevelEnabled:false}),padMat,scene,0,low,0);
   pad.rotation.x=-Math.PI/2;pad.castShadow=false;
  }catch{/* skip degenerate yard rings */}
 }
}
function addFences(scene,map,surface){
 const postMat=mat(0x3c3830),railMat=mat(0x4d473c),hedgeMat=mat(0x3a5c33),wallMat=mat(0x8b8676);
 const posts=[],rails=[],hedges=[],walls=[];
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
     const t=t0+(t1-t0)*s/steps,x=a.x+dx*t,z=a.z+dz*t,y=surface(x,z);
     if(!hedge){
      const pg=new T.BoxGeometry(.07,f.height,.07);pg.translate(x,y+f.height/2,z);posts.push(pg);
     }
    }
    for(let s=0;s<steps;s++){
     const u0=t0+(t1-t0)*s/steps,u1=t0+(t1-t0)*(s+1)/steps,mx=a.x+dx*(u0+u1)/2,mz=a.z+dz*(u0+u1)/2;
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
 if(trunks.length){const g=mergeGeometries(trunks);if(g)mesh(g,trunkMat,scene);}
 if(crowns.length){const g=mergeGeometries(crowns);if(g){const c=mesh(g,leafMat,scene);c.castShadow=false;}}
 for(const g of [...trunks,...crowns])g.dispose();
}
export function createWorld(map){
 const scene=new T.Scene();addSky(scene);const terrain=map.terrain,height=terrain.height;
 scene.add(new T.HemisphereLight(0xd8e6f0,0x6a6550,1.75));const sun=new T.DirectionalLight(0xfff0cb,2.45);sun.position.set(-75,140,65);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-130,right:130,top:130,bottom:-130,near:1,far:360});sun.shadow.bias=-.0004;sun.shadow.normalBias=.07;scene.add(sun);
 const groundGeo=new T.PlaneGeometry(480,480,96,96);groundGeo.rotateX(-Math.PI/2);const pos=groundGeo.attributes.position;const colors=[];for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i),y=height(x,z);pos.setY(i,y);const c=new T.Color().setHSL(.19+Math.sin(x*.09)*.012,.14,.34+.025*Math.sin(x*.23+z*.31)+.01*Math.cos(z*.7));colors.push(c.r,c.g,c.b);}groundGeo.setAttribute('color',new T.Float32BufferAttribute(colors,3));groundGeo.computeVertexNormals(); paintCover(groundGeo,map);const ground=mesh(groundGeo,groundMaterial(map.satellite),scene);ground.castShadow=false;
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
 const wallMats=[mat(0xb8b5a0),mat(0xc4c0aa),mat(0xaaa997),mat(0xced0be)],roofMat=mat(0x969e91),foundation=mat(0x858677),floorMat=mat(0x7a7668);
 const thick=.2,doorW=1.72,winW=1.05,winH=1.35;
 map.yards=[];
 const yardKeys=new Set();
 for(const b of map.buildings){
  const p=b.points,cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2;
  const values=p.map(q=>height(q.x,q.z)),cornerHigh=Math.max(...values),cornerLow=Math.min(...values);
  const edges=[];let doorAt=-1,bestLen=0;
  for(let i=0;i<p.length;i++){
   const a=p[i],c=p[(i+1)%p.length],dx=c.x-a.x,dz=c.z-a.z,len=Math.hypot(dx,dz);if(len<.4)continue;
   let nx=dz/len,nz=-dx/len;if(inside((a.x+c.x)/2+nx*.2,(a.z+c.z)/2+nz*.2,p)){nx=-nx;nz=-nz;}
   const columns=Math.min(14,Math.max(1,Math.floor(len/3.8))),levels=Math.min(7,b.levels);
   edges.push({a,c,dx,dz,len,nx,nz,columns,levels});
   if(len>=3.6&&len>bestLen){bestLen=len;doorAt=edges.length-1;}
  }
  let doorGround=cornerLow;
  if(doorAt>=0){
   const e=edges[doorAt],mx=(e.a.x+e.c.x)/2,mz=(e.a.z+e.c.z)/2;
   doorGround=height(mx+e.nx*.45,mz+e.nz*.45);
  }
  // Door sill is never below ground at the opening; floor follows that sill.
  b.base=doorGround;b.low=Math.min(cornerLow,doorGround)-.3;b.shell=[];b.doors=[];
  for(const f of map.fences||[]){
   const ring=closedRing(f.points);if(!ring||!inside(cx,cz,ring))continue;
   const area=polygonArea(ring);if(area<b.area*1.05||area>b.area*18)continue;
   const fenceGround=ring.reduce((s,q)=>s+height(q.x,q.z),0)/ring.length;
   const drop=cornerHigh-fenceGround;
   if(drop<.7||drop>3.6)continue;
   const yardTop=Math.max(doorGround,fenceGround+Math.min(drop,1.65));
   b.base=Math.max(b.base,yardTop);
   const key=String(f.id??ring.length+','+area.toFixed(1));
   if(!yardKeys.has(key)){
    yardKeys.add(key);
    map.yards.push({points:ring,top:yardTop,minX:Math.min(...ring.map(q=>q.x)),maxX:Math.max(...ring.map(q=>q.x)),minZ:Math.min(...ring.map(q=>q.z)),maxZ:Math.max(...ring.map(q=>q.z))});
   }
   break;
  }
  const doorH=(b.area<85||Number(b.id)%5===2)?1.4:2.12;
  const footprint=()=>new T.Shape(p.map(q=>new T.Vector2(q.x,-q.z)));
  const foundationHeight=b.base-b.low;const foundationMesh=mesh(new T.ExtrudeGeometry(footprint(),{depth:foundationHeight+.01,bevelEnabled:false}),foundation,scene,0,b.low,0);foundationMesh.rotation.x=-Math.PI/2;walls.push(foundationMesh);
  const floor=mesh(new T.ExtrudeGeometry(footprint(),{depth:.06,bevelEnabled:false}),floorMat,scene,0,b.base,0);floor.rotation.x=-Math.PI/2;floor.castShadow=false;
  const roof=mesh(new T.ExtrudeGeometry(footprint(),{depth:.1,bevelEnabled:false}),roofMat,scene,0,b.base+b.height,0);roof.rotation.x=-Math.PI/2;walls.push(roof);
  if(inside(cx,cz,p)&&b.area>50){box(scene,2.3,.45,1.2,0x606d70,cx,b.base+b.height+.22,cz);box(scene,.7,.65,.7,0xb4b7a2,cx+2,b.base+b.height+.3,cz);}
  const wallMat=wallMats[Number(b.id)%4||0],parts=[];
  for(let ei=0;ei<edges.length;ei++){
   const e=edges[ei],hasDoor=ei===doorAt&&e.len>doorW+1.2,doorX=e.len/2-doorW/2,holes=[];
   if(hasDoor)holes.push({x:doorX,y:0,w:doorW,h:doorH});
   for(let floorI=0;floorI<e.levels;floorI++)for(let col=0;col<e.columns;col++){
    if(hasDoor&&floorI===0&&col===Math.floor(e.columns/2))continue;
    const x0=(col+.5)/e.columns*e.len-winW/2;if(x0<.18||x0+winW>e.len-.18)continue;
    holes.push({x:x0,y:floorI*3.2+1.05,w:winW,h:winH});
   }
   if(hasDoor){
    const t0=doorX/e.len,t1=(doorX+doorW)/e.len;
    const da={x:e.a.x+e.dx*t0,z:e.a.z+e.dz*t0},db={x:e.a.x+e.dx*t1,z:e.a.z+e.dz*t1};
    b.shell.push({a:e.a,b:da,thick},{a:db,b:e.c,thick});
    b.doors.push({a:da,b:db,bottom:b.base,top:b.base+doorH,thick});
   }else b.shell.push({a:e.a,b:e.c,thick});
   const yaw=Math.atan2(-e.dz,e.dx);
   for(const r of wallRects(e.len,b.height,holes)){
    const w=r.x1-r.x0,h=r.y1-r.y0,mid=(r.x0+r.x1)/2/e.len;
    const wx=e.a.x+e.dx*mid-e.nx*thick/2,wz=e.a.z+e.dz*mid-e.nz*thick/2,wy=b.base+r.y0+h/2;
    const g=new T.BoxGeometry(w,h,thick);g.rotateY(yaw);g.translate(wx,wy,wz);parts.push(g);
   }
   for(let col=0;col<e.columns;col++){
    const t=(col+.5)/e.columns,x=e.a.x+e.dx*t,z=e.a.z+e.dz*t,ix=x-e.nx*1.25,iz=z-e.nz*1.25;
    if(!inside(ix,iz,p)||Math.hypot(ix,iz)>=map.radius-8)continue;
    if(p.some((pt,i)=>segmentDistance(ix,iz,pt,p[(i+1)%p.length])<.7))continue;
    slots.push({x:ix,z:iz,y:b.base,angle:Math.atan2(e.nx,e.nz),building:b,floor:0,type:'interior'});
   }
  }
  if(parts.length){
   const combined=mergeGeometries(parts);
   if(combined){const panel=mesh(combined,wallMat,scene);walls.push(panel);}
   for(const g of parts)g.dispose();
  }
 }
 const surface=(x,z)=>standHeight(x,z,map.buildings,height(x,z),map.yards);
 addYards(scene,map,height);
 addFences(scene,map,surface);
 addTrees(scene,map,surface);
 // A subtle boundary keeps players within the actually downloaded area.
 const edgePoints=[];for(let i=0;i<=128;i++){const a=i/128*Math.PI*2,x=Math.cos(a)*map.radius,z=Math.sin(a)*map.radius;edgePoints.push(V(x,height(x,z)+.2,z));}scene.add(new T.Line(new T.BufferGeometry().setFromPoints(edgePoints),new T.LineBasicMaterial({color:0xd9e58e,transparent:true,opacity:.4})));
 scene.updateMatrixWorld(true);
 return {scene,walls,ground,sun,slots,terrain,height};
}
export function person(scene,color){const group=new T.Group();scene.add(group);const body=mesh(new T.CapsuleGeometry(.23,.55,4,6),mat(color),group,0,.9,0);mesh(new T.SphereGeometry(.22,8,6),mat(0x8c826e),group,0,1.57,0);box(group,.44,.2,.4,0x353b32,0,1.7,0);box(group,.14,.52,.15,color,-.16,.27,0);box(group,.14,.52,.15,color,.16,.27,0);box(group,.14,.13,.8,0x25292a,.19,1.19,-.4);return {group,body,update(_dt,_moving=0,flags={}){group.scale.set(1,flags.crouch?.62:1,1);}};}
export function disposeWorld(scene){const gs=new Set(),ms=new Set(),ts=new Set();scene.traverse(o=>{if(o.geometry)gs.add(o.geometry);if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{ms.add(m);if(m.userData?.detail)ts.add(m.userData.detail);});});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());ts.forEach(t=>t.dispose());}
