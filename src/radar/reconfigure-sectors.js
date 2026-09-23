import { airspaceAt } from './airspace.js';
import { createSectorisation, cloneSectorisation, validateSectorisation, sectorName, groupAirspace } from './sectorisation.js';
import { updateTrafficControl } from './traffic-control.js';

// Apply one complete partition atomically. Geometry and physical membership
// remain untouched; only the groups that own the elementary volumes change.
export function applySectorisation(state,draft){
  validateSectorisation(draft);
  if(!state.air.airspaceIndex?.complete)throw Error('Wait for the airspace data to load.');
  const config=cloneSectorisation(draft),old=state.air.sectorisation || createSectorisation();
  const names=new Map(old.groups.map(group=>{
    let replacement=config.groups.find(g=>g.id===group.id);
    // A fully absorbed group carries coordination into its receiving group.
    replacement ||= config.groups.find(g=>group.members.every(id=>g.members.includes(id)));
    return [sectorName(group.members),replacement ? sectorName(replacement.members) : null];
  }));
  const controlled=sectorName(config.groups.find(g=>g.id===config.controlledId).members);
  const survivingNames=new Set(old.groups.filter(g=>config.groups.some(next=>next.id===g.id)).map(g=>sectorName(g.members)));
  const index=groupAirspace(state.air.airspaceIndex,config);
  for(const track of state.air.tracks){
    const c=track.control,levels={...track.sectorExitLevels};
    const physical=airspaceAt(index,track,track.actualFlightLevel);
    const retainedControl=c?.owner===c?.sector && physical===controlled;
    levels[c?.sector || state.air.controlledSector || 'ALLFIR']=track.exitFlightLevel;
    const remapped={};
    // Keep destination assignments in a merge when both sides had an XFL.
    for(const [name,value] of Object.entries(levels).sort(([a],[b])=>Number(survivingNames.has(a))-Number(survivingNames.has(b)))){
      const next=names.has(name) ? names.get(name) : name;
      if(next && (remapped[next]==null || survivingNames.has(name)))remapped[next]=value;
    }
    if(retainedControl)remapped[controlled]=track.exitFlightLevel;
    track.sectorExitLevels=remapped;
    track.exitFlightLevel=remapped[controlled] ?? null;
    track.plannedEntryLevel=null;
    const time=c?.time || 0;
    track.control={...c,sector:controlled,physical,activeSector:physical,owner:physical,
      sectorised:true,accSectors:index.accSectors,retainPhysicalVisit:true,time,pending:{},
      visit:(c?.visit || 0)+1,hasEntered:physical===controlled,enteredAt:physical===controlled?time:null,
      reconfiguredAt:time,sentTo:null,computerSector:track.isDeparture ? null : physical,
      computerTargetLevel:track.isDeparture ? null : track.clearedFlightLevel};
    if(Object.keys(c?.pending || {}).length)track.coordinationMessage='Proposal cancelled: sector configuration changed';
    track.coordinationRevision=(track.coordinationRevision || 0)+1;
    track.labelRevision=(track.labelRevision || 0)+1;
  }
  state.air.sectorisation=config;
  state.air.controlledSector=controlled;
  state.air.airspaceIndex=index;
  updateTrafficControl(state);
  state.bus?.emit('sectorisation:changed');
}
