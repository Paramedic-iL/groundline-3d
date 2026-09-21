import {tileXY} from './terrain.js';
import * as T from './three.module.js';

const LOCAL=new Set(['9789/6668','9774/6649','8290/6119','8291/6119']);
const YEARS=[2025,2024,2023,2020];
const MATRICES=['g','GoogleMapsCompatible'];
export const GROUND_METERS=480;
export const PHOTO_METERS=260;
const GROUND_TEXELS=1024;
let endpoint=null;

export function metersPerPixel(lat){
 return 40075016.686*Math.cos(lat*Math.PI/180)/(16384*256);
}

function localUrl(x,y){return `./satellite-${x}-${y}.jpg`;}
function remoteUrl(year,matrix,x,y){return `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${year}_3857/default/${matrix}/14/${y}/${x}.jpg`;}

function tileCandidates(x,y){
 const key=`${x}/${y}`, urls=[];
 if(endpoint)urls.push(remoteUrl(endpoint.year,endpoint.matrix,x,y));
 else for(const year of YEARS)for(const matrix of MATRICES)urls.push(remoteUrl(year,matrix,x,y));
 if(LOCAL.has(key))urls.push(localUrl(x,y));
 return urls;
}

function rankUrl(url){
 if(url.startsWith('.'))return 50;
 const year=Number((url.match(/s2cloudless-(\d{4})/)||[])[1]||0);
 return YEARS.indexOf(year);
}

async function fetchBitmap(url,ms=8000){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),ms);
 try{
  const response=await fetch(url,{signal:controller.signal,mode:'cors'});
  if(!response.ok)return null;
  const blob=await response.blob();
  if(blob.size<800)return null;
  return await createImageBitmap(blob,{colorSpaceConversion:'none'});
 }catch{return null;}
 finally{clearTimeout(timer);}
}

function fetchImage(url,ms=8000){
 return new Promise(resolve=>{
  const image=new Image();
  image.crossOrigin='anonymous';
  const timer=setTimeout(()=>{image.src='';resolve(null);},ms);
  image.onload=()=>{clearTimeout(timer);resolve(image);};
  image.onerror=()=>{clearTimeout(timer);resolve(null);};
  image.src=url;
 });
}

