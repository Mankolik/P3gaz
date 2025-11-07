export function fitAll(state, camera, container){
  const pts=[];
  for(const L of state.map.layers.values()){
    for(const f of L.features){
      if(f.type==='polygon' && f.xy) f.xy.forEach(p=>pts.push(p));
      if(f.type==='point' && f.x!=null) pts.push([f.x,f.y]);
    }
  }
  if(!pts.length) return;
  const bounds = boundsFromPoints(pts);
  fitBounds(camera, container, bounds);
}

export function fitBounds(camera, container, bounds, pad=40){
  if(!bounds) return;
  const {minX, maxX, minY, maxY} = bounds;
  if(!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) return;
  const w=container.clientWidth||800; const h=container.clientHeight||600;
  const width=Math.max(1e-3, maxX-minX);
  const height=Math.max(1e-3, maxY-minY);
  const safeWidth=Math.max(1, w-pad*2);
  const safeHeight=Math.max(1, h-pad*2);
  const scaleX=safeWidth/width;
  const scaleY=safeHeight/height;
  const MIN_Z = 1e-4;
  const z=Math.max(MIN_Z, Math.min(scaleX, scaleY));
  camera.z=z;
  camera.x=(minX+maxX)/2 - (w/(2*z));
  camera.y=(minY+maxY)/2 - (h/(2*z));
}

function boundsFromPoints(points){
  let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
  for(const [x,y] of points){
    if(!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if(x<minX) minX=x; if(x>maxX) maxX=x;
    if(y<minY) minY=y; if(y>maxY) maxY=y;
  }
  if(minX===Infinity) return null;
  return { minX, maxX, minY, maxY };
}
