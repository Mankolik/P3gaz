import { plannedRoutePoints } from './planned-route.js';
import { TMA_DESIGNATORS } from './airspace.js';
import { greatCircleDistanceKm } from './route-metrics.js';
import { aircraftPerformance } from './performance.js';
import { convertIasToTas } from '../utils/speed.js';

const distance=(a,b)=>greatCircleDistanceKm(a,b)/1.852;
const geometryCache=new WeakMap();
const touch=t=>{t.labelRevision=(t.labelRevision || 0)+1;};

// Cache fixed leg lengths. The first leg changes with position; no growing
// per-tick arrays or guidance samples are added to multiplayer snapshots.
export function remainingProcedureRoute(track){
  if(!['route','direct'].includes(track.navigationMode))return [];
  const plan=track.flightPlan,direct=track.directTo;
  let cached=geometryCache.get(track);
  if(!cached || cached.plan!==plan || cached.points!==plan?.waypoints || cached.next!==plan?.nextIndex
    || cached.direct!==direct || cached.mode!==track.navigationMode){
    let length=0,previous;
    const points=plannedRoutePoints(track).map(point=>{
      if(previous)length+=distance(previous,point);
      previous=point;return {point,offset:length};
    });
    cached={plan,points:plan?.waypoints,next:plan?.nextIndex,direct,mode:track.navigationMode,route:points};
    geometryCache.set(track,cached);
  }
  if(!cached.route.length)return [];
  const first=distance(track,cached.route[0].point);
  return cached.route.map(({point,offset})=>({point,distance:first+offset}));
}

export function arrivalDistance(track,route=remainingProcedureRoute(track)){
  const airport=route.findLast(p=>p.point.name===track.destination);
  if(airport)return airport.distance;
  return track.arrivalAirport ? distance(track,track.arrivalAirport) : null;
}

// The destination approach unit takes responsibility at the actual ownership
// transfer (including an early 10-NM transfer), not at an unrelated TMA crossing.
export function updateArrivalControl(state,track){
  const c=track.control,target=TMA_DESIGNATORS[track.destination];
  if(!c || !target || !track.arrivalAirport)return;
  const human=state.air.shared ? state.air.humanSectors?.has(c.owner) : c.owner===(state.air.controlledSector || 'ALLFIR');
  const next=!!(!human && (c.owner===target || track.arrivalManaged) && c.hasEnteredFir &&
    // Domestic departures must leave their origin terminal area first.
    (!track.isDeparture || track.leftDepartureTerminal));
  if(track.isDeparture && c.activeSector!==TMA_DESIGNATORS[track.departure]
    && (c.accSectors?.includes(c.activeSector) || c.activeSector==='ALLFIR'))track.leftDepartureTerminal=true;
  if(!next){
    if(track.arrivalManaged){track.arrivalManaged=false;touch(track);}
    return;
  }
  if(!track.arrivalManaged){
    track.arrivalManaged=true;
    track.procedureAltitudeOverride=false;
    track.clearedFlightLevel=30;
    track.unableCfl=null;
    track.assignedVertical=null;track.verticalRateAssigned=false;track.unableVerticalRate=false;
    if(Number.isFinite(track.assignedSpeed?.value)){
      if((track.assignedSpeed.mode==='IAS' && track.assignedSpeed.value>280) || track.assignedSpeed.mode==='Mach')
        track.arrivalNote='Approach: slowing down. The runway is not a speed camera.';
      track.assignedSpeed={mode:'IAS',value:null};
    }
    touch(track);
  }
  c.computerSector=target;
  c.computerTargetLevel=track.clearedFlightLevel;
  // A subsequently accepted speed proposal still works, but approach cancels
  // an excessive speed once in the final 15 NM. Never cap a human-owned track.
  const remaining=arrivalDistance(track);
  if(remaining!=null && remaining<=15 && Number.isFinite(track.assignedSpeed?.value)
    && (track.assignedSpeed.mode==='Mach' || track.assignedSpeed.value>220)){
    track.assignedSpeed={mode:'IAS',value:null};
    track.arrivalNote='Approach: slowing down. The runway is not a speed camera.';
    touch(track);
  }
}

