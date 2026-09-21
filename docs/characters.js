import * as T from './three.module.js';
import {GLTFLoader} from './GLTFLoader.js';
import {clone} from './SkeletonUtils.js';
let template=null,clips=[],pending=null;
export function loadCharacters(){return pending??=(new GLTFLoader().loadAsync('./Soldier.glb').then(gltf=>{template=gltf.scene;clips=gltf.animations;return true;}).catch(()=>false));}
export function realisticPerson(scene,enemy=false){
 if(!template)return null;
 const group=new T.Group(),placement=new T.Group(),model=clone(template);
 group.add(placement);placement.add(model);
 model.traverse(o=>{if(o.isMesh){
  o.geometry=o.geometry.clone();o.material=o.material.clone();o.material.roughness=.8;
  if(enemy)o.material.color.multiply(new T.Color(1,.87,.78));
  o.castShadow=o.receiveShadow=true;
 }});
 const mixer=new T.AnimationMixer(model);
 const idle=clips.find(c=>c.name==='Idle'),walk=clips.find(c=>c.name==='Walk'),run=clips.find(c=>c.name==='Run');
 const idleAction=idle?mixer.clipAction(idle).play():null;
 const walkAction=walk?mixer.clipAction(walk).play():null;
 const runAction=run?mixer.clipAction(run).play():null;
 if(walkAction)walkAction.setEffectiveWeight(0);
 if(runAction)runAction.setEffectiveWeight(0);
 // Measure the evaluated skeleton, not the stale cached bind-pose bounds.
 mixer.update(0);group.updateMatrixWorld(true);
 model.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});
 const bounds=new T.Box3().setFromObject(model,true);
 const scale=1.82/(bounds.max.y-bounds.min.y);
 // Normalize outside the animation hierarchy; equipment remains in metres.
 placement.scale.setScalar(scale);
 placement.position.y=-bounds.min.y*scale;
 // Soldier.glb faces −Z, same as weapons and lookVector. Do not yaw the mesh here.
 scene.add(group);
 return {group,model,mixer,
  update(dt,moving=0,flags={}){
   const crouch=!!flags.crouch,sprint=!!flags.run&&moving>.08&&!crouch;
   const walkW=moving>0&&!sprint?Math.min(1,crouch?moving*.75:moving):0;
   const runW=sprint?Math.min(1,moving):0;
   idleAction?.setEffectiveWeight(Math.max(0,1-walkW-runW));
   walkAction?.setEffectiveWeight(walkW);
   runAction?.setEffectiveWeight(runW);
   const squat=crouch?.64:1;
   placement.scale.set(scale,scale*squat,scale);
   placement.position.y=-bounds.min.y*scale*squat;
   mixer.update(dt);
  },
  dispose(){mixer.stopAllAction();mixer.uncacheRoot(model);}
 };
}
