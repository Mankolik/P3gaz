import { randomUUID } from 'node:crypto';
import { createSectorisation, cloneSectorisation, sectorName, validateSectorisation, groupAirspace } from '../src/radar/sectorisation.js';
import { airspaceAt } from '../src/radar/airspace.js';
import { createAircraftSpawner } from '../src/radar/spawner.js';
import { assignHeading, assignDirectTo, remainingPlanPoints } from '../src/radar/routes.js';
import { assignClearedLevel, assignVerticalRate } from '../src/radar/clearances.js';
import { aircraftCeiling } from '../src/radar/performance.js';
import { limitSpeedInstruction } from '../src/radar/speed-control.js';
import { proposalKey } from '../src/radar/coordination.js';
import { updateSharedTraffic, advanceSharedTraffic } from '../src/multiplayer/shared-traffic.js';

const finite=(value,min,max)=>Number.isFinite(value) && value>=min && value<=max;
export { PROTOCOL_VERSION } from '../src/multiplayer/protocol.js';
export class Room {
  constructor(code,data,{random=Math.random,maxAircraft=200}={}){
    this.code=code;this.data=data;this.config=createSectorisation();this.revision=0;this.players=new Map();this.proposals=[];
    this.time=0;this.paused=false;this.speed=1;this.ended=false;this.maxAircraft=maxAircraft;
    this.state={air:{tracks:[],shared:true,sectorisation:this.config,airspaceIndex:groupAirspace(data.airspaceIndex,this.config),
      sectorIndex:data.sectorIndex,navigationIndex:data.navigationIndex,humanSectors:new Set()},map:{}};
    this.spawner=createAircraftSpawner(data.catalogue,{random});
  }
  add(initials,send=()=>{}){
    if(this.ended)throw Error('This room has ended.');
    if(this.players.size>=10)throw Error('This room already has ten players.');
    initials=String(initials || '').trim().toUpperCase();
    if(!/^[A-Z0-9]{1,4}$/.test(initials))throw Error('Enter 1–4 letters or digits for your initials.');
    if([...this.players.values()].some(p=>p.initials===initials))throw Error('Those initials are already in use.');
    const player={id:randomUUID(),initials,sectorId:null,send};this.players.set(player.id,player);
    this.hostId ||= player.id;return player;
  }
  sector(player){return sectorName(this.config.groups.find(g=>g.id===player?.sectorId)?.members || []) || null;}
  controller(sector){return [...this.players.values()].find(p=>this.sector(p)===sector);}
  notify(playerId,message){this.players.get(playerId)?.send({type:'notice',message});}
  refresh(){this.state.air.humanSectors=new Set([...this.players.values()].map(p=>this.sector(p)).filter(Boolean));updateSharedTraffic(this.state);}
  remove(id){
    if(id===this.hostId){this.ended=true;for(const p of this.players.values())p.send({type:'ended',message:'The host left. This session has ended.'});this.players.clear();this.proposals=[];this.state.air.tracks=[];return;}
    this.players.delete(id);
    this.proposals=this.proposals.filter(p=>{if(p.sender===id || p.recipient===id){this.notify(p.sender,'Proposal cancelled: controller disconnected.');return false;}return true;});
    this.refresh();
  }
  host(player){if(player.id!==this.hostId)throw Error('Only the host can do that.');}
  command(playerId,message){
    const player=this.players.get(playerId);if(!player || this.ended)throw Error('This session has ended.');
    if(message.type==='claim'){
      const id=message.sectorId;
      if(id!==null && !this.config.groups.some(g=>g.id===id))throw Error('Choose an available sector.');
      if(id!==null && [...this.players.values()].some(p=>p.id!==player.id && p.sectorId===id))throw Error('That sector was just taken by another player.');
      player.sectorId=id;this.refresh();this.cancelInvalid();return;
    }
    if(message.type==='configure'){this.host(player);this.reconfigure(message.config,message.assignments,message.revision);return;}
    if(message.type==='spawn'){
      this.host(player);if(this.state.air.tracks.length>=this.maxAircraft)throw Error(`This room supports up to ${this.maxAircraft} aircraft.`);
      this.spawner.spawn(this.state);this.refresh();return;
    }
    if(message.type==='delete'){
      this.host(player);this.state.air.tracks=this.state.air.tracks.filter(t=>t.id!==message.trackId);this.cancelInvalid();return;
    }
    if(message.type==='simulation'){
      this.host(player);if(typeof message.paused!=='boolean' || ![1,2,4].includes(message.speed))throw Error('Invalid simulation controls.');
      this.paused=message.paused;this.speed=message.speed;return;
    }
    if(message.type==='proposal'){this.resolve(player,message.proposalId,message.decision);return;}
    if(message.type!=='instruction')throw Error('Unknown command.');
    const sector=this.sector(player);if(!sector)throw Error('Select a sector before issuing instructions.');
    const t=this.state.air.tracks.find(t=>t.id===message.trackId);if(!t)throw Error('Aircraft is no longer available.');
    const kind=message.kind,value=this.validate(t,kind,message.value),visits=t.trajectory?.sequence || [];
    const entry=visits.findIndex(v=>v.sector===sector),owned=t.control.owner===sector;
    if(!owned && entry<0 && t.control.activeSector!==sector)throw Error('This aircraft does not concern your sector.');
    if(kind==='exitFlightLevel'){
      t.sectorExitLevels={...t.sectorExitLevels,[sector]:value};this.changed(t);return;
    }
    if(kind==='clearedFlightLevel' && !owned)throw Error('Only the controlling sector can change CFL.');
    if(kind==='plannedEntryLevel' && (owned || entry<=0))throw Error('PEL is only available for an inbound aircraft.');
    const target=kind==='plannedEntryLevel' ? visits[entry-1].sector : t.control.owner;
    if(owned && kind!=='plannedEntryLevel'){this.apply(t,kind,value,sector);return;}
    if(!target || target==='UNKNOWN')throw Error('No receiving sector is available.');
    const recipient=this.controller(target),key=proposalKey(kind);
    this.proposals=this.proposals.filter(p=>!(p.sender===player.id && p.trackId===t.id && p.key===key));
    this.proposals.push({id:randomUUID(),trackId:t.id,kind,key,value,sender:player.id,senderSector:sector,
      recipient:recipient?.id || null,owner:target,visit:t.control.visit,due:recipient?null:this.time+3});
  }
  validate(t,kind,value){
    if(['clearedFlightLevel','exitFlightLevel','plannedEntryLevel','expectedCruiseLevel'].includes(kind)){
      if(value!==null && (!finite(value,0,660) || !Number.isInteger(value)))throw Error('Enter a valid flight level.');
      if(kind!=='clearedFlightLevel' && value>aircraftCeiling(t))throw Error('That level exceeds the aircraft ceiling.');
      return value;
    }
    if(kind==='heading'){if(value!==null && !finite(value,0,360))throw Error('Enter a valid heading.');return value;}
    if(kind==='speed'){
      if(!['IAS','Mach'].includes(value?.mode) || (value.value!==null && !finite(value.value,.1,600)))throw Error('Enter a valid speed.');
      return limitSpeedInstruction(t,{mode:value.mode,value:value.value});
    }
    if(kind==='vertical'){
      if(value!==null && (!finite(value?.value,-6000,6000) || !['exact','or-less','or-greater'].includes(value.comparator)))throw Error('Enter a valid vertical rate.');
      return value===null ? null : {value:value.value,comparator:value.comparator};
    }
    if(kind==='direct'){
      const p=value?.point,points=[...remainingPlanPoints(t),...(this.data.navigationIndex.get(p?.name) || [])];
      const point=points.find(q=>q.name===p?.name && q.lon===p.lon && q.lat===p.lat);
      if(!point)throw Error('Choose a known navigation point.');
      const options={planIndex:value.options?.planIndex ?? null,rejoinIndex:value.options?.rejoinIndex ?? null};
      const safe={point:{name:point.name,lon:point.lon,lat:point.lat},options};
      assignDirectTo({...t,flightPlan:structuredClone(t.flightPlan)},safe.point,options);return safe;
    }
    throw Error('Unknown instruction.');
  }
  changed(t){t.coordinationRevision=(t.coordinationRevision || 0)+1;t.labelRevision=(t.labelRevision || 0)+1;this.refresh();}
  apply(t,kind,value,sector){
    if(kind==='plannedEntryLevel'){
      t.sectorExitLevels={...t.sectorExitLevels,[sector]:value};
      if(!this.controller(sector) && t.control.activeSector===sector){
        assignClearedLevel(t,value ?? (t.isDeparture?t.expectedCruiseLevel:t.actualFlightLevel));t.control.computerTargetLevel=t.clearedFlightLevel;
      }
    }else if(kind==='clearedFlightLevel')assignClearedLevel(t,value);
    else if(kind==='heading')assignHeading(t,value);
    else if(kind==='direct')assignDirectTo(t,value.point,value.options);
    else if(kind==='speed')t.assignedSpeed=value;
    else if(kind==='vertical')assignVerticalRate(t,value);
    else if(kind==='expectedCruiseLevel')t.expectedCruiseLevel=value;
    this.changed(t);
  }
  validProposal(p){
    const t=this.state.air.tracks.find(t=>t.id===p.trackId),sender=this.players.get(p.sender);
    if(!t || this.sector(sender)!==p.senderSector || (this.controller(p.owner)?.id || null)!==p.recipient)return false;
    if(p.kind==='plannedEntryLevel'){
      const seq=t.trajectory?.sequence || [],entry=seq.findIndex(v=>v.sector===p.senderSector);
      return t.control.owner!==p.senderSector && entry>0 && seq[entry-1].sector===p.owner;
    }
    return t.control.owner===p.owner && t.control.visit===p.visit;
  }
  cancelInvalid(){this.proposals=this.proposals.filter(p=>{if(this.validProposal(p))return true;this.notify(p.sender,'Proposal cancelled: sector or aircraft ownership changed.');return false;});}
  resolve(player,id,decision){
    const p=this.proposals.find(p=>p.id===id);if(!p)throw Error('That proposal is no longer pending.');
    if(decision==='withdraw'){
      if(p.sender!==player.id)throw Error('Only the sender can withdraw this proposal.');
    }else{
      if(p.recipient!==player.id || !['accept','reject'].includes(decision))throw Error('Only the receiving controller can accept or reject this proposal.');
      if(!this.validProposal(p)){this.cancelInvalid();throw Error('The receiving sector changed.');}
      if(decision==='accept'){
        const t=this.state.air.tracks.find(t=>t.id===p.trackId);this.apply(t,p.kind,this.validate(t,p.kind,p.value),p.owner);
      }
      this.notify(p.sender,`${decision==='accept'?'Accepted':'Rejected'} by ${player.initials}: ${p.kind==='direct'?'DCT '+p.value.point.name:p.kind}`);
    }
    this.proposals=this.proposals.filter(q=>q.id!==id);
  }
  step(seconds){
    if(this.ended)return;
    const elapsed=this.paused?0:seconds*this.speed;this.time+=elapsed;
    advanceSharedTraffic(this.state,elapsed);this.cancelInvalid();
    for(const p of [...this.proposals])if(p.recipient===null && p.due<=this.time){
      try{const t=this.state.air.tracks.find(t=>t.id===p.trackId);this.apply(t,p.kind,this.validate(t,p.kind,p.value),p.owner);this.notify(p.sender,'Proposal accepted by '+p.owner);}
      catch(error){this.notify(p.sender,'Proposal cancelled: '+error.message);}
      this.proposals=this.proposals.filter(q=>q.id!==p.id);
    }
  }
  reconfigure(draft,assignments,revision){
    if(revision!==this.revision)throw Error('The sector configuration changed. Reopen the editor.');
    validateSectorisation(draft);
    if(!Number.isSafeInteger(draft.nextId) || draft.nextId<1 || draft.nextId>1000000)throw Error('Invalid sector configuration.');
    const used=new Set();
    for(const p of this.players.values()){
      const id=assignments?.[p.id];
      if(id!==null && (!draft.groups.some(g=>g.id===id) || used.has(id)))throw Error('Assign each player to a distinct sector or Observer.');
      if(id!==null)used.add(id);
    }
    const old=this.config,next=cloneSectorisation(draft),index=groupAirspace(this.data.airspaceIndex,next);
    const map=new Map(old.groups.map(g=>[sectorName(g.members),next.groups.find(n=>n.id===g.id) || next.groups.find(n=>g.members.every(v=>n.members.includes(v)))]));
    for(const t of this.state.air.tracks){
      const owner=this.controller(t.control.owner),physical=airspaceAt(index,t,t.actualFlightLevel),levels={};
      for(const [name,level] of Object.entries(t.sectorExitLevels || {}))if(!map.has(name))levels[name]=level;
      // Absorbed assignments first; surviving destination assignments win.
      for(const g of [...old.groups].sort((a,b)=>Number(next.groups.some(n=>n.id===a.id))-Number(next.groups.some(n=>n.id===b.id)))){
        const replacement=map.get(sectorName(g.members));
        if(replacement && Object.hasOwn(t.sectorExitLevels || {},sectorName(g.members)))levels[sectorName(replacement.members)]=t.sectorExitLevels[sectorName(g.members)];
      }
      const retained=owner && next.groups.find(g=>g.id===assignments[owner.id]);
      if(retained && sectorName(retained.members)===physical)levels[physical]=t.sectorExitLevels?.[t.control.owner] ?? null;
      t.sectorExitLevels=levels;t.coordinationRevision=(t.coordinationRevision || 0)+1;
      Object.assign(t.control,{physical,activeSector:physical,owner:physical,visit:t.control.visit+1,retainPhysicalVisit:true,
        reconfiguredAt:t.control.time,enteredAt:t.control.time,sentTo:null,computerSector:t.isDeparture?null:physical,
        computerTargetLevel:t.isDeparture?null:t.clearedFlightLevel});
    }
    for(const p of this.players.values())p.sectorId=assignments[p.id];
    for(const p of this.proposals)this.notify(p.sender,'Proposal cancelled: sector configuration changed.');
    this.proposals=[];this.config=next;this.revision++;this.state.air.sectorisation=next;this.state.air.airspaceIndex=index;this.refresh();
  }
  metadata(){return {code:this.code,hostId:this.hostId,config:this.config,revision:this.revision,paused:this.paused,speed:this.speed,
    players:[...this.players.values()].map(({id,initials,sectorId})=>({id,initials,sectorId})),proposals:this.proposals};}
}
