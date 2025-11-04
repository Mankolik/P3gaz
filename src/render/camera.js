export function createCamera(canvas){
  const cam = { x:0, y:0, z:1 };
  cam.screenToWorld = (sx,sy)=>({ x:(sx/cam.z)+cam.x, y:(sy/cam.z)+cam.y });
  cam.worldToScreen = (wx,wy)=>({ x:(wx-cam.x)*cam.z, y:(wy-cam.y)*cam.z });
  cam.pan = (dx,dy)=>{ cam.x -= dx; cam.y -= dy; };
  cam.zoomAbout = (scale, sx, sy)=>{
    const before = cam.screenToWorld(sx, sy);
    cam.z *= scale;
    const after = cam.screenToWorld(sx, sy);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
  };
  return cam;
}
