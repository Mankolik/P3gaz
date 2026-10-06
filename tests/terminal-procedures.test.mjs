import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSimulationData } from '../server/data.js';
import { Room } from '../server/room.js';
import { TERMINAL_PROCEDURES } from '../src/data/terminal-procedures.js';
import { findTerminalProcedure,procedureRoutePoints } from '../src/radar/terminal-routes.js';
import { createTrack } from '../src/radar/tracks.js';
import { assignDirectTo,assignHeading,bearingToPoint } from '../src/radar/routes.js';
import { procedureFlightLevel,remainingProcedureRoute,updateArrivalControl } from '../src/radar/procedure-guidance.js';
import { assignClearedLevel } from '../src/radar/clearances.js';
import { performanceSchedule } from '../src/radar/performance.js';
import { effectiveProcedureSpeed } from '../src/radar/speed-control.js';
import { updateTrackMovement } from '../src/radar/movement.js';
import { removeFinishedTraffic } from '../src/radar/traffic-lifecycle.js';
import { createFirBoundary } from '../src/radar/fir-boundary.js';
import { calculateAirSpeeds,convertIasToTas } from '../src/utils/speed.js';
import { wireTrack,createStateReceiver } from '../src/multiplayer/protocol.js';
import { SnapshotStream } from '../server/snapshots.js';
import { advanceTraffic } from '../src/radar/traffic-control.js';
import { tokenizeRoute } from '../src/radar/route-catalogue.js';
import { createAircraftSpawner } from '../src/radar/spawner.js';
import { requestTransfer,nextTransferSector } from '../src/radar/transfers.js';

const data=await loadSimulationData();
const point=(name,lon,altitude={},speed={},type='STAR')=>({name,lon,lat:0,
  procedure:{type,airport:'EPWA',name:'TEST 1A',runway:'33',altitude,speed}});
const plan=[point('FIRST',.1,{min:12000,max:14000},{max:220}),
  point('SECOND',.5,{min:5000},{max:180}),{name:'EPWA',lon:.7,lat:0}];
const track=(points=plan)=>createTrack({id:'test',callsign:'TEST1',aircraftType:'B738',lon:0,lat:0,heading:90,
  actualFlightLevel:160,clearedFlightLevel:30,groundSpeed:convertIasToTas(280,16000),
  departure:'EGLL',destination:'EPWA',flightPlan:{waypoints:points}});
const state=t=>({air:{tracks:[t],controlledSector:'ALLFIR'},map:{}});
const managed=t=>{t.arrivalManaged=true;t.arrivalAirport=plan.at(-1);return t;};
const speed=t=>effectiveProcedureSpeed(t,performanceSchedule(t)).value;

test('all 211 matching domestic terminal procedures resolve, including terminal DCT notation',()=>{
  assert.equal(TERMINAL_PROCEDURES.length,155);
  assert.equal(data.catalogue.validVariants,251);
  let count=0;
  for(const group of data.catalogue.groups)for(const v of group.variants){
    const tokens=tokenizeRoute(v.route,group.departure,group.destination);
    for(const type of ['SID','STAR']){
      const airport=type==='SID'?group.departure:group.destination;
      const connection=type==='SID' ? tokens.fixes[1] : tokens.fixes.at(-2);
      const expected=findTerminalProcedure(airport,type,connection);
      const fixes=v.waypoints.filter(p=>p.procedure?.type===type);
      if(expected){
        assert(fixes.length,`${group.departure}-${group.destination} ${type}`);count++;
        assert(fixes.every(p=>p.procedure.name===expected.name));
      }
      else assert.equal(fixes.length,0,`${airport} ${type}`);
      if(fixes.length){
        const first=fixes[0],last=fixes.at(-1);
        assert.equal(v.waypoints.filter(p=>p.name===(type==='SID'?last:first).name).length,1);
      }
    }
  }
  assert.equal(count,211);
  assert.equal(findTerminalProcedure('EPMO','STAR','GOGUS').name,'GOGUS 1Y');
  assert.equal(findTerminalProcedure('EPLB','SID','VADOL').name,'VADOL 1J');
  assert.equal(findTerminalProcedure('EPRZ','STAR','LUXAR').name,'LUXAR 3D');
  for(const p of TERMINAL_PROCEDURES)for(const fix of p.points){
    assert(Number.isFinite(fix.lon)&&Number.isFinite(fix.lat));
    assert(data.navigationIndex.has(fix.name),fix.name);
  }
});