export function procedureFlightLevel(track,route=remainingProcedureRoute(track)){
  const clearance=track.clearedFlightLevel ?? track.actualFlightLevel;
  if(track.procedureAltitudeOverride)return clearance;
  const arrival=track.arrivalManaged;
  let target=clearance;
  if(arrival){
    const remaining=arrivalDistance(track,route);
    // Nominal 300 ft/NM descent, a small lead for vertical-rate response.
    target=remaining==null ? clearance : Math.max(30,30+Math.max(0,remaining-2)*3);
    target=Math.min(track.actualFlightLevel,target);
  }
  let floor=arrival ? 30 : 0,ceiling=Infinity;
  for(const {point,distance:toFix} of route){
    const p=point.procedure;if(!p)continue;
    // STAR altitude guidance starts with the destination approach handoff.
    if(p.type==='STAR' && !arrival)continue;
    if(p.type==='SID' && arrival)continue;
    if(Number.isFinite(p.altitude.max)){
      ceiling=Math.min(ceiling,p.altitude.max/100+(arrival ? Math.max(0,toFix-2)*3 : 0));
    }
    if(arrival && Number.isFinite(p.altitude.min))floor=Math.max(floor,p.altitude.min/100);
  }
  return Math.max(floor,Math.min(target,ceiling));
}

export function procedureSpeed(track,baseline,route=remainingProcedureRoute(track)){
  if(Number.isFinite(track.assignedSpeed?.value))return baseline;
  let min=0,max=Infinity;
  let previousCeiling=null;
  for(const leg of route){
    const p=leg.point.procedure;if(!p)continue;
    // The next leg's restriction applies on that leg. Anticipate reductions
    // farther ahead at 8 kt/NM, allowing the existing acceleration model to act.
    const ahead=Math.max(0,leg.distance-2);
    if(Number.isFinite(p.speed.max))max=Math.min(max,p.speed.max+ahead*8);
    if(Number.isFinite(p.speed.min))min=Math.max(min,p.speed.min-ahead*8);
    if(p.type==='SID' && !track.procedureAltitudeOverride && !track.verticalRateAssigned){
      const lower=p.altitude.min,profile=aircraftPerformance(track.aircraftType);
      if(profile && Number.isFinite(lower) && lower>track.actualFlightLevel*100){
        const start=previousCeiling && previousCeiling.level<lower ? previousCeiling : {level:track.actualFlightLevel*100,distance:0};
        const level=start.level/100;
        const phase=level<50?'initialClimb':level<150?'climb150':level<240?'climb240':'machClimb';
        const rate=profile[phase].rateFpm*1.1;
        const seconds=(lower-start.level)*60/rate+rate/100;
        const allowableGs=Math.max(0,leg.distance-start.distance-.1)*3600/seconds;
        max=Math.min(max,allowableGs/convertIasToTas(1,track.actualFlightLevel*100));
      }
      if(Number.isFinite(p.altitude.max))previousCeiling={level:p.altitude.max,distance:leg.distance};
    }
  }
  if(track.arrivalManaged){
    const remaining=arrivalDistance(track,route);
    if(remaining!=null)max=Math.min(max,remaining>30 ? 250 : remaining>15 ? 220 : 180);
  }
  if(max===Infinity && min===0)return baseline;
  // Published speeds are IAS even above the normal Mach conversion altitude.
  // Conversion is performed by movement at the current altitude, without
  // changing the manual instruction or its display.
  return {mode:'IAS',min,max};
}

// Plan ahead for crossing constraints instead of waiting until the fix to
// change level. Explicit controller rate/level clearances remain authoritative.
export function procedureVerticalRate(track,baseline,direction,route=remainingProcedureRoute(track)){
  if(track.procedureAltitudeOverride || track.verticalRateAssigned || !baseline)return baseline;
  let rate=baseline;
  for(const {point,distance:toFix} of route){
    const p=point.procedure;if(!p || (p.type==='STAR' && !track.arrivalManaged))continue;
    const limit=direction>0 ? p.altitude.min : p.altitude.max;
    if(!Number.isFinite(limit))continue;
    const difference=direction*(limit-track.actualFlightLevel*100);
    if(difference<=0)continue;
    // Budget for the existing 50 ft/min/s rate response and fix capture radius.
    const seconds=Math.max(1,Math.max(0,toFix-.1)*3600/Math.max(60,track.groundSpeed)-30);
    rate=Math.max(rate,difference*60/seconds);
  }
  return Math.min(direction>0 ? baseline*1.1 : 6000,rate);
}
