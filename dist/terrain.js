const N=16384;
export function tileXY(lat,lon){return {x:(lon+180)/360*N,y:(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*N};}
export function decode(r,g,b){return r*256+g+b/256-32768;}
export const FLAT={height:()=>0,base:0,real:false,range:0,label:'Flat terrain fallback — no elevation data'};
const bundled=new Set(['9789/6668','8290/6119','8291/6119','9774/6649']);
export async function loadTerrain(lat,lon){
 const cos=Math.cos(lat*Math.PI/180),r=245,top=tileXY(lat+r/111320,lon-r/(111320*cos)),bottom=tileXY(lat-r/111320,lon+r/(111320*cos));
 const tiles=new Map();
 const jobs=[];
 for(let x=Math.floor(top.x);x<=Math.floor(bottom.x);x++)for(let y=Math.floor(top.y);y<=Math.floor(bottom.y);y++)jobs.push((async()=>{
  const key=`${x}/${y}`,url=bundled.has(key)?`./elevation-14-${x}-${y}.png`:`https://elevation-tiles-prod.s3.amazonaws.com/terrarium/14/${key}.png`;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),14000);
  try{const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw Error('Elevation unavailable');const bitmap=await createImageBitmap(await response.blob(),{colorSpaceConversion:'none'});const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);tiles.set(key,ctx.getImageData(0,0,256,256).data);bitmap.close();}finally{clearTimeout(timer);}
 })());
 await Promise.all(jobs);
 const sample=(lat,lon)=>{const t=tileXY(lat,lon),ix=Math.floor(t.x),iy=Math.floor(t.y),d=tiles.get(`${ix}/${iy}`);if(!d)return NaN;const px=Math.min(254.999,Math.max(0,(t.x-ix)*256)),py=Math.min(254.999,Math.max(0,(t.y-iy)*256)),x=Math.floor(px),y=Math.floor(py),u=px-x,v=py-y;const at=(x,y)=>{const p=(y*256+x)*4;return decode(d[p],d[p+1],d[p+2]);};return at(x,y)*(1-u)*(1-v)+at(x+1,y)*u*(1-v)+at(x,y+1)*(1-u)*v+at(x+1,y+1)*u*v;};
 const base=sample(lat,lon);if(!Number.isFinite(base))throw Error('Elevation missing');
 const height=(x,z)=>{const value=sample(lat-z/111320,lon+x/(111320*cos));return Number.isFinite(value)?value-base:0;};
 let min=Infinity,max=-Infinity;for(let z=-195;z<=195;z+=15)for(let x=-195;x<=195;x+=15){const h=height(x,z);min=Math.min(min,h);max=Math.max(max,h);}
 return {height,base,real:true,range:max-min,label:`DEM terrain · ${Math.round(max-min)} m relief · not survey-grade`};
}