test('RYR33YN uses EPMO SORIX STAR from the filed connection through snapshots',()=>{
  const group=data.catalogue.groups.find(g=>g.callsigns.includes('RYR33YN'));
  const room=new Room('SORIX',data);
  room.spawner=createAircraftSpawner({...data.catalogue,groups:[{...group,callsigns:['RYR33YN']}]},{random:()=>0});
  const host=room.add('AA');room.command(host.id,{type:'spawn'});
  const t=room.state.air.tracks[0],star=wireTrack(t).flightPlan.waypoints.filter(p=>p.procedure?.type==='STAR');
  assert.equal(t.callsign,'RYR33YN');assert.equal(star[0].name,'SORIX');
  assert(star.every(p=>p.procedure.airport==='EPMO' && p.procedure.name==='SORIX 3Y'));
  assert.equal(t.flightPlan.waypoints.filter(p=>p.name==='SORIX').length,1);
});

test('every airport departure starts at FL030 in a solo multiplayer room, including both EPLL routes',()=>{
  let checked=0,epll=0;
  const room=new Room('SPAWN',data),host=room.add('AA');room.command(host.id,{type:'claim',sectorId:'acc-1'});
  for(const group of data.catalogue.groups)for(const variant of group.variants){
    if(!variant.groundStart)continue;
    room.state.air.tracks=[];
    room.spawner=createAircraftSpawner({...data.catalogue,groups:[{...group,variants:[variant]}]},{random:()=>.5});
    room.command(host.id,{type:'spawn'});
    const t=room.state.air.tracks[0],wire=wireTrack(t);
    assert.equal(t.spawnPoint,group.departure);assert.equal(t.actualFlightLevel,30,variant.route);
    assert.equal(wire.actualFlightLevel,30);assert.equal(t.onGround,false);
    assert.equal(calculateAirSpeeds(t.groundSpeed,3000,t.heading).ias,180);
    checked++;if(group.departure==='EPLL')epll++;
  }
  assert(checked>50);assert.equal(epll,2);
});

test('outbound cleanup preserves a human owner and pending human acceptance until manual handoff',()=>{
  for(const shared of [false,true])for(const offered of [false,true]){
    const t=track();t.hasBeenInsideFir=true;
    t.control={owner:offered?'EDU':'ALLFIR',transfer:offered?{from:'EDU',to:'ALLFIR'}:null};
    const s=state(t);Object.assign(s.air,{shared,humanSectors:new Set(['ALLFIR']),
      firBoundary:{contains:()=>false,distanceToEdge:()=>100}});
    removeFinishedTraffic(s,60);assert.equal(s.air.tracks.length,1);
    t.control.owner='ESA';t.control.transfer=null;
    removeFinishedTraffic(s,1);assert.equal(s.air.tracks.length,0);
  }
});

test('published altitude windows retain both bounds, including FL versus feet',()=>{
  const p=findTerminalProcedure('EPMO','STAR','GOGUS').points.find(p=>p.name==='GIPOS');
  assert.deepEqual(p.altitude,{max:14000,min:12000});
  const sid=findTerminalProcedure('EPSY','SID','LUSUL').points.find(p=>p.name==='SY514');
  assert.deepEqual(sid.altitude,{max:6500,min:5000});
});

test('shortcuts retain the destination restriction and drop every bypassed restriction',()=>{
  const t=managed(track());t.lon=.4;
  assert(procedureFlightLevel(t)>=120);
  assignDirectTo(t,t.flightPlan.waypoints[1],{planIndex:1});
  assert.equal(remainingProcedureRoute(t)[0].point.name,'SECOND');
  assert(procedureFlightLevel(t)<120);
  assert.equal(t.directTo.target.procedure.speed.max,180);
  assignDirectTo(t,{name:'OFF',lon:.2,lat:.1},{rejoinIndex:2});
  assert(remainingProcedureRoute(t).every(p=>!p.point.procedure));
  assignHeading(t,180);
  assert.equal(remainingProcedureRoute(t).length,0);
});

