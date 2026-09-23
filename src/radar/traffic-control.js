import { airspaceAt, insideEpww } from './airspace.js';
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
  if((track.control?.activeSector ?? track.control?.physical)===sector)return 'intruder';
  const next=track.trajectory?.sequence.findIndex(visit=>visit.sector===sector) ?? -1;
  return next===1 ? 'inbound' : next>1 ? 'preinbound' : 'unconcerned';
}

export function updateTrafficControl(state,seconds=0){
  const index=state.air?.airspaceIndex;
  if(!index?.complete)return;
  const controlled=state.air.controlledSector || 'ALLFIR';
  for(const track of state.air.tracks){
    const physical=airspaceAt(index,track,track.actualFlightLevel,track.control?.physical);
    if(!track.control)track.control={sector:controlled,owner:physical,physical,activeSector:physical,retainPhysicalVisit:true,time:0,pending:{},
      hasEntered:physical===controlled,enteredAt:physical===controlled?0:null,visit:0};
    const c=track.control;
    c.sectorised=!!index.accSectors;
    c.accSectors=index.accSectors;
    c.activeSector ??= c.physical;
    c.hasEnteredFir ||= insideEpww(index,track);
    c.time+=Math.max(0,seconds);
    const previous=c.physical;
    if(previous!==physical){
      const next=track.trajectory?.sequence[1],origin=track.trajectory?.points[0];
      // The same designator may occur in an omitted island before the real
      // entry. Retain only the visit whose entry we have actually reached.
      c.retainPhysicalVisit=physical===c.activeSector || (next?.sector===physical && origin
        && distanceNm(origin,track)+1e-6>=next.entry.distanceNm);
      c.physical=physical;
      track.labelRevision=(track.labelRevision || 0)+1;
    }
    if(previous===physical)advanceProposals(track);
    const routeKey=trajectoryRoute(track);
    const signature=()=>JSON.stringify([routeKey,track.exitFlightLevel,c.sectorised ? null : track.plannedEntryLevel,
      track.expectedCruiseLevel,track.sectorExitLevels,track.coordinationRevision,physical,c.hasEntered,
      c.activeSector,c.computerTargetLevel]);
    const old=cache.get(track);
    const refreshTrajectory=()=>{
      track.trajectory=buildTrajectory(track,index);
      cache.set(track,{index,signature:signature(),time:c.time,position:{lon:track.lon,lat:track.lat},level:track.actualFlightLevel});
      track.labelRevision=(track.labelRevision || 0)+1;
    };
    if(!old || old.index!==index || old.signature!==signature() || c.time-old.time>=5
      || distanceNm(old.position,track)>=0.5 || Math.abs(old.level-track.actualFlightLevel)>=1)refreshTrajectory();
    const active=track.trajectory.sequence[0]?.sector ?? physical;
    if(active!==c.activeSector){
      const previousActive=c.activeSector;
      c.activeSector=active;c.visit++;c.retainPhysicalVisit=true;
      if(active===controlled){c.hasEntered=true;c.enteredAt=c.time;c.owner=controlled;c.sentTo=null;}
      else if(previousActive===controlled || c.owner===previousActive){c.owner=active;c.sentTo=null;}
      track.labelRevision=(track.labelRevision || 0)+1;
    }
    // Omitted physical visits neither take ownership nor issue clearances.
    const computerTarget=sectorTargetLevel(track,active,track.clearedFlightLevel ?? track.actualFlightLevel,!c.hasEntered);
    if(active!==controlled && active!=='UNKNOWN' && c.owner!==controlled && (c.computerSector!==active
      || (track.isDeparture && c.computerTargetLevel!==computerTarget))){
      c.computerSector=active;
      c.computerTargetLevel=computerTarget;
      assignClearedLevel(track,c.computerTargetLevel);
    }
    if(active===controlled){c.computerSector=null;c.computerTargetLevel=null;}
    // Keep the profile consistent with a just-entered meaningful sector's
    // computer clearance immediately, rather than waiting for the cache age.
    if(cache.get(track).signature!==signature())refreshTrajectory();
    const visits=track.trajectory.sequence;
    if(c.sectorised){
      const entry=visits.findIndex(v=>v.sector===controlled);
      track.plannedEntryLevel=entry>0 ? visits[entry-1].targetLevel : track.plannedEntryLevel;
    }
    const travelled=old && old===cache.get(track) ? distanceNm(old.position,track) : 0;
    if(c.reconfiguredAt!=null && c.time-c.reconfiguredAt<3){
      // Reconfiguration transfers by current position, without immediately
      // undoing that decision through the normal early-transfer window.
    }else if(active===controlled){
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
        c.owner=active;
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
