// Horizontal geometry only, using the same lon/lat legs as the route map.
const EPS = 1e-9;
const cross = (ax, ay, bx, by) => ax * by - ay * bx;
const interpolate = (a, b, t) => ({lon:a.lon+(b.lon-a.lon)*t, lat:a.lat+(b.lat-a.lat)*t});

function ringContains(point, ring) {
  let inside = false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [ax,ay]=ring[j], [bx,by]=ring[i];
    const dx=bx-ax,dy=by-ay,px=point.lon-ax,py=point.lat-ay;
    if(Math.abs(cross(dx,dy,px,py))<EPS && point.lon>=Math.min(ax,bx)-EPS
      && point.lon<=Math.max(ax,bx)+EPS && point.lat>=Math.min(ay,by)-EPS
      && point.lat<=Math.max(ay,by)+EPS) return 2;
    if((ay>point.lat)!==(by>point.lat) && point.lon<(bx-ax)*(point.lat-ay)/(by-ay)+ax) inside=!inside;
  }
  return inside ? 1 : 0;
}

export function createFirBoundary(collection) {
  const features=collection?.features?.filter(f => {
    const tag=String(f.properties?.AV_AIRSPAC || f.properties?.name || '').toUpperCase();
    return tag === 'EPWWFIR' || tag === 'EPWW FIR' || tag === 'EPWW';
  }) || [];
  const polygons=features.flatMap(f=>f.geometry?.type==='Polygon' ? [f.geometry.coordinates]
    : f.geometry?.type==='MultiPolygon' ? f.geometry.coordinates : []);
  if(!polygons.length || polygons.some(p=>!p.length || p.some(r=>r.length<3
    || r.some(c=>!Number.isFinite(c[0])||!Number.isFinite(c[1]))))) throw new Error('EPWW FIR boundary is unavailable.');
  function contains(point) {
    return polygons.some(rings=>ringContains(point,rings[0])!==0
      && !rings.slice(1).some(r=>ringContains(point,r)===1));
  }
  function distanceToEdge(point) {
    let best=Infinity;
    const scale=Math.cos(point.lat*Math.PI/180);
    for(const rings of polygons) for(const ring of rings) for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
      const ax=(ring[j][0]-point.lon)*scale,ay=ring[j][1]-point.lat;
      const bx=(ring[i][0]-point.lon)*scale,by=ring[i][1]-point.lat;
      const dx=bx-ax,dy=by-ay,len=dx*dx+dy*dy;
      const t=len?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/len)):0;
      best=Math.min(best,Math.hypot(ax+t*dx,ay+t*dy)*60);
    }
    return best;
  }
  function intervals(a,b) {
    const ts=[0,1], dx=b.lon-a.lon,dy=b.lat-a.lat;
    for(const rings of polygons) for(const ring of rings) {
      for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
        const [x,y]=ring[j],ex=ring[i][0]-x,ey=ring[i][1]-y;
        const denominator=cross(dx,dy,ex,ey);
        if(Math.abs(denominator)<EPS) continue;
        const t=cross(x-a.lon,y-a.lat,ex,ey)/denominator;
        const u=cross(x-a.lon,y-a.lat,dx,dy)/denominator;
        if(t>=-EPS && t<=1+EPS && u>=-EPS && u<=1+EPS) ts.push(Math.max(0,Math.min(1,t)));
      }
    }
    const sorted=[...new Set(ts)].sort((a,b)=>a-b);
    return sorted.slice(1).flatMap((end,i)=>end-sorted[i]>EPS
      ? [{start:sorted[i],end,inside:contains(interpolate(a,b,(sorted[i]+end)/2))}] : []);
  }
  function firstEntry(points) {
    if(!points.length || contains(points[0])) return null;
    for(let i=0;i<points.length-1;i++) {
      const interval=intervals(points[i],points[i+1]).find(part=>part.inside);
      if(interval) return {segmentIndex:i,t:interval.start,point:interpolate(points[i],points[i+1],interval.start)};
    }
    return null;
  }
  // The FIR outline and airway fixes are separate source snapshots. Half a NM
  // tolerates their edge mismatch only when deciding whether a leg is foreign.
  const nearEdge=point=>distanceToEdge(point)<=0.5;
  const foreignLeg=(a,b)=>[a,b].every(p=>!contains(p)||nearEdge(p))
    && !intervals(a,b).some(part=>part.inside && [0.25,0.5,0.75].some(t=>
      !nearEdge(interpolate(a,b,part.start+(part.end-part.start)*t))));
  return {contains,firstEntry,nearEdge,foreignLeg,intersects:(a,b)=>intervals(a,b).some(p=>p.inside)};
}

export function findSpawnIndex(points, boundary) {
  const entry=boundary.firstEntry(points);
  if(!entry) throw new Error('Route has no outside-to-inside EPWW entry.');
  // Two fixes strictly before entry: at a boundary fix k use k-2;
  // when entry is between i and i+1, use i-1.
  const before=points.map((p,i)=>({p,i})).filter(({p,i})=>
    i<=entry.segmentIndex && !(i===entry.segmentIndex && entry.t<EPS) && !boundary.contains(p) && !boundary.nearEdge(p));
  if(before.length<2) throw new Error('Route needs two resolved points before the EPWW boundary.');
  return {index:before.at(-2).i,entry};
}
