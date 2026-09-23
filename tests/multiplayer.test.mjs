import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.js';
import { loadSimulationData } from '../server/data.js';
import { createSectorIndex } from '../src/radar/sectors.js';
import { createAirspaceIndex } from '../src/radar/airspace.js';
import { createTrack } from '../src/radar/tracks.js';
import { cloneSectorisation, addSectorGroup, moveSectorMembers, sectorName } from '../src/radar/sectorisation.js';
import { trackForPlayer } from '../src/multiplayer/view.js';
const loaded=await loadSimulationData();
const f=(properties,a,b)=>({type:'Feature',properties,geometry:{type:'Polygon',coordinates:[[[a,-1],[b,-1],[b,1],[a,1],[a,-1]]]}});
const sectorIndex=createSectorIndex([{features:['LOW','HIGH'].flatMap(vertical=>['T','C'].map((sector,i)=>f({sector,vertical,min_fl:vertical==='LOW'?95:365,max_fl:vertical==='LOW'?365:660},i*2,i*2+2)))}]);
const airspaceIndex=createAirspaceIndex(sectorIndex,{features:[f({AV_AIRSPAC:'EPWWFIR',MIN_FLIGHT:0,MAX_FLIGHT:999},0,4),f({AV_AIRSPAC:'EDUUUIR',MIN_FLIGHT:0,MAX_FLIGHT:999},-5,0),f({AV_AIRSPAC:'ESAAFIR',MIN_FLIGHT:0,MAX_FLIGHT:999},4,8)]});
const data={...loaded,sectorIndex,airspaceIndex,navigationIndex:new Map([['OFF',[{name:'OFF',lon:3,lat:.3}]]])};
function setup(){
  const room=new Room('TEST',data),messages=[];
  const a=room.add('AA',m=>messages.push(m)),b=room.add('BB',m=>messages.push(m));
  const config=cloneSectorisation(room.config),left=addSectorGroup(config);
  moveSectorMembers(config,['T:LOW','T:HIGH'],left);const right=addSectorGroup(config);moveSectorMembers(config,['C:LOW','C:HIGH'],right);
  room.reconfigure(config,{[a.id]:left,[b.id]:right},0);
  const t=createTrack({id:'test',callsign:'LOT123',aircraftType:'A320',departure:'EPWA',destination:'ESSA',lon:.5,lat:0,heading:90,groundSpeed:450,
    actualFlightLevel:330,clearedFlightLevel:330,expectedCruiseLevel:380,exitFlightLevel:null,flightPlan:{waypoints:[{name:'MID',lon:2.5,lat:0},{name:'END',lon:6,lat:0}]}});
  room.state.air.tracks.push(t);room.refresh();return {room,a,b,t,messages,left,right};
}
const instruction=(r,p,t,kind,value)=>r.command(p.id,{type:'instruction',trackId:t.id,kind,value});

