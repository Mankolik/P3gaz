import { assignHeading, assignDirectTo } from './routes.js';
import { assignClearedLevel, assignVerticalRate } from './clearances.js';
import { aircraftCeiling } from './performance.js';
import { limitSpeedInstruction } from './speed-control.js';

const changed=track=>{
  track.coordinationRevision=(track.coordinationRevision || 0)+1;
  track.labelRevision=(track.labelRevision || 0)+1;
};
const planSignature=track=>JSON.stringify(track.flightPlan?.waypoints || []);
export const proposalKey=kind=>['heading','direct'].includes(kind) ? 'navigation' : kind;

function applyInstruction(track,kind,value){
  if(kind==='clearedFlightLevel')assignClearedLevel(track,value);
  else if(kind==='heading')assignHeading(track,value);
  else if(kind==='direct')assignDirectTo(track,value.point,value.options);
  else if(kind==='speed')track.assignedSpeed=limitSpeedInstruction(track,value);
  else if(kind==='vertical')assignVerticalRate(track,value);
  else if(kind==='plannedEntryLevel'){
    track.plannedEntryLevel=value;
    const active=track.control?.activeSector ?? track.control?.physical;
    if(track.control && active!==track.control.sector){
      const visits=track.trajectory?.sequence || [];
      const entry=visits.findIndex(v=>v.sector===track.control.sector);
      const previous=entry>0 ? visits[entry-1].sector : active;
      track.sectorExitLevels={...track.sectorExitLevels,[previous]:value};
      // The simulated neighbouring controller issues its own matching CFL.
      const fallback=track.isDeparture ? track.expectedCruiseLevel : track.actualFlightLevel;
      if(previous===active){
        assignClearedLevel(track,Number.isFinite(value)?value:Math.min(aircraftCeiling(track),fallback));
        track.control.computerTargetLevel=track.clearedFlightLevel;
      }
    }
  }else track[kind]=value;
  changed(track);
}

export function issueInstruction(track,kind,value){
  const control=track.control;
  const remote=control && control.owner!==control.sector;
  if(kind==='clearedFlightLevel' && remote)return false;
  if(kind==='plannedEntryLevel' && value!=null && (!Number.isFinite(value) || value>aircraftCeiling(track)))return false;
  if(kind==='direct'){
    // Validate without advancing the real plan before acceptance.
    const copy={...track,flightPlan:track.flightPlan ? {...track.flightPlan} : null};
    assignDirectTo(copy,value.point,value.options);
  }
  const key=proposalKey(kind);
  if(remote && ['plannedEntryLevel','heading','direct','speed','vertical'].includes(kind)){
    if(!control.owner || control.owner==='UNKNOWN')return false;
    control.pending[key]={kind,value,owner:control.owner,visit:control.visit,
      plan:kind==='direct'?planSignature(track):null,due:control.time+3};
    track.coordinationMessage='Proposal awaiting acceptance';
    track.labelRevision=(track.labelRevision || 0)+1;
    return true;
  }
  if(control)delete control.pending[key];
  applyInstruction(track,kind,value);
  return true;
}

export function advanceProposals(track){
  const control=track.control;
  if(!control)return;
  for(const [key,proposal] of Object.entries(control.pending)){
    if(control.owner!==proposal.owner || control.visit!==proposal.visit || (proposal.kind==='direct' && proposal.plan!==planSignature(track))){
      delete control.pending[key];
      track.coordinationMessage='Proposal cancelled: sector visit or route changed';
      track.labelRevision=(track.labelRevision || 0)+1;
      continue;
    }
    if(control.time+1e-8<proposal.due)continue;
    delete control.pending[key];
    try{
      applyInstruction(track,proposal.kind,proposal.value);
      track.coordinationMessage='Proposal accepted';
    }catch(error){
      track.coordinationMessage=`Proposal cancelled: ${error.message}`;
      track.labelRevision=(track.labelRevision || 0)+1;
    }
  }
}

export function proposedDisplayTrack(track){
  const display={...track};
  for(const p of Object.values(track.control?.pending || {})){
    if(p.kind==='heading')display.assignedHeading=p.value;
    else if(p.kind==='speed')display.assignedSpeed=p.value;
    else if(p.kind==='vertical'){
      display.assignedVertical=p.value;display.verticalRateAssigned=p.value!=null;
    }else if(p.kind==='plannedEntryLevel')display.plannedEntryLevel=p.value;
  }
  return display;
}
