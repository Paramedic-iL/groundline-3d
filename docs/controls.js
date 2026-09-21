export function facingMovement(yaw,forward,strafe){const l=Math.hypot(forward,strafe);if(l>1){forward/=l;strafe/=l;}return {x:Math.sin(yaw)*forward+Math.cos(yaw)*strafe,z:-Math.cos(yaw)*forward+Math.sin(yaw)*strafe};}
export function lookVector(yaw,pitch){return {x:Math.sin(yaw)*Math.cos(pitch),y:Math.sin(pitch),z:-Math.cos(yaw)*Math.cos(pitch)};}
export function clampPitch(pitch){return Math.max(-1.25,Math.min(1.25,pitch));}