test('human level and speed clearances override procedure constraints, and clearing restores them',()=>{
  const t=managed(track());
  assignClearedLevel(t,50);assert.equal(procedureFlightLevel(t),50);
  assert.equal(assignClearedLevel(t,660),false);assert.equal(procedureFlightLevel(t),50);
  assignClearedLevel(t,null);assert(procedureFlightLevel(t)>=120);
  t.assignedSpeed={mode:'IAS',value:300};assert.equal(speed(t),300);
  t.assignedSpeed={mode:'IAS',value:null};assert(speed(t)<300);
});

test('SID altitude ceilings and speed minima/exact/maxima are applied with gradual motion',()=>{
  const fixes=[point('LIMIT',.025,{max:4000,min:3000},{min:200,max:210},'SID'),{name:'END',lon:1,lat:0}];
  const t=track(fixes);Object.assign(t,{actualFlightLevel:30,clearedFlightLevel:200});
  assert.equal(procedureFlightLevel(t),40);
  assert(speed(t)>=200 && speed(t)<=210);
  const s=state(t),before=t.groundSpeed;updateTrackMovement(s,.5);
  assert(Math.abs(t.groundSpeed-before)<=2.5+1e-8);
  assignDirectTo(t,t.flightPlan.waypoints[1]);assert.equal(procedureFlightLevel(t),200);
  // Exact speed is both a lower and an upper bound.
  const exact=track([point('EXACT',.01,{}, {min:210,max:210})]);
  assert.equal(speed(exact),210);
});

test('far-away STAR restrictions do not slow cruise traffic hundreds of miles early',()=>{
  const t=track([point('STAR',10,{}, {max:180})]);
  t.actualFlightLevel=350;t.clearedFlightLevel=350;
  const gs=convertIasToTas(speed(t),35000);
  assert(gs>400);
});

test('destination TMA handoff arms arrival, clears old restrictions and refuses unrelated TMAs/departures',()=>{
  const t=track();t.arrivalAirport=plan.at(-1);t.control={owner:'APGD',activeSector:'APGD',hasEnteredFir:true};
  const s=state(t);updateArrivalControl(s,t);assert(!t.arrivalManaged);
  t.control.owner='APWA';t.assignedSpeed={mode:'IAS',value:350};
  t.verticalRateAssigned=true;t.assignedVertical={value:0};t.procedureAltitudeOverride=true;
  updateArrivalControl(s,t);
  assert(t.arrivalManaged);assert.equal(t.clearedFlightLevel,30);assert(!t.procedureAltitudeOverride);
  assert.equal(t.assignedSpeed.value,null);assert(!t.verticalRateAssigned);assert.match(t.arrivalNote,/speed camera/);
  const dep=track();Object.assign(dep,{arrivalAirport:plan.at(-1),departure:'EPMO',isDeparture:true,
    control:{owner:'APWA',activeSector:'APWA',hasEnteredFir:true}});
  updateArrivalControl(state(dep),dep);assert(!dep.arrivalManaged);
  dep.leftDepartureTerminal=true;updateArrivalControl(state(dep),dep);assert(dep.arrivalManaged);
  const shared=state(t);shared.air.shared=true;shared.air.humanSectors=new Set(['APWA']);
  updateArrivalControl(shared,t);assert.equal(t.arrivalManaged,false);
});

test('approach cancels a subsequently accepted excessive speed in the final 15 NM',()=>{
  const t=managed(track([{name:'EPWA',lon:.1,lat:0}]));
  t.control={owner:'APWA',hasEnteredFir:true};t.assignedSpeed={mode:'IAS',value:330};
  updateArrivalControl(state(t),t);assert.equal(t.assignedSpeed.value,null);assert(speed(t)<=185);
});