test('players join as observers; sector claims are exclusive and host privileges are checked on server',()=>{
  const room=new Room('ROOM',data),a=room.add('AA'),b=room.add('BB');assert.equal(a.sectorId,null);assert.equal(b.sectorId,null);
  room.command(a.id,{type:'claim',sectorId:'acc-1'});
  assert.throws(()=>room.command(b.id,{type:'claim',sectorId:'acc-1'}),/taken/);
  for(const type of ['spawn','delete','configure','simulation'])assert.throws(()=>room.command(b.id,{type}),/Only the host/);
  room.command(a.id,{type:'claim',sectorId:null});room.command(b.id,{type:'claim',sectorId:'acc-1'});assert.equal(b.sectorId,'acc-1');
  for(let i=0;i<8;i++)room.add('P'+i);assert.throws(()=>room.add('ZZ'),/ten players/);
});
test('each player sees their own XFL and the preceding sector XFL as PEL; shared CFL stays authoritative',()=>{
  const {room,a,b,t}=setup();instruction(room,a,t,'exitFlightLevel',360);instruction(room,b,t,'exitFlightLevel',350);
  const av=trackForPlayer(t,room.sector(a),a.id),bv=trackForPlayer(t,room.sector(b),b.id),observer=trackForPlayer(t,null,'spectator');
  assert.equal(av.status,'accepted');assert.equal(av.exitFlightLevel,360);assert.equal(av.clearedFlightLevel,330);
  assert.equal(bv.status,'inbound');assert.equal(bv.plannedEntryLevel,360);assert.equal(bv.exitFlightLevel,350);
  assert.equal(observer.status,'unconcerned');assert.equal(observer.control.readOnly,true);
  assert.throws(()=>instruction(room,b,t,'clearedFlightLevel',350),/Only the controlling/);
});
test('human PEL proposals wait indefinitely, then change upstream XFL without issuing its CFL',()=>{
  const {room,a,b,t}=setup();instruction(room,b,t,'plannedEntryLevel',360);room.step(15);
  assert.equal(room.proposals.length,1);assert.equal(t.sectorExitLevels?.['T L+H'],undefined);assert.equal(t.clearedFlightLevel,330);
  const p=room.proposals[0];assert.equal(p.recipient,a.id);assert.equal(p.due,null);
  const sender=trackForPlayer(t,room.sector(b),b.id,room.proposals),receiver=trackForPlayer(t,room.sector(a),a.id,room.proposals);
  assert.equal(sender.control.pending.plannedEntryLevel.value,360);assert.equal(receiver.control.incoming[0].value,360);
  room.command(a.id,{type:'proposal',proposalId:p.id,decision:'accept'});
  assert.equal(t.sectorExitLevels['T L+H'],360);assert.equal(t.clearedFlightLevel,330);assert.equal(room.proposals.length,0);
});
test('DCT, heading, speed, rate and ECL proposals do not apply until accepted; rejection preserves old clearance',()=>{
  const {room,a,b,t}=setup();
  const samples=[['heading',180,()=>t.assignedHeading],['speed',{mode:'IAS',value:250},()=>t.assignedSpeed],['vertical',{value:1000,comparator:'exact'},()=>t.assignedVertical],['expectedCruiseLevel',370,()=>t.expectedCruiseLevel],['direct',{point:{name:'OFF',lon:3,lat:.3}},()=>t.directTo?.target.name]];
  for(const [kind,value,read] of samples){
    const before=JSON.stringify(read());instruction(room,b,t,kind,value);room.step(4);assert.equal(JSON.stringify(read()),before,kind);
    let p=room.proposals.find(p=>p.kind===kind);room.command(a.id,{type:'proposal',proposalId:p.id,decision:'reject'});assert.equal(JSON.stringify(read()),before);
    instruction(room,b,t,kind,value);p=room.proposals.find(p=>p.kind===kind);room.command(a.id,{type:'proposal',proposalId:p.id,decision:'accept'});assert.notEqual(JSON.stringify(read()),before,kind);
  }
});
test('sender can replace and withdraw; strangers and sender cannot accept; stale IDs cannot accept replacement',()=>{
  const {room,a,b,t}=setup(),observer=room.add('CC');instruction(room,b,t,'heading',180);const first=room.proposals[0];
  assert.throws(()=>room.command(b.id,{type:'proposal',proposalId:first.id,decision:'accept'}),/receiving/);
  assert.throws(()=>room.command(observer.id,{type:'proposal',proposalId:first.id,decision:'reject'}),/receiving/);
  instruction(room,b,t,'heading',200);assert.equal(room.proposals.length,1);assert.notEqual(room.proposals[0].id,first.id);
  assert.throws(()=>room.command(a.id,{type:'proposal',proposalId:first.id,decision:'accept'}),/no longer/);
  room.command(b.id,{type:'proposal',proposalId:room.proposals[0].id,decision:'withdraw'});assert.equal(room.proposals.length,0);assert.equal(t.assignedHeading,null);
});
test('computer proposals keep three-second acceptance; human claiming target cancels pending automatic clearance',()=>{
  const {room,a,b,t}=setup();room.command(a.id,{type:'claim',sectorId:null});instruction(room,b,t,'plannedEntryLevel',350);
  room.step(2.9);assert.equal(t.clearedFlightLevel,330);room.step(.1);assert.equal(t.clearedFlightLevel,350);
  instruction(room,b,t,'heading',180);room.command(a.id,{type:'claim',sectorId:room.config.groups.find(g=>sectorName(g.members)==='T L+H').id});
  room.step(4);assert.equal(t.assignedHeading,null);assert.equal(room.proposals.length,0);
});
test('automatic transfer updates both views; remote proposals cannot survive ownership changes',()=>{
  const {room,a,b,t}=setup();room.step(4);instruction(room,b,t,'heading',180);instruction(room,b,t,'plannedEntryLevel',360);assert.equal(room.proposals.length,2);t.lon=1.9;room.refresh();room.cancelInvalid();
  assert.equal(t.control.owner,'C L+H');assert.equal(trackForPlayer(t,'T L+H',a.id).status,'intruder');assert.equal(trackForPlayer(t,'C L+H',b.id).status,'accepted');
  assert.equal(room.proposals.length,0);t.lon=2.1;room.refresh();assert.equal(trackForPlayer(t,'T L+H',a.id).status,'unconcerned');
});
test('host reconfiguration assigns all affected players atomically and preserves clearances for retained controller',()=>{
  const {room,a,b,t,left,right}=setup();instruction(room,a,t,'exitFlightLevel',360);
  const config=cloneSectorisation(room.config),newId=addSectorGroup(config);moveSectorMembers(config,['T:LOW'],newId);
  assert.throws(()=>room.reconfigure(config,{[a.id]:newId,[b.id]:newId},room.revision),/distinct/);assert.equal(a.sectorId,left);
  room.reconfigure(config,{[a.id]:newId,[b.id]:right},room.revision);
  assert.equal(t.control.owner,'T L');assert.equal(t.sectorExitLevels['T L'],360);assert.equal(t.clearedFlightLevel,330);
  assert.throws(()=>room.reconfigure(config,{[a.id]:newId,[b.id]:right},0),/changed/);
});
test('guest departure releases sector, host departure ends room and invalid payloads cannot mutate aircraft',()=>{
  const {room,a,b,t}=setup();const c=room.add('CC');
  assert.throws(()=>instruction(room,c,t,'heading',100),/Select a sector/);
  for(const [kind,value] of [['heading',Infinity],['clearedFlightLevel',-10],['speed',{mode:'bogus',value:250}],['direct',{point:{name:'FAKE',lon:1,lat:2}}],['owner','BB']])assert.throws(()=>instruction(room,a,t,kind,value));
  room.remove(b.id);assert.equal(room.controller('C L+H'),undefined);room.remove(a.id);assert(room.ended);assert.equal(room.players.size,0);assert.equal(room.state.air.tracks.length,0);
});
