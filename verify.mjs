import fs from 'node:fs';
import assert from 'node:assert/strict';
import {convert,coordinates,blocked,training,LOCATIONS,landKind,PLAYER_STAND,PLAYER_CROUCH,inside} from './dist/map-model.js';
import {FLAT,decode,tileXY} from './dist/terrain.js';
import {createWorld,disposeWorld} from './dist/world.js';
import {analyzeRaster} from './dist/photo-stage.js';
assert.deepEqual(coordinates('31.714529, 35.101434'),[31.714529,35.101434]);
for(const bad of ['','91,1','31','NaN,7','1,2,3'])assert.throws(()=>coordinates(bad));
assert.equal(decode(128,0,0),0);assert.equal(decode(129,2,128),258.5);
assert.equal(Math.floor(tileXY(31.714529,35.101434).x),9789);
assert.equal(landKind({natural:'water'}),'water');
assert.equal(landKind({landuse:'forest'}),'forest');
assert.equal(landKind({leisure:'park'}),'park');
assert.equal(landKind({highway:'residential'}),null);
for(const place of LOCATIONS){const data=JSON.parse(fs.readFileSync(`dist/${place.file}`,'utf8'));const map=convert(data,place.lat,place.lon,place.name);map.terrain=FLAT;assert(Array.isArray(map.cover));assert(Array.isArray(map.fences));assert(Array.isArray(map.trees));assert(!blocked(map.spawn.x,map.spawn.z,map.buildings,1,{fences:map.fences,trees:map.trees}));const world=createWorld(map);assert(world.walls.length>=6);assert(world.slots.length>5);assert(map.buildings.some(b=>b.doors?.length));assert(map.buildings.every(b=>b.base!=null));let vertices=0;world.scene.traverse(o=>{if(o.geometry?.attributes.position){const a=o.geometry.attributes.position.array;assert([...a].every(Number.isFinite));vertices+=a.length/3;}});console.log(`${place.name}: ${map.buildings.length} buildings, ${map.fences.length} fences, ${map.trees.length} trees, ${world.slots.length} generated façade positions, valid spawn, ${vertices} finite vertices`);disposeWorld(world.scene);}
const t=training();assert(!blocked(t.spawn.x,t.spawn.z,t.buildings,.55,{fences:t.fences,trees:t.trees}));assert(blocked(-40,-48,t.buildings));assert(t.fences.length>=1);assert(t.trees.length>=1);const tw=createWorld({...t,terrain:FLAT});assert(Array.isArray(t.yards));
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
const lowGap=doorSample(low,0);
assert(blocked(lowGap.x,lowGap.z,t.buildings,.48,{y:0,h:PLAYER_STAND}),'standing blocked by low lintel');
assert(!blocked(lowGap.x,lowGap.z,t.buildings,.4,{y:0,h:PLAYER_CROUCH}),'crouch fits low door');
assert(t.buildings.every(b=>b.base>=0),'door sill is never below ground');
disposeWorld(tw.scene);
const html=fs.readFileSync('dist/index.html','utf8'),js=fs.readFileSync('dist/game.js','utf8');const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));for(const match of js.matchAll(/\$\('([^']+)'\)/g))assert(ids.has(match[1]),`Missing DOM id: ${match[1]}`);
const raster=new Uint8ClampedArray(64*64*4).fill(120);
for(let y=8;y<20;y++)for(let x=8;x<24;x++){const i=(y*64+x)*4;raster[i]=190;raster[i+1]=90;raster[i+2]=60;raster[i+3]=255;}
for(let y=36;y<44;y++)for(let x=36;x<44;x++){const i=(y*64+x)*4;raster[i]=40;raster[i+1]=110;raster[i+2]=50;raster[i+3]=255;}
const photo=analyzeRaster(raster,64,64,200);
assert(photo.buildings.length>=1,`photo roofs: ${photo.buildings.length}`);
assert(photo.trees.length>=1,`photo trees: ${photo.trees.length}`);
assert(photo.roads.length>=1);
for(const file of ['game.js','world.js','map-model.js','terrain.js','three.module.js','style.css','sprites.png','initial-map.json','telaviv-map.json','barcelona-map.json','credits.html','Soldier.glb','characters.js','GLTFLoader.js','SkeletonUtils.js','BufferGeometryUtils.js','weapons.js','controls.js','satellite.js','photo-stage.js','satellite-9789-6668.jpg','satellite-9774-6649.jpg','satellite-8290-6119.jpg','satellite-8291-6119.jpg'])assert(fs.existsSync(`dist/${file}`),`Missing asset ${file}`);
console.log('Coordinate validation, terrain decoding, map geometry, collision spawn and local assets passed. Browser/mobile interaction QA not performed.');
