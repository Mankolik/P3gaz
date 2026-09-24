import { airspaceAt, insideEpww } from '../radar/airspace.js';
import { buildTrajectory, trajectoryRoute, distanceNm, sectorTargetLevel } from '../radar/trajectory.js';
import { updateTrackMovement } from '../radar/movement.js';
import { assignClearedLevel } from '../radar/clearances.js';
import { updateArrivalControl } from '../radar/procedure-guidance.js';
import { removeFinishedTraffic } from '../radar/traffic-lifecycle.js';

const cache=new WeakMap();
export function updateSharedTraffic(state,seconds=0){
  const index=state.air.airspaceIndex,humans=state.air.humanSectors || new Set();
  for(const t of state.air.tracks){
    const physical=airspaceAt(index,t,t.actualFlightLevel,t.control?.physical);
    t.control ||= {shared:true,sectorised:true,physical,activeSector:physical,owner:physical,time:0,visit:0,enteredAt:0,retainPhysicalVisit:true,pending:{}};
    const c=t.control;c.shared=true;c.sectorised=true;c.accSectors=index.accSectors;c.time+=seconds;c.hasEnteredFir ||= insideEpww(index,t);
    if(physical!==c.physical){
      const next=t.trajectory?.sequence[1],origin=t.trajectory?.points[0];
      c.retainPhysicalVisit=physical===c.activeSector || (next?.sector===physical && origin && distanceNm(origin,t)+1e-6>=next.entry.distanceNm);
      c.physical=physical;
    }
    const signature=()=>JSON.stringify([trajectoryRoute(t),t.sectorExitLevels,t.expectedCruiseLevel,t.coordinationRevision,physical,c.activeSector,c.computerTargetLevel]);
    const refresh=()=>{t.trajectory=buildTrajectory(t,index);cache.set(t,{index,key:signature(),time:c.time,lon:t.lon,lat:t.lat,level:t.actualFlightLevel});};
    const old=cache.get(t);
    if(!old || old.index!==index || old.key!==signature() || c.time-old.time>=5 || distanceNm(old,t)>=.5 || Math.abs(old.level-t.actualFlightLevel)>=1)refresh();
    const active=t.trajectory.sequence[0]?.sector || physical;
    if(c.activeSector!==active){c.activeSector=active;c.owner=active;c.visit++;c.enteredAt=c.time;c.sentTo=null;c.retainPhysicalVisit=true;}
    const saved=cache.get(t),travelled=distanceNm(saved,t),next=t.trajectory.sequence[1];
    if(c.reconfiguredAt==null || c.time-c.reconfiguredAt>=3){
      if(next && next.sector!=='UNKNOWN' && next.entry.distanceNm-travelled<=10 && c.time-c.enteredAt>=3){c.owner=next.sector;c.sentTo=next.sector;}
      else if(c.sentTo && (!next || next.sector!==c.sentTo)){c.owner=active;c.sentTo=null;}
    }
    const target=sectorTargetLevel(t,active,t.clearedFlightLevel ?? t.actualFlightLevel);
    updateArrivalControl(state,t);
    if(!t.arrivalManaged && !humans.has(active) && !humans.has(c.owner) && active!=='UNKNOWN'){
      if(c.computerSector!==active || (t.isDeparture && c.computerTargetLevel!==target)){
        c.computerSector=active;c.computerTargetLevel=target;assignClearedLevel(t,target,{computer:true});
      }
    }else if(!t.arrivalManaged){c.computerSector=null;c.computerTargetLevel=null;}
    if(cache.get(t).key!==signature())refresh();
  }
}
export function advanceSharedTraffic(state,seconds){
  updateSharedTraffic(state);
  let left=seconds;
  while(left>0){const step=Math.min(.5,left);updateTrackMovement(state,step);updateSharedTraffic(state,step);removeFinishedTraffic(state,step);left-=step;}
}
