import { validPoint } from './routes.js';
import { findSpawnIndex } from './fir-boundary.js';
import { cacheRouteMetrics } from './route-metrics.js';
import { findTerminalProcedure, procedureRoutePoints } from './terminal-routes.js';

const AIRWAY=/^(?:U)?[A-Z]\d{1,4}$/;
const SPEED_LEVEL=/^(?:N\d{4}|K\d{4}|M\d{3})(?:F\d{3}|A\d{3}|S\d{4}|M\d{4})$/;
const LEVEL_SUFFIX=/^(?:(?:N\d{4}|K\d{4}|M\d{3}))?(?:F\d{3}|A\d{3}|S\d{4}|M\d{4})$/;
export const GROUND_DEPARTURES=new Set(['EYVI','LKPR','EDDB']);

export function parseRouteCatalogue(text) {
  const groups=[];
  let group=null;
  for(const [index,raw] of text.replace(/^\uFEFF/,'').split(/\r?\n/).entries()) {
    const line=raw.trim();
    if(!line || line==='Airporty') continue;
    const pair=line.match(/^([A-Z]{4})\s*-\s*([A-Z]{4})$/);
    if(pair) {
      group={departure:pair[1],destination:pair[2],callsigns:[],variants:[]};
      groups.push(group); continue;
    }
    if(!group) throw new Error(`Missing airport pair at line ${index+1}.`);
    if(!group.callsigns.length) {
      group.callsigns=[...new Set(line.split(',').map(s=>s.trim()).filter(Boolean))];
      if(group.callsigns.some(s=>! /^[A-Z0-9]{3,8}$/.test(s))) throw new Error(`Invalid callsign at line ${index+1}.`);
      continue;
    }
    const match=line.match(/^(?:([A-Z0-9]{2,4})\s+(F\d{3})\s+)?(.+)$/);
    group.variants.push({aircraftType:match[1]||null,sourceFlightLevel:match[2]?Number(match[2].slice(1)):null,
      route:match[3],sourceLine:index+1});
  }
  if(!groups.length || groups.some(g=>!g.callsigns.length || !g.variants.length)) throw new Error('Incomplete route catalogue.');
  return groups;
}

export function tokenizeRoute(text, departure, destination) {
  const fixes=[], connectors=[], annotations=[];
  let connector=null;
  for(const token of text.trim().toUpperCase().split(/\s+/)) {
    if(SPEED_LEVEL.test(token)) {annotations.push(token);continue;}
    if(['DCT','SID','STAR'].includes(token) || AIRWAY.test(token)) {
      if(!fixes.length || connector) throw new Error(`Unexpected connector: ${token}`);
      connector=token; continue;
    }
    const [name,suffix,extra]=token.split('/');
    if(extra!==undefined || (suffix!==undefined && !LEVEL_SUFFIX.test(suffix))) throw new Error(`Unsupported route annotation: ${token}`);
    if(!/^[A-Z0-9]{2,11}$/.test(name)) throw new Error(`Invalid point: ${name}`);
    if(suffix) annotations.push(token);
    if(fixes.length) connectors.push(connector || 'DCT');
    fixes.push(name); connector=null;
  }
  if(connector) throw new Error(`Missing point after ${connector}.`);
  if(fixes[0]!==departure) {fixes.unshift(departure);connectors.unshift('SID');}
  if(fixes.at(-1)!==destination) {fixes.push(destination);connectors.push('STAR');}
  return {fixes,connectors,annotations};
}

function coordinatePoint(name) {
  const match=name.match(/^(\d{2})(\d{2})?([NS])(\d{3})(\d{2})?([EW])$/);
  if(!match) return null;
  if(Number(match[2]||0)>=60 || Number(match[5]||0)>=60) throw new Error(`Invalid coordinate: ${name}`);
  const point={name,lat:(Number(match[1])+Number(match[2]||0)/60)*(match[3]==='S'?-1:1),
    lon:(Number(match[4])+Number(match[5]||0)/60)*(match[6]==='W'?-1:1)};
  if(!validPoint(point)) throw new Error(`Invalid coordinate: ${name}`);
  return point;
}

