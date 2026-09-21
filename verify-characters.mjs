import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as T from './dist/three.module.js';
import {GLTFLoader} from './dist/GLTFLoader.js';
import {loadCharacters,realisticPerson} from './dist/characters.js';

// Load the real geometry and animations without browser image decoding.
globalThis.self={URL};
GLTFLoader.prototype.loadAsync=async function(){
 this.register(()=>({name:'test-textures',loadTexture:()=>Promise.resolve(new T.Texture())}));
 const b=fs.readFileSync(new URL('./dist/Soldier.glb',import.meta.url));
 return this.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
};
assert(await loadCharacters());
const scene=new T.Scene();
let minHeight=Infinity,maxHeight=0;
for(const enemy of [false,true]){
 const actor=realisticPerson(scene,enemy);
 actor.group.position.set(123,37,-91);actor.group.rotation.y=1.2;
 for(const moving of [0,.5,1])for(let frame=0;frame<120;frame++){
  actor.update(1/30,moving);
  scene.updateMatrixWorld(true);
  actor.model.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});
  // Precise bounds evaluate deformed vertices, as opposed to cached boxes.
  const bounds=new T.Box3().setFromObject(actor.model,true);
  const size=bounds.getSize(new T.Vector3());
  minHeight=Math.min(minHeight,size.y);maxHeight=Math.max(maxHeight,size.y);
  assert(size.y>1.65&&size.y<1.95,`Animated height: ${size.y}`);
  assert(Math.abs(bounds.min.y-37)<.15,`Feet at ${bounds.min.y}`);
  assert(size.x<1.6&&size.z<1.6,'Body must remain near its spawn');
  assert.equal(actor.group.scale.x,1,'Equipment group must remain in metres');
 }
 actor.dispose();scene.remove(actor.group);
}
const runner=realisticPerson(scene);
runner.group.position.set(0,0,0);
runner.update(1/30,1,{run:true});
scene.updateMatrixWorld(true);runner.model.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});
const runSize=new T.Box3().setFromObject(runner.model,true).getSize(new T.Vector3());
assert(runSize.y>1.65&&runSize.y<1.95,`Run height: ${runSize.y}`);
runner.update(1/30,1,{crouch:true});
scene.updateMatrixWorld(true);runner.model.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});
const crouchSize=new T.Box3().setFromObject(runner.group,true).getSize(new T.Vector3());
assert(crouchSize.y<1.35&&crouchSize.y>0.9,`Crouch height: ${crouchSize.y}`);
runner.dispose();
console.log(`Animated soldier heights: ${minHeight.toFixed(3)}–${maxHeight.toFixed(3)} m; run ${runSize.y.toFixed(3)} m; crouch ${crouchSize.y.toFixed(3)} m; idle, walk, blends and elevated spawns passed.`);
