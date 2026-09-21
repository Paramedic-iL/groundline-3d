import * as T from './three.module.js';
// View-model geometry is visual only. Its barrel axis converges on the actual aim point.
const metal=new T.MeshStandardMaterial({color:0x303639,metalness:.7,roughness:.42}),polymer=new T.MeshStandardMaterial({color:0x222928,roughness:.83}),tan=new T.MeshStandardMaterial({color:0x84775c,roughness:.9});
function box(g,x,y,z,w,h,d,m){const o=new T.Mesh(new T.BoxGeometry(w,h,d),m);o.position.set(x,y,z);g.add(o);return o;}
function tube(g,x,y,z,r,len,m){const o=new T.Mesh(new T.CylinderGeometry(r,r,len,12),m);o.rotation.x=Math.PI/2;o.position.set(x,y,z);g.add(o);return o;}
export function createWeapon(pistol=false){const group=new T.Group();if(pistol){box(group,0,0,-.16,.045,.055,.22,metal);box(group,0,-.055,-.08,.041,.11,.045,polymer).rotation.x=-.18;tube(group,0,-.003,-.277,.013,.025,metal);box(group,0,.034,-.252,.007,.012,.011,metal);box(group,0,.034,-.072,.036,.013,.014,metal);box(group,0,-.04,-.145,.009,.04,.009,metal);tube(group,0,0,-.294,.008,.003,new T.MeshBasicMaterial({color:0x030303}));}else{tube(group,0,0,-.69,.012,.34,metal);tube(group,0,0,-.87,.018,.06,metal);box(group,0,-.012,-.43,.055,.073,.27,polymer);box(group,0,-.009,-.20,.059,.085,.2,metal);box(group,0,-.073,-.18,.045,.15,.054,metal).rotation.x=.16;box(group,0,-.075,-.075,.035,.105,.04,polymer).rotation.x=-.2;box(group,0,-.005,.04,.055,.07,.23,polymer);box(group,0,-.016,.13,.075,.12,.055,tan);for(let i=0;i<12;i++)box(group,0,.032,-.54+i*.036,.065,.013,.014,metal);for(let i=0;i<7;i++){box(group,.03,-.014,-.53+i*.032,.008,.023,.017,metal);box(group,-.03,-.014,-.53+i*.032,.008,.023,.017,metal);}tube(group,0,.074,-.26,.031,.071,metal);const glass=new T.Mesh(new T.CircleGeometry(.023,16),new T.MeshBasicMaterial({color:0x88a0a3,transparent:true,opacity:.2,side:T.DoubleSide}));glass.position.set(0,.074,-.218);group.add(glass);box(group,0,-.105,-.48,.035,.13,.045,tan);tube(group,0,0,-.902,.009,.003,new T.MeshBasicMaterial({color:0x020303}));}
 const hand=box(group,.009,-.073,pistol?-.055:-.06,.063,.073,.08,tan);hand.rotation.z=.15;const arm=box(group,.05,-.16,.07,.083,.22,.09,polymer);arm.rotation.z=-.25;if(!pistol){box(group,-.02,-.055,-.43,.067,.067,.115,tan);const a=box(group,-.095,-.12,-.30,.08,.11,.3,polymer);a.rotation.y=-.4;}
 group.traverse(o=>{o.layers.set(2);if(o.isMesh){o.castShadow=false;o.frustumCulled=false;}});const muzzle=new T.Object3D();muzzle.position.set(0,0,pistol?-.295:-.91);group.add(muzzle);group.userData.muzzle=muzzle;return group;}
export function alignWeapon(group,distance,recoil=0,pistol=false){
 const hold=pistol?-.18:-.05,muzzle=pistol?.3:.92;
 const pull=Math.max(0,muzzle-Math.max(.12,distance));
 group.position.set(pistol?.095:.13,pistol?-.095:-.14,hold+recoil*.045+pull);
 const localTarget=new T.Vector3(0,0,-Math.max(2,distance));
 group.quaternion.setFromUnitVectors(new T.Vector3(0,0,-1),localTarget.sub(group.position).normalize());
}
