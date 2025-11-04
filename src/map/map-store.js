import { registerLayer, addFeatures } from '../render/layers.js';

export function fitAll(state, camera, container){
  const pts=[];
  for(const L of state.map.layers.values()){
    for(const f of L.features){
      if(f.type==='polygon' && f.xy) f.xy.forEach(p=>pts.push(p));
      if(f.type==='point' && f.x!=null) pts.push([f.x,f.y]);
    }
  }
  if(!pts.length) return;
  const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
  const minX=Math.min(...xs), maxX=Math.max(...xs);
  const minY=Math.min(...ys), maxY=Math.max(...ys);
  const pad=40; const w=container.clientWidth||800; const h=container.clientHeight||600;
  const scaleX=(w-pad*2)/(maxX-minX); const scaleY=(h-pad*2)/(maxY-minY);
  const z=Math.max(0.1, Math.min(scaleX, scaleY));
  camera.z=z; camera.x=(minX+maxX)/2 - (w/(2*z)); camera.y=(minY+maxY)/2 - (h/(2*z));
}