test('progressive arrival respects the altitude window, then descends and disappears near the airport',()=>{
  const t=managed(track()),s=state(t);let elapsed=0,passedFirst=false,passedSecond=false;
  const startLevel=t.actualFlightLevel;
  while(s.air.tracks.length && elapsed<2400){
    const prior=t.flightPlan.nextIndex;
    updateTrackMovement(s,.5);elapsed+=.5;
    if(t.flightPlan.nextIndex>prior){
      if(prior===0){passedFirst=true;assert(t.actualFlightLevel>=119.9 && t.actualFlightLevel<=140.1,t.actualFlightLevel);}
      if(prior===1){passedSecond=true;assert(t.actualFlightLevel>=49.9,t.actualFlightLevel);}
    }
    if(elapsed===30){assert(t.actualFlightLevel<startLevel);assert(t.actualFlightLevel>140);}
    removeFinishedTraffic(s,.5);
  }
  assert(passedFirst&&passedSecond);assert.equal(s.air.tracks.length,0);
  assert(t.lon>.6 && t.lon<.72,`Removal position ${t.lon}`);
  assert(calculateAirSpeeds(t.groundSpeed,t.actualFlightLevel*100,t.heading).ias<190);
});

test('FL030 departures survive; outbound cleanup requires prior EPWW entry and 60 NM boundary distance',()=>{
  const boundary=createFirBoundary({features:[{properties:{name:'EPWW'},geometry:{type:'Polygon',
    coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}}]});
  const t=track();t.lon=-2;t.lat=.5;t.actualFlightLevel=30;
  const s=state(t);s.air.firBoundary=boundary;
  removeFinishedTraffic(s,1);assert.equal(s.air.tracks.length,1,'inbound aircraft outside FIR');
  t.lon=.5;removeFinishedTraffic(s,1);assert(t.hasBeenInsideFir);
  t.lon=1.99;removeFinishedTraffic(s,1);assert.equal(s.air.tracks.length,1);
  t.lon=.5;removeFinishedTraffic(s,1);assert.equal(s.air.tracks.length,1,'re-entry');
  t.lon=2.01;removeFinishedTraffic(s,1);assert.equal(s.air.tracks.length,0);
});

test('real multiplayer STAR shortcut preserves restrictions across wire snapshots',()=>{
  const room=new Room('PROC',data),host=room.add('T1');
  room.command(host.id,{type:'claim',sectorId:'acc-1'});
  const proc=findTerminalProcedure('EPWA','STAR','AGAVA'),points=procedureRoutePoints(proc);
  const t=createTrack({id:'arrival',callsign:'LOT111',aircraftType:'B738',departure:'EGLL',destination:'EPWA',
    ...points[0],actualFlightLevel:190,clearedFlightLevel:190,groundSpeed:300,
    heading:bearingToPoint(points[0],points[1]),flightPlan:{waypoints:points,nextIndex:1}});
  room.state.air.tracks.push(t);room.refresh();
  const destination=t.flightPlan.waypoints[5];
  // Use the normal server validation, including the unrounded wire coordinates.
  const wire=wireTrack(t),value=room.validate(t,'direct',{point:wire.flightPlan.waypoints[5],options:{planIndex:5}});
  room.apply(t,'direct',value,t.control.owner);
  assert.equal(t.directTo.target.name,destination.name);
  assert.equal(t.directTo.target.procedure.altitude.max,10000);
  const restored=wireTrack(t);
  assert.deepEqual(restored.directTo.target.procedure,t.directTo.target.procedure);
  const stream=new SnapshotStream(),a=createStateReceiver(),b=createStateReceiver();
  stream.capture(room);const full=stream.capture(room,true);a.accept(full);b.accept(full);
  t.control.owner='APWA';t.control.transfer=null;t.arrivalManaged=true;t.actualFlightLevel=30;
  removeFinishedTraffic(room.state,1);
  const delta=stream.capture(room);assert.deepEqual(delta.removed,['arrival']);
  a.accept(delta);b.accept(delta);assert.equal(a.tracks.size,0);assert.equal(b.tracks.size,0);
});