export function compileRouteCatalogue(groups, resolver, boundary, metricsOptions) {
  if(!resolver || !boundary) throw new Error('Navigation and EPWW data are required.');
  const diagnostics=[], compiled=[];
  for(const group of groups) {
    const variants=[];
    for(const variant of group.variants) {
      const issues=[];
      try {
        const tokens=tokenizeRoute(variant.route,group.departure,group.destination);
        const rawPoints=tokens.fixes.map(name=>{
          try {return coordinatePoint(name)||resolver.resolvePoint(name);}
          catch(error) {issues.push({name,error:error.message});return null;}
        });
        const departurePoint=rawPoints[0];
        const groundStart=GROUND_DEPARTURES.has(group.departure) || (departurePoint && boundary.contains(departurePoint));
        if(groundStart && !departurePoint) throw new Error(`Departure airport is missing: ${group.departure}`);
        const blocks=[];
        let points=[];
        const finish=()=>{if(points.length)blocks.push(points);points=[];};
        const append=p=>{const last=points.at(-1);if(!last || Math.abs(last.lon-p.lon)>1e-8 || Math.abs(last.lat-p.lat)>1e-8)points.push(p);};
        for(let i=0;i<rawPoints.length;i++) {
          const to=rawPoints[i],from=rawPoints[i-1];
          if(!to) {finish();continue;}
          if(!from || !i) {append(to);continue;}
          const connector=tokens.connectors[i-1];
          if(AIRWAY.test(connector)) {
            const airway=resolver.getAirway(connector);
            const start=airway?.waypoints.indexOf(from.name) ?? -1;
            const end=airway?.waypoints.indexOf(to.name) ?? -1;
            if(start>=0 && end>=0) {
              const step=end>=start?1:-1;
              for(let j=start;j!==end;j+=step) {
                const a=resolver.resolvePoint(airway.waypoints[j]),b=resolver.resolvePoint(airway.waypoints[j+step]);
                const leg=airway.legs[Math.min(j,j+step)];
                if(leg.status==='external-gap' && !boundary.foreignLeg(a,b)) throw new Error(`Uncovered EPWW segment on ${connector}.`);
                append(b);
              }
            } else if(boundary.foreignLeg(from,to)) {
              append(to); // Foreign airway: keep named endpoints, omit the airway.
            } else if(airway && ((start>=0)!==(end>=0))) {
              // One endpoint is abroad: use an unambiguous published boundary
              // endpoint. Never join an invented fix to the middle of an airway.
              const outside=start>=0?to:from;
              const anchors=[0,airway.waypoints.length-1].filter(j=>{
                const anchor=resolver.resolvePoint(airway.waypoints[j]);
                return boundary.nearEdge(anchor) && boundary.foreignLeg(anchor,outside);
              });
              if(anchors.length!==1) throw new Error(`Ambiguous foreign continuation on ${connector}.`);
              const first=start>=0?start:anchors[0],last=end>=0?end:anchors[0],step=last>=first?1:-1;
              if(start<0)append(resolver.resolvePoint(airway.waypoints[first]));
              for(let j=first;j!==last;j+=step) {
                const a=resolver.resolvePoint(airway.waypoints[j]),b=resolver.resolvePoint(airway.waypoints[j+step]);
                if(airway.legs[Math.min(j,j+step)].status==='external-gap' && !boundary.foreignLeg(a,b)) throw new Error(`Uncovered EPWW segment on ${connector}.`);
                append(b);
              }
              append(to);
            } else {
              throw new Error(`Cannot expand EPWW section ${from.name} ${connector} ${to.name}.`);
            }
          } else {
            // Only explicitly filed SID/STAR connectors may expand procedures.
            const explicit=variant.route.toUpperCase().split(/\s+/).includes(connector);
            const procedure=explicit && (connector==='SID' && i===1
              ? findTerminalProcedure(group.departure,'SID',to.name)
              : connector==='STAR' && i===rawPoints.length-1
                ? findTerminalProcedure(group.destination,'STAR',from.name) : null);
            if(procedure){
              const terminal=procedureRoutePoints(procedure);
              // Replace the shared connecting fix; keep its restriction exactly once.
              if(connector==='STAR' && points.at(-1)?.name===from.name)points.pop();
              terminal.forEach(append);
              if(connector==='STAR')append(to);
            }else append(to);
          }
        }
        finish();
        const relevant=blocks.filter(block=>block.some(p=>boundary.contains(p)) || block.some((p,i)=>i && boundary.intersects(block[i-1],p)));
        if(relevant.length!==1) throw new Error(relevant.length ? 'Unresolved gap between EPWW route portions.' : 'No resolved EPWW route portion.');
        const waypoints=relevant[0];
        if(groundStart && waypoints[0].name!==group.departure) throw new Error('Unresolved gap after the departure airport.');
        const destinationPoint=rawPoints.at(-1);
        if(destinationPoint && boundary.contains(destinationPoint) && waypoints.at(-1).name!==group.destination) throw new Error('Unresolved gap before the destination airport.');
        if(!destinationPoint && group.destination.startsWith('EP')) throw new Error('Destination airport is missing.');
        // Do not let an unknown suffix truncate a flight while still inside EPWW.
        if(waypoints.at(-1).name!==group.destination && boundary.contains(waypoints.at(-1))) throw new Error('Unresolved route before leaving EPWW.');
        const spawn=groundStart ? {index:0,entry:null} : findSpawnIndex(waypoints,boundary);
        if(!waypoints[spawn.index+1]) throw new Error('No onward waypoint at spawn.');
        const compiledVariant={...variant,waypoints,groundStart,spawnIndex:spawn.index,entry:spawn.entry,
          annotations:tokens.annotations,omittedPoints:issues};
        variants.push(compiledVariant);
        if(issues.length) diagnostics.push({pair:`${group.departure}-${group.destination}`,line:variant.sourceLine,
          severity:'notice',reason:'Unresolved foreign prefix/suffix omitted; retained continuous EPWW route and spawn lead-in.',points:issues.map(i=>i.name)});
      } catch(error) {
        diagnostics.push({pair:`${group.departure}-${group.destination}`,line:variant.sourceLine,severity:'error',reason:error.message,points:issues});
      }
    }
    if(variants.length) compiled.push({...group,variants});
  }
  return {boundary,groups:cacheRouteMetrics(compiled,name=>resolver.resolvePoint(name),metricsOptions),diagnostics,totalGroups:groups.length,totalVariants:groups.reduce((n,g)=>n+g.variants.length,0),
    validVariants:compiled.reduce((n,g)=>n+g.variants.length,0)};
}
