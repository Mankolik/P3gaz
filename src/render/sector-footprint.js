const cache=new WeakMap();
// Include every controlled Low and High polygon, regardless of aircraft level
// or map-layer visibility. Opaque fills form a union without darkening overlaps.
export function controlledFootprint(index,sector){
  return (index?.volumes || []).filter(v=>v.kind==='ACC' && v.designator===sector).flatMap(v=>v.polygons);
}
export function drawControlledFootprint(ctx,state){
  const index=state.air?.airspaceIndex,project=state.map?.project,sector=state.air?.controlledSector || 'ALLFIR';
  if(!index || !project)return;
  let compiled=cache.get(index);
  if(!compiled || compiled.project!==project || compiled.sector!==sector){
    const paths=controlledFootprint(index,sector).map(polygon=>{
      const path=new Path2D();
      for(const ring of polygon.rings){ring.forEach(([lon,lat],i)=>{const [x,y]=project(lon,lat);i?path.lineTo(x,y):path.moveTo(x,y);});path.closePath();}
      return path;
    });
    compiled={project,sector,paths};cache.set(index,compiled);
  }
  ctx.save();ctx.globalCompositeOperation='destination-over';ctx.fillStyle='#020609';
  for(const path of compiled.paths)ctx.fill(path,'evenodd');
  ctx.restore();
}