test('real EPWA arrival transfers to approach and is removed in both offline and shared simulations',()=>{
  const procedure=findTerminalProcedure('EPWA','STAR','AGAVA');
  const points=procedureRoutePoints(procedure),airport=data.navigationIndex.get('EPWA')[0];
  points.push(airport);
  const make=()=>{
    const t=createTrack({id:'real-arrival',callsign:'LOT222',aircraftType:'B738',departure:'EGLL',destination:'EPWA',
      ...points[0],actualFlightLevel:150,clearedFlightLevel:150,groundSpeed:convertIasToTas(250,15000),
      heading:bearingToPoint(points[0],points[1]),flightPlan:{waypoints:points,nextIndex:1}});
    t.arrivalAirport=airport;return t;
  };
  const room=new Room('REAL',data),shared=make(),offline=make();
  room.state.air.tracks.push(shared);room.refresh();
  const local={air:{tracks:[offline],airspaceIndex:data.airspaceIndex,controlledSector:'ALLFIR',firBoundary:data.catalogue.boundary},map:{}};
  let armedShared=false,armedOffline=false;
  for(let elapsed=0;elapsed<3600 && (room.state.air.tracks.length || local.air.tracks.length);elapsed+=5){
    room.step(5);advanceTraffic(local,5);
    if(offline.control?.owner==='ALLFIR' && !offline.control.transfer && nextTransferSector(offline)==='APWA')
      requestTransfer(offline,'transfer');
    armedShared ||= !!shared.arrivalManaged;armedOffline ||= !!offline.arrivalManaged;
  }
  assert(armedShared && armedOffline);
  assert.equal(room.state.air.tracks.length,0);assert.equal(local.air.tracks.length,0);
  assert(shared.actualFlightLevel<=30.05);assert(offline.actualFlightLevel<=30.05);
});

// Exercise every selected chart, including exact-altitude constraints and tight
// SID upper-then-lower restrictions, through actual gradual aircraft motion.
test('all 155 selected procedures meet published crossing limits in a B738 simulation',()=>{
const failures=[];let crossings=0;
for(const proc of TERMINAL_PROCEDURES){
 const airport=data.navigationIndex.get(proc.airport)[0],arrival=proc.type==='STAR',points=procedureRoutePoints(proc);
 const position=arrival?points[0]:airport,initial=arrival?Math.max(points[0].procedure.altitude.min/100||0,Math.min(190,points[0].procedure.altitude.max/100||190)):30;
 if(arrival)points.push(airport);
 const t=createTrack({id:proc.name,callsign:proc.name,aircraftType:'B738',...position,actualFlightLevel:initial,clearedFlightLevel:arrival?30:350,
  heading:bearingToPoint(position,points[arrival?1:0]),groundSpeed:convertIasToTas(arrival?220:180,initial*100),destination:arrival?proc.airport:'EGLL',flightPlan:{waypoints:points,nextIndex:arrival?1:0}});
 if(arrival){t.arrivalManaged=true;t.arrivalAirport=airport;}
 const s={air:{tracks:[t]},map:{}};let elapsed=0;
 while(elapsed<7200 && t.flightPlan.nextIndex<points.length && !(arrival && t.actualFlightLevel<=30.05)){
  const old=t.flightPlan.nextIndex;updateTrackMovement(s,.5);elapsed+=.5;
  if(t.flightPlan.nextIndex>old){const p=points[old].procedure;if(!p)continue;crossings++;
   const alt=t.actualFlightLevel*100,ias=calculateAirSpeeds(t.groundSpeed,alt,t.heading).ias;
   if(alt<(p.altitude.min||0)-50 || alt>(p.altitude.max??Infinity)+50)failures.push([proc.name,points[old].name,'alt',Math.round(alt),p.altitude]);
   if(ias<(p.speed.min||0)-2 || ias>Math.max(185,p.speed.max??Infinity)+2)failures.push([proc.name,points[old].name,'speed',Math.round(ias),p.speed]);
  }
 }
 if(elapsed>=7200)failures.push([proc.name,'timeout',t.flightPlan.nextIndex,t.actualFlightLevel]);
 if(arrival && t.actualFlightLevel<=30.05 && t.flightPlan.nextIndex<points.length-2)failures.push([proc.name,'early landing',t.flightPlan.nextIndex,points.length]);
}
assert(crossings>850);assert.deepEqual(failures,[]);

});
