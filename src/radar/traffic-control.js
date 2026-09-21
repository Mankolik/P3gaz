import { airspaceAt } from './airspace.js';
import { buildTrajectory, trajectoryRoute, distanceNm, sectorTargetLevel } from './trajectory.js';
import { advanceProposals } from './coordination.js';
import { updateTrackMovement } from './movement.js';
import { assignClearedLevel } from './clearances.js';

const cache=new WeakMap();
export const TRANSFER_DISTANCE_NM=10;

// Labels are a view of shared ownership and predicted crossings, not ownership
// itself. Another controller can derive a different label for the same track.
export function statusForSector(track,sector){
  if(track.control?.owner===sector)return 'accepted';
  if(track.control?.physical===sector)return 'intruder';
  const next=track.trajectory?.sequence.findIndex(visit=>visit.sector===sector) ?? -1;
  return next===1 ? 'inbound' : next>1 ? 'preinbound' : 'unconcerned';
}

export function updateTrafficControl(state,seconds=0){
  const index=state.air?.airspaceIndex;
  if(!index?.complete)return;
  const controlled=state.air.controlledSector || 'ALLFIR';
  for(const track of state.air.tracks){
    const physical=airspaceAt(index,track,track.actualFlightLevel,track.control?.physical);
    if(!track.control)track.control={sector:controlled,owner:physical,physical,time:0,pending:{},
      hasEntered:physical===controlled,enteredAt:physical===controlled?0:null,visit:0};
    const c=track.control;
    c.time+=Math.max(0,seconds);
    const previous=c.physical;
    if(previous!==physical){
      c.physical=physical;c.visit++;
      if(physical===controlled){c.hasEntered=true;c.enteredAt=c.time;c.owner=controlled;c.sentTo=null;}
      else if(previous===controlled || c.owner===previous){c.owner=physical;c.sentTo=null;}
      track.labelRevision=(track.labelRevision || 0)+1;
    }
    // Computer sectors fly their coordinated exit level. The receiving sector
    // does not start its climb/descent while still in the previous volume.
    if(physical!==controlled && physical!=='UNKNOWN' && c.owner!==controlled && c.computerSector!==physical){
      c.computerSector=physical;
      c.computerTargetLevel=sectorTargetLevel(track,physical,track.clearedFlightLevel ?? track.actualFlightLevel,!c.hasEntered);
      assignClearedLevel(track,c.computerTargetLevel);
    }
    if(physical===controlled){c.computerSector=null;c.computerTargetLevel=null;}
    advanceProposals(track);
    const routeKey=trajectoryRoute(track);
    const signature=JSON.stringify([routeKey,track.exitFlightLevel,track.plannedEntryLevel,
      track.expectedCruiseLevel,track.sectorExitLevels,track.coordinationRevision,physical,c.hasEntered]);
    const old=cache.get(track);
    if(!old || old.index!==index || old.signature!==signature || c.time-old.time>=5
      || distanceNm(old.position,track)>=0.5 || Math.abs(old.level-track.actualFlightLevel)>=1){
      track.trajectory=buildTrajectory(track,index);
      cache.set(track,{index,signature,time:c.time,position:{lon:track.lon,lat:track.lat},level:track.actualFlightLevel});
      track.labelRevision=(track.labelRevision || 0)+1;
    }
    const visits=track.trajectory.sequence;
    const travelled=old && old===cache.get(track) ? distanceNm(old.position,track) : 0;
    if(physical===controlled){
      const next=visits[0]?.sector===controlled ? visits[1] : null;
      if(next && next.sector!=='UNKNOWN' && next.entry.distanceNm-travelled<=TRANSFER_DISTANCE_NM && c.time-c.enteredAt>=3){
        c.owner=next.sector;c.sentTo=next.sector;
      }else if(c.sentTo && (!next || next.sector!==c.sentTo)){
        c.owner=controlled;c.sentTo=null;
      }
    }else{
      const entry=visits.findIndex(v=>v.sector===controlled);
      if(entry===1 && visits[entry].entry.distanceNm-travelled<=TRANSFER_DISTANCE_NM){
        c.owner=controlled;
      }else if(c.owner===controlled && entry===-1){
        c.owner=physical;
      }
    }
    // A transfer invalidates outstanding proposals to the previous owner.
    advanceProposals(track);
    const status=statusForSector(track,controlled);
    if(track.status!==status){track.status=status;track.labelRevision=(track.labelRevision || 0)+1;}
  }
}

export function advanceTraffic(state,seconds){
  if(!state.air?.airspaceIndex?.complete){updateTrackMovement(state,seconds);return;}
  updateTrafficControl(state,0);
  let remaining=Math.max(0,seconds || 0);
  while(remaining>0){
    const step=Math.min(0.5,remaining);
    updateTrackMovement(state,step);
    updateTrafficControl(state,step);
    remaining-=step;
  }
}
