import {inside,polygonArea,markFenceOpening} from './map-model.js';
import {coverageFromPhoto,PHOTO_METERS} from './satellite.js';

const GRID=160;
function cellKind(r,g,b){
 const mx=Math.max(r,g,b),mn=Math.min(r,g,b),sat=mx?(mx-mn)/mx:0;
 if(r>100&&r>g+16&&r>b+12&&g>38&&r<235)return 'roof';
 if(sat<.18&&mx>175&&mn>140)return 'roof';
 if(g>r+7&&g>b+4&&g>42&&g<155&&sat>.11)return 'tree';
 if(g>=r-6&&g>b-8&&g>68&&g<195&&sat>.07&&sat<.5)return 'grass';
 if(sat<.14&&mx>72&&mx<205)return 'road';
 return 'other';
}
function flood(kind,sx,sy,seen,grid,n){
 const stack=[[sx,sy]],cells=[];
 while(stack.length){
  const [x,y]=stack.pop();
  const i=y*n+x;if(x<0||y<0||x>=n||y>=n||seen[i]||grid[i]!==kind)continue;
  seen[i]=1;cells.push([x,y]);
  stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
 }
 return cells;
}
function toWorld(x,y,n,span){
 return {x:(x+.5)/n*span-span/2,z:(y+.5)/n*span-span/2};
}
function buildingFromCells(cells,n,span,id){
 const xs=cells.map(c=>c[0]),ys=cells.map(c=>c[1]);
 const x0=Math.min(...xs),x1=Math.max(...xs)+1,y0=Math.min(...ys),y1=Math.max(...ys)+1;
 const pad=span/n*.15;
 const minX=x0/n*span-span/2-pad,maxX=x1/n*span-span/2+pad,minZ=y0/n*span-span/2-pad,maxZ=y1/n*span-span/2+pad;
 const points=[{x:minX,z:minZ},{x:maxX,z:minZ},{x:maxX,z:maxZ},{x:minX,z:maxZ}];
 const area=polygonArea(points);
 if(area<28||area>9000)return null;
 const levels=area>380?2:1;
 return {id:`photo-${id}`,points,tags:{},area,height:levels*3.1+1.1,levels,verified:false,minX,maxX,minZ,maxZ,photo:true};
}
export function analyzeRaster(data,width,height,span=PHOTO_METERS){
 const n=GRID,grid=new Uint8Array(n*n),kindId={roof:1,tree:2,grass:3,road:4,other:0};
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const px=Math.min(width-1,Math.floor((x+.5)/n*width)),py=Math.min(height-1,Math.floor((y+.5)/n*height));
  const i=(py*width+px)*4;
  const name=cellKind(data[i],data[i+1],data[i+2]);
  grid[y*n+x]=kindId[name];
 }
 const names=['other','roof','tree','grass','road'],seen=new Uint8Array(n*n);
 const buildings=[],trees=[],grass=[];
 let roadCells=0,id=1;
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const i=y*n+x;if(seen[i]||!grid[i])continue;
  const kind=names[grid[i]],cells=flood(grid[i],x,y,seen,grid,n);
  if(kind==='roof'&&cells.length>=6){const b=buildingFromCells(cells,n,span,id++);if(b)buildings.push(b);}
  else if(kind==='tree'&&cells.length>=2){
   const step=cells.length<70?cells.length:Math.max(8,Math.floor(cells.length/5));
   for(let i=0;i<cells.length&&trees.length<160;i+=step){
    const c=toWorld(cells[i][0],cells[i][1],n,span);
    trees.push({x:c.x,z:c.z,h:4.2+Math.min(4.5,cells.length*.05),photo:true});
   }
  }else if(kind==='grass'&&cells.length>=8)grass.push(cells);
  else if(kind==='road')roadCells+=cells.length;
 }
 const fences=[];
 for(const b of buildings){
  if(b.area>420)continue;
  const cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2,pad=4.2;
  const ring=[{x:b.minX-pad,z:b.minZ-pad},{x:b.maxX+pad,z:b.minZ-pad},{x:b.maxX+pad,z:b.maxZ+pad},{x:b.minX-pad,z:b.maxZ+pad},{x:b.minX-pad,z:b.minZ-pad}];
  if(buildings.some(o=>o!==b&&o.minX<b.maxX+pad&&o.maxX>b.minX-pad&&o.minZ<b.maxZ+pad&&o.maxZ>b.minZ-pad))continue;
  const yardGrass=grass.some(cells=>cells.some(([x,y])=>{
   const p=toWorld(x,y,n,span);return Math.hypot(p.x-cx,p.z-cz)<pad+8&&!inside(p.x,p.z,b.points);
  }));
  if(yardGrass)fences.push(markFenceOpening({id:`photo-fence-${b.id}`,points:ring,kind:'fence',width:.08,height:1.15,inferred:true}));
 }
 const roads=[];
 if(roadCells>12){
  const mid=n/2,east=[],south=[];
  for(let x=0;x<n;x++)if(grid[Math.floor(mid)*n+x]===4)east.push(toWorld(x,mid,n,span));
  for(let y=0;y<n;y++)if(grid[y*n+Math.floor(mid)]===4)south.push(toWorld(mid,y,n,span));
  if(east.length>=3)roads.push({width:7,points:[east[0],east.at(-1)],name:'PHOTO',kind:'residential'});
  if(south.length>=3)roads.push({width:6,points:[south[0],south.at(-1)],name:'',kind:'residential'});
 }
 if(!roads.length)roads.push({width:8,points:[{x:0,z:-span/2},{x:0,z:span/2}],name:'PHOTO',kind:'residential'});
 return {buildings,trees:trees.slice(0,160),fences,roads,span};
}
export function analyzeImage(image,span=PHOTO_METERS){
 const w=Math.min(512,image.width||image.displayWidth||256),h=Math.min(512,image.height||image.displayHeight||256);
 const canvas=typeof document!=='undefined'?document.createElement('canvas'):null;
 if(!canvas)throw Error('Photo analysis needs a canvas.');
 canvas.width=w;canvas.height=h;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 ctx.drawImage(image,0,0,w,h);
 return analyzeRaster(ctx.getImageData(0,0,w,h).data,w,h,span);
}
export function mergePhotoFeatures(map,features){
 if(!features)return map;
 const taken=(map.trees||[]).map(t=>[t.x,t.z]);
 for(const t of features.trees||[]){
  if(taken.some(p=>Math.hypot(t.x-p[0],t.z-p[1])<4.5))continue;
  if(map.buildings.some(b=>t.x>=b.minX&&t.x<=b.maxX&&t.z>=b.minZ&&t.z<=b.maxZ&&inside(t.x,t.z,b.points)))continue;
  map.trees.push(t);taken.push([t.x,t.z]);
 }
 if((map.fences||[]).length<(map.buildings.length||1)*.15){
  for(const f of features.fences||[])map.fences.push(f);
 }
 return map;
}
export function mapFromPhoto(image,name='Aerial photo stage'){
 const features=analyzeImage(image);
 const radius=Math.max(70,features.span/2-8);
 let spawn=features.roads[0]?.points?.[0]||{x:0,z:radius*.35};
 for(const r of features.roads)for(const p of r.points){
  if(Math.hypot(p.x,p.z)<radius-6&&!features.buildings.some(b=>inside(p.x,p.z,b.points))){spawn=p;break;}
 }
 return {
  name,real:false,photo:true,lat:null,lon:null,radius,
  buildings:features.buildings,roads:features.roads,cover:[],
  fences:features.fences,trees:features.trees,yards:[],spawn,
  satellite:coverageFromPhoto(image,null,null,features.span)
 };
}
export function photoCoverage(image,lat,lon){return coverageFromPhoto(image,lat,lon);}
