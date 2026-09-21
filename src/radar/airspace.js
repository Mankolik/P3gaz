import { compilePolygon, containsPoint } from './sectors.js';

export const TMA_DESIGNATORS = Object.freeze({
  EPPO:'APPO',EPZG:'APPO',EPWR:'APPO',EPKK:'APKK',EPKT:'APKK',
  EPWA:'APWA',EPMO:'APWA',EPRA:'APWA',EPGD:'APGD',
  EPSC:'TSC',EPLB:'TLB',EPRZ:'TRZ',EPSY:'TSY',EPLL:'TLL',EPBY:'TBY',
});

export function createAirspaceIndex(sectorIndex, firCollection){
  const volumes=(sectorIndex?.sectors || []).map(s=>({...s,
    designator:s.kind==='ACC' ? 'ALLFIR' : TMA_DESIGNATORS[s.icao] || null}));
  const firs=(firCollection?.features || []).map(f=>{
    const p=f.properties || {},code=String(p.AV_AIRSPAC || '');
    const rings=f.geometry?.type==='Polygon' ? [f.geometry.coordinates]
      : f.geometry?.type==='MultiPolygon' ? f.geometry.coordinates : [];
    return {id:code,designator:code.slice(0,3),kind:'FIR',minFl:p.MIN_FLIGHT,maxFl:p.MAX_FLIGHT,
      polygons:rings.map(compilePolygon).filter(Boolean)};
  }).filter(f=>f.id && f.polygons.length && Number.isFinite(f.minFl) && Number.isFinite(f.maxFl));
  const epww=firs.filter(f=>f.id==='EPWWFIR');
  return {volumes,firs,epww,complete:!!sectorIndex?.complete && epww.length>0 && volumes.every(v=>v.designator)};
}

const horizontal=(v,p)=>v.polygons.some(poly=>containsPoint(poly,p.lon,p.lat));
const covers=(v,p,fl)=>fl>=v.minFl && fl<v.maxFl && horizontal(v,p);
export const insideEpww=(index,point)=>!!index?.epww?.some(v=>horizontal(v,point));

export function airspaceAt(index, point, level, previous=null){
  if(!index?.complete || !Number.isFinite(level)) return 'UNKNOWN';
  const inside=insideEpww(index,point);
  const matches=index.volumes.filter(v=>(v.kind==='TMA' || inside) && covers(v,point,level));
  const priority=Math.max(-1,...matches.map(v=>v.priority));
  const groups=[...new Set(matches.filter(v=>v.priority===priority).map(v=>v.designator))];
  if(groups.length) return groups.includes(previous) ? previous : groups.sort()[0];
  if(inside) return level<95 ? 'FIS' : 'UNKNOWN';
  const foreign=index.firs.filter(v=>v.id!=='EPWWFIR' && covers(v,point,level)).map(v=>v.designator);
  return foreign.includes(previous) ? previous : foreign.sort()[0] || 'UNKNOWN';
}

// Split route legs at polygon edges, including holes. This prevents short
// horizontal visits from disappearing between prediction samples.
export function airspaceLegCuts(index, from, to){
  const dx=to.lon-from.lon,dy=to.lat-from.lat,cuts=[0,1];
  const minX=Math.min(from.lon,to.lon),maxX=Math.max(from.lon,to.lon);
  const minY=Math.min(from.lat,to.lat),maxY=Math.max(from.lat,to.lat);
  for(const volume of [...index.volumes,...index.firs])for(const {bounds,rings} of volume.polygons){
    if(bounds.maxLon<minX || bounds.minLon>maxX || bounds.maxLat<minY || bounds.minLat>maxY)continue;
    for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const [ax,ay]=ring[j],[bx,by]=ring[i],ex=bx-ax,ey=by-ay;
      const denominator=dx*ey-dy*ex;
      if(Math.abs(denominator)<1e-14)continue;
      const t=((ax-from.lon)*ey-(ay-from.lat)*ex)/denominator;
      const u=((ax-from.lon)*dy-(ay-from.lat)*dx)/denominator;
      if(t>0 && t<1 && u>=0 && u<=1)cuts.push(t);
    }
  }
  return cuts.sort((a,b)=>a-b).filter((t,i,a)=>i===0 || t-a[i-1]>1e-9);
}