async function loadOneTile(x,y){
 const urls=tileCandidates(x,y);
 const hits=(await Promise.all(urls.map(async url=>{
  const image=await fetchBitmap(url,5500)||await fetchImage(url,4500);
  return image?{url,image}:null;
 }))).filter(Boolean);
 if(!hits.length)return null;
 hits.sort((a,b)=>rankUrl(a.url)-rankUrl(b.url));
 const {url,image}=hits[0];
 if(!endpoint&&url.startsWith('http')){
  const match=url.match(/s2cloudless-(\d{4})_3857\/default\/([^/]+)\//);
  if(match)endpoint={year:Number(match[1]),matrix:match[2]};
 }
 return {x,y,image,year:url.startsWith('.')?2020:endpoint?.year||2020,source:url.startsWith('.')?'bundled':'live'};
}

function tileWindow(lat,lon,span){
 const center=tileXY(lat,lon),mpp=metersPerPixel(lat),sourceSize=span/mpp,h=sourceSize/512;
 const tiles=[];
 for(let x=Math.floor(center.x-h);x<=Math.floor(center.x+h);x++)
  for(let y=Math.floor(center.y-h);y<=Math.floor(center.y+h);y++)tiles.push({x,y});
 return {center,mpp,span,sourceSize,keys:tiles};
}

export function composeGroundTexture(coverage,sizeMeters=GROUND_METERS){
 if(!coverage?.tiles?.length)return null;
 const {tiles,center,mpp}=coverage;
 const canvas=document.createElement('canvas');
 canvas.width=canvas.height=GROUND_TEXELS;
 const ctx=canvas.getContext('2d',{alpha:false,colorSpace:'srgb'});
 ctx.imageSmoothingEnabled=true;
 ctx.imageSmoothingQuality='high';
 ctx.fillStyle='#6d7a68';
 ctx.fillRect(0,0,GROUND_TEXELS,GROUND_TEXELS);
 const scale=GROUND_TEXELS/sizeMeters,tileM=256*mpp;
 for(const t of tiles){
  const px=((t.x-center.x)*tileM+sizeMeters/2)*scale;
  const py=((t.y-center.y)*tileM+sizeMeters/2)*scale;
  const dim=tileM*scale;
  try{ctx.drawImage(t.image,px,py,dim,dim);}catch{/* tainted or closed bitmap */}
 }
 const texture=new T.CanvasTexture(canvas);
 texture.colorSpace=T.SRGBColorSpace;
 texture.anisotropy=8;
 texture.generateMipmaps=true;
 texture.minFilter=T.LinearMipmapLinearFilter;
 texture.magFilter=T.LinearFilter;
 texture.needsUpdate=true;
 return texture;
}

export function coverageFromPhoto(image,lat,lon,photoMeters=PHOTO_METERS,groundMeters=GROUND_METERS){
 const canvas=document.createElement('canvas');
 canvas.width=canvas.height=GROUND_TEXELS;
 const ctx=canvas.getContext('2d',{alpha:false,colorSpace:'srgb'});
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 ctx.fillStyle='#6d7a68';ctx.fillRect(0,0,GROUND_TEXELS,GROUND_TEXELS);
 const dim=GROUND_TEXELS*(photoMeters/groundMeters);
 try{ctx.drawImage(image,(GROUND_TEXELS-dim)/2,(GROUND_TEXELS-dim)/2,dim,dim);}catch{/* closed bitmap */}
 const texture=new T.CanvasTexture(canvas);
 texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=8;texture.generateMipmaps=true;
 texture.minFilter=T.LinearMipmapLinearFilter;texture.magFilter=T.LinearFilter;texture.needsUpdate=true;
 const mpp=photoMeters/Math.max(1,image.width||256);
 return {
  photo:true,photoImage:image,photoMeters,groundMeters,
  tiles:[{image,x:0,y:0,photo:true}],
  center:lat!=null&&lon!=null?tileXY(lat,lon):{x:0,y:0},
  mpp,span:groundMeters,sourceSize:groundMeters,
  ready:true,texture,draped:true,year:null,
  label:`Aerial photo · ~${mpp.toFixed(2)} m/pixel · draped`
 };
}

export async function loadSatelliteCoverage(lat,lon,span=650){
 const window=tileWindow(lat,lon,span);
 const tiles=(await Promise.all(window.keys.map(k=>loadOneTile(k.x,k.y)))).filter(Boolean);
 const year=tiles.find(t=>t.source==='live')?.year||tiles[0]?.year||null;
 const ready=tiles.length>0;
 const texture=ready?composeGroundTexture({tiles,center:window.center,mpp:window.mpp}):null;
 return {
  ...window,
  tiles,
  ready,
  texture,
  year,
  draped:!!texture,
  label:ready?`Sentinel-2 · ${year}${tiles.every(t=>t.source==='bundled')?' bundled':''} · ~${window.mpp.toFixed(1)} m/pixel${texture?' · draped':''}`:'Satellite unavailable / incomplete'
 };
}

export class SatelliteMap{
 constructor(canvas,label){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.label=label;this.generation=0;this.tiles=[];this.ready=false;this.center=null;this.mpp=0;this.span=650;this.sourceSize=1;}
 async setMap(map){
  const generation=++this.generation;
  this.map=map;this.ready=false;this.tiles=[];
  this.label.textContent=map.photo||map.satellite?.photo?'Reading aerial photo…':map.real?'Loading satellite…':'No satellite · fictional yard';
  this.paint(0,0,0);
  if(!map.real&&!map.photo&&!map.satellite?.photo)return;
  const coverage=map.satellite||await loadSatelliteCoverage(map.lat,map.lon);
  if(generation!==this.generation)return;
  map.satellite=coverage;
  this.tiles=coverage.tiles;
  this.center=coverage.center;
  this.mpp=coverage.mpp;
  this.span=coverage.span;
  this.sourceSize=coverage.sourceSize;
  this.ready=coverage.ready;
  this.label.textContent=coverage.label;
 }
 paint(x,z,angle){
  const c=this.ctx,s=this.canvas.width;
  c.clearRect(0,0,s,s);
  c.fillStyle='#142025';
  c.fillRect(0,0,s,s);
  const sat=this.map.satellite;
  if(sat?.photo&&sat.photoImage){
   const scale=s/this.span,dim=(sat.photoMeters||PHOTO_METERS)*scale;
   try{c.drawImage(sat.photoImage,s/2-dim/2,s/2-dim/2,dim,dim);}catch{/* ignore closed bitmaps */}
   c.strokeStyle='#ffffff66';c.lineWidth=1;
   c.strokeRect(s/2-this.map.radius/this.span*s,s/2-this.map.radius/this.span*s,2*this.map.radius/this.span*s,2*this.map.radius/this.span*s);
   const px=s/2+x*scale,py=s/2+z*scale;
   c.save();c.translate(px,py);c.rotate(angle);c.fillStyle='#fff';c.beginPath();c.moveTo(0,-12);c.lineTo(-4,-5);c.lineTo(4,-5);c.closePath();c.fill();c.restore();
   c.beginPath();c.arc(px,py,5,0,Math.PI*2);c.fillStyle='#ff3434';c.fill();c.strokeStyle='white';c.lineWidth=1.5;c.stroke();
   c.fillStyle='white';c.font='bold 12px sans-serif';c.textAlign='left';c.fillText('N ↑',8,17);
   c.fillRect(10,s-14,100/this.span*s,2);c.font='10px sans-serif';c.fillText('100 m',10,s-20);
   return;
  }
  if(!this.map?.real){
   c.fillStyle='#9baaa4';c.font='12px sans-serif';c.textAlign='center';
   c.fillText('Fictional training yard',s/2,s/2);return;
  }
  if(!this.center)return;
  const scale=s/this.sourceSize;
  for(const t of this.tiles){
   const px=(t.x-this.center.x)*256*scale+s/2,py=(t.y-this.center.y)*256*scale+s/2;
   try{c.drawImage(t.image,px,py,256*scale,256*scale);}catch{/* ignore closed bitmaps */}
  }
  c.strokeStyle='#ffffff66';c.lineWidth=1;
  c.strokeRect(s/2-this.map.radius/this.span*s,s/2-this.map.radius/this.span*s,2*this.map.radius/this.span*s,2*this.map.radius/this.span*s);
  const lat=this.map.lat-z/111320,lon=this.map.lon+x/(111320*Math.cos(this.map.lat*Math.PI/180)),p=tileXY(lat,lon);
  const px=(p.x-this.center.x)*256*scale+s/2,py=(p.y-this.center.y)*256*scale+s/2;
  c.save();c.translate(px,py);c.rotate(angle);c.fillStyle='#fff';c.beginPath();c.moveTo(0,-12);c.lineTo(-4,-5);c.lineTo(4,-5);c.closePath();c.fill();c.restore();
  c.beginPath();c.arc(px,py,5,0,Math.PI*2);c.fillStyle='#ff3434';c.fill();c.strokeStyle='white';c.lineWidth=1.5;c.stroke();
  c.fillStyle='white';c.font='bold 12px sans-serif';c.textAlign='left';c.fillText('N ↑',8,17);
  c.fillRect(10,s-14,100/this.span*s,2);c.font='10px sans-serif';c.fillText('100 m',10,s-20);
 }
}
