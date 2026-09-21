import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createSectorIndex} from '../src/radar/sectors.js';
import {createAirspaceIndex,airspaceAt,TMA_DESIGNATORS} from '../src/radar/airspace.js';
import {buildTrajectory,trajectoryRoute} from '../src/radar/trajectory.js';
import {routeDisplayPoints} from '../src/render/route-display.js';
import {setFlightPlan,assignHeading,assignDirectTo} from '../src/radar/routes.js';
import {updateTrafficControl,advanceTraffic,statusForSector} from '../src/radar/traffic-control.js';
import {issueInstruction} from '../src/radar/coordination.js';

const ring=(a,b)=>[[a,-1],[b,-1],[b,1],[a,1],[a,-1]];
const feature=(properties,a,b)=>({type:'Feature',properties,geometry:{type:'Polygon',coordinates:[ring(a,b)]}});
const collection=features=>({type:'FeatureCollection',features});
const acc=(a=0,b=4)=>feature({sector:'TEST',vertical:'LOW',min_fl:95,max_fl:660},a,b);
const tma=(icao,a,b,min=0,max=200)=>feature({icao,tma:icao,sector:'A',vertical_bands:[{
  floor:{value:min,unit:'FL',ref:'STD'},ceiling:{value:max,unit:'FL',ref:'STD'}}]},a,b);
const fir=(code,a,b)=>feature({AV_AIRSPAC:code,MIN_FLIGHT:0,MAX_FLIGHT:999},a,b);
const index=(tmas=[])=>createAirspaceIndex(createSectorIndex([collection([acc(),...tmas])]),
  collection([fir('EPWWFIR',0,4),fir('EDUUUIR',-5,0),fir('ESAAFIR',4,8)]));
const track=(lon=-1,level=350)=>{
  const t={id:'TEST',callsign:'TEST',aircraftType:'A320',lon,lat:0,heading:90,groundSpeed:450,
    actualFlightLevel:level,clearedFlightLevel:level,plannedEntryLevel:level,exitFlightLevel:null,expectedCruiseLevel:380};
  setFlightPlan(t,[{name:'END',lon:6,lat:0}]);return t;
};
const state=(t,i=index())=>({air:{tracks:[t],airspaceIndex:i,controlledSector:'ALLFIR'}});
const sectors=t=>t.sequence.map(v=>v.sector);
const read=path=>JSON.parse(fs.readFileSync(new URL('../'+path,import.meta.url)));

test('all supplied airspaces map to requested groups; foreign suffixes collapse to three letters',()=>{
  const manifest=read('assets/manifest.json');
  const collections=manifest.geojson.filter(e=>['SECTOR_LOW','SECTOR_HIGH','TMA'].includes(e.layer)).map(e=>read(e.path.replace(/^\.\//,'')));
  const i=createAirspaceIndex(createSectorIndex(collections),read('assets/geojson/flightmap_europe_fir_uir.json'));
  assert.equal(i.complete,true);
  for(const v of i.volumes)assert.equal(v.designator,v.kind==='ACC'?'ALLFIR':TMA_DESIGNATORS[v.icao]);
  assert.equal(TMA_DESIGNATORS.EPBY,'TBY');assert.equal(TMA_DESIGNATORS.EPZG,'APPO');assert.equal(TMA_DESIGNATORS.EPRA,'APWA');
  assert(i.firs.some(v=>v.id==='EDUUUIR' && v.designator==='EDU'));
  assert(i.firs.some(v=>v.id==='ESAAFIR' && v.designator==='ESA'));
});

test('TMA priority, exact floors/ceilings and EPWW-only FIS classification',()=>{
  const i=index([tma('EPWA',0,1,25,200)]),p={lon:0.5,lat:0};
  assert.equal(airspaceAt(i,p,10),'FIS');assert.equal(airspaceAt(i,p,25),'APWA');
  assert.equal(airspaceAt(i,p,199.99),'APWA');assert.equal(airspaceAt(i,p,200),'ALLFIR');
  assert.equal(airspaceAt(i,{lon:2,lat:0},94.99),'FIS');assert.equal(airspaceAt(i,{lon:2,lat:0},95),'ALLFIR');
  assert.equal(airspaceAt(i,{lon:-1,lat:0},10),'EDU');
});

test('overflight changes to XFL only after entering ALLFIR; actual CFL is untouched',()=>{
  const t=track();t.exitFlightLevel=370;const prediction=buildTrajectory(t,index());
  assert(prediction.complete);assert.deepEqual(sectors(prediction),['EDU','ALLFIR','ESA']);
  assert.equal(prediction.sequence[1].entry.level,350);
  assert.equal(prediction.sequence[2].entry.level,370);
  assert.equal(t.clearedFlightLevel,350);assert.equal(t.actualFlightLevel,350);
  t.exitFlightLevel=300;const down=buildTrajectory(t,index());
  assert.equal(down.sequence[1].entry.level,350);assert.equal(down.sequence[2].entry.level,300);
});

test('departures climb through a TMA top, respect PEL and XFL, then resume toward ECL',()=>{
  const t=track(0.1,10);t.isDeparture=true;t.plannedEntryLevel=220;t.exitFlightLevel=250;
  const prediction=buildTrajectory(t,index([tma('EPWA',0,2)]));
  assert(prediction.complete);assert.deepEqual(sectors(prediction),['APWA','ALLFIR','ESA']);
  assert(Math.abs(prediction.sequence[1].entry.level-200)<1e-5);
  assert(prediction.sequence[1].entry.lon<2,'leaves TMA vertically before horizontal edge');
  assert.equal(prediction.sequence[2].entry.level,250);assert.equal(prediction.points.at(-1).level,380);
  t.sectorExitLevels={ESA:280};assert.equal(buildTrajectory(t,index([tma('EPWA',0,1)])).points.at(-1).level,280);
  t.exitFlightLevel=null;assert.equal(buildTrajectory(t,index()).sequence.find(v=>v.sector==='ESA').entry.level,380);
});

test('lower PEL keeps departure below TMA top until horizontal exit; same-group volumes do not transfer',()=>{
  const t=track(0.1,10);t.isDeparture=true;t.plannedEntryLevel=150;t.exitFlightLevel=300;
  const prediction=buildTrajectory(t,index([tma('EPWA',0,0.5),tma('EPRA',0.5,1)]));
  assert.deepEqual(sectors(prediction),['APWA','ALLFIR','ESA']);
  assert.equal(prediction.sequence[1].entry.level,150);assert(Math.abs(prediction.sequence[1].entry.lon-1)<1e-6);
});

test('polygon holes, narrow sectors and return visits remain in the sequence',()=>{
  const i=index();i.epww[0].polygons[0].rings.push(ring(1.5,1.51));
  const extra=createAirspaceIndex(createSectorIndex([collection([acc()])]),collection([fir('EPWWFIR',0,4),fir('ESAAFIR',1.5,1.51)]));
  i.firs.push(extra.firs[1]);
  const prediction=buildTrajectory(track(),i);
  assert.deepEqual(sectors(prediction),['EDU','ALLFIR','ESA','ALLFIR','ESA']);
  assert(prediction.sequence[2].exit.distanceNm-prediction.sequence[2].entry.distanceNm<1);
});

test('automatic transfers use along-route distance and give different sector-relative labels',()=>{
  const t=track(),s=state(t);updateTrafficControl(s);assert.equal(t.status,'inbound');
  t.lon=-0.1;updateTrafficControl(s);assert.equal(t.status,'accepted');assert.equal(t.control.physical,'EDU');
  t.lon=0.1;updateTrafficControl(s);assert.equal(t.status,'accepted');
  t.lon=3.9;updateTrafficControl(s,4);assert.equal(t.status,'intruder');assert.equal(t.control.owner,'ESA');
  assert.equal(statusForSector(t,'ESA'),'accepted');
  t.lon=4.1;updateTrafficControl(s);assert.equal(t.status,'unconcerned');
  setFlightPlan(t,[{name:'BACK',lon:2,lat:0}]);updateTrafficControl(s);
  assert.equal(t.status,'accepted','return within ten miles can be accepted again');
});

test('PEL is a three-second proposal; approval coordinates previous XFL and computer CFL',()=>{
  const t=track(-2),s=state(t);updateTrafficControl(s);
  issueInstruction(t,'plannedEntryLevel',300);
  assert.equal(t.plannedEntryLevel,350);assert.equal(t.clearedFlightLevel,350);
  advanceTraffic(s,2.9);assert.equal(t.clearedFlightLevel,350);
  advanceTraffic(s,0.1);assert.equal(t.plannedEntryLevel,300);assert.equal(t.clearedFlightLevel,300);
  assert.equal(t.sectorExitLevels.EDU,300);assert.equal(t.control.pending.plannedEntryLevel,undefined);
  advanceTraffic(s,5);assert(t.actualFlightLevel<350);
});

test('new proposals restart the timer, inbound CFL is inaccessible, and XFL is immediate',()=>{
  const t=track(-2),s=state(t);updateTrafficControl(s);
  assert.equal(issueInstruction(t,'clearedFlightLevel',200),false);assert.equal(t.clearedFlightLevel,350);
  issueInstruction(t,'exitFlightLevel',370);assert.equal(t.exitFlightLevel,370);
  issueInstruction(t,'plannedEntryLevel',300);advanceTraffic(s,2);
  issueInstruction(t,'plannedEntryLevel',320);advanceTraffic(s,2);assert.equal(t.plannedEntryLevel,350);
  advanceTraffic(s,1);assert.equal(t.plannedEntryLevel,320);
});

test('heading, speed, rate and shortcuts wait; stale shortcuts and ownership changes cancel safely',()=>{
  const t=track(-2),s=state(t);updateTrafficControl(s);
  issueInstruction(t,'speed',{mode:'Mach',value:0.76});issueInstruction(t,'vertical',{value:-1800,comparator:'exact'});
  issueInstruction(t,'heading',180);assert.equal(t.navigationMode,'route');assert.equal(t.assignedSpeed,undefined);
  advanceTraffic(s,3);assert.equal(t.assignedHeading,180);assert.equal(t.assignedSpeed.value,0.76);assert.equal(t.assignedVertical.value,-1800);
  const point={name:'NEW',lon:3,lat:0};issueInstruction(t,'direct',{point});assert.equal(t.navigationMode,'heading');
  advanceTraffic(s,3);assert.equal(t.navigationMode,'direct');assert.equal(t.directTo.target.name,'NEW');
  issueInstruction(t,'speed',{mode:'Mach',value:0.78});t.lon=-0.01;
  setFlightPlan(t,[{name:'END',lon:6,lat:0}]);updateTrafficControl(s);
  assert.equal(t.control.pending.speed,undefined);assert.equal(t.assignedSpeed.value,0.76);
});

test('trajectory cache is reused for idle ticks and invalidated by route, PEL or XFL',()=>{
  const t=track(-2),s=state(t);updateTrafficControl(s);const first=t.trajectory;
  updateTrafficControl(s,0.1);assert.equal(t.trajectory,first);
  issueInstruction(t,'exitFlightLevel',370);updateTrafficControl(s);assert.notEqual(t.trajectory,first);
  const second=t.trajectory;assignDirectTo(t,{name:'WEST',lon:-4,lat:0});updateTrafficControl(s);
  assert.notEqual(t.trajectory,second);assert.equal(t.status,'unconcerned');
  assignHeading(t,90);updateTrafficControl(s);const filed=t.trajectory;updateTrafficControl(s,0.1);assert.equal(t.trajectory,filed);
});

test('assigned, held and actual headings do not replace the drawn route or alter its sector prediction',()=>{
  const t=track(-2),s=state(t);t.exitFlightLevel=370;updateTrafficControl(s);
  const original=t.trajectory;
  assert.deepEqual(sectors(original),['EDU','ALLFIR','ESA']);
  for(const heading of [270,180,0,null]){
    assignHeading(t,heading);t.heading=heading ?? 45;
    updateTrafficControl(s,0.1);
    assert.equal(t.trajectory,original,'heading alone does not invalidate the route prediction');
    assert.deepEqual(buildTrajectory(t,s.air.airspaceIndex),original);
    assert.deepEqual(trajectoryRoute(t),routeDisplayPoints(t));
  }
  // Editing route geometry on a heading must still invalidate the prediction.
  t.flightPlan.waypoints=[{name:'WEST',lon:-4,lat:0}];updateTrafficControl(s);
  assert.notEqual(t.trajectory,original);assert.deepEqual(sectors(t.trajectory),['EDU']);
});

test('prediction follows drawn direct/rejoin/end-here paths and never invents a heading path for an empty route',()=>{
  const t=track(-2),i=index();
  setFlightPlan(t,[{name:'MIDDLE',lon:2,lat:0},{name:'END',lon:6,lat:0}]);
  assignDirectTo(t,{name:'WEST',lon:-4,lat:0},{rejoinIndex:1});
  assert.deepEqual(trajectoryRoute(t),routeDisplayPoints(t));
  assert.deepEqual(trajectoryRoute(t).map(p=>p.name),['WEST','END']);
  assert.deepEqual(sectors(buildTrajectory(t,i)),['EDU','ALLFIR','ESA']);
  assignDirectTo(t,{name:'WEST',lon:-4,lat:0});
  assert.deepEqual(trajectoryRoute(t),routeDisplayPoints(t));
  assert.deepEqual(sectors(buildTrajectory(t,i)),['EDU']);
  t.flightPlan=null;assignHeading(t,90);
  assert.deepEqual(trajectoryRoute(t),[]);
  const stationary=buildTrajectory(t,i);
  assert.deepEqual(sectors(stationary),['EDU']);assert.equal(stationary.points.length,1);
});

test('prediction stops where the drawn route stops at missing geometry',()=>{
  const t=track(-2);
  t.flightPlan.waypoints=[{name:'VALID',lon:-1,lat:0},{name:'MISSING',lon:NaN,lat:0},{name:'END',lon:6,lat:0}];
  assert.deepEqual(trajectoryRoute(t),routeDisplayPoints(t));
  assert.deepEqual(trajectoryRoute(t).map(p=>p.name),['VALID']);
  assert.deepEqual(sectors(buildTrajectory(t,index())),['EDU']);
});

test('a departure PEL coordinates its last TMA before ALLFIR, even while still in FIS',()=>{
  const t=track(0.1,10);t.isDeparture=true;t.plannedEntryLevel=350;
  const s=state(t,index([tma('EPWA',0,2,25,200)]));updateTrafficControl(s);
  assert.equal(t.status,'preinbound');assert.equal(t.control.physical,'FIS');
  issueInstruction(t,'plannedEntryLevel',180);updateTrafficControl(s,3);
  assert.equal(t.sectorExitLevels.APWA,180);assert.equal(t.clearedFlightLevel,180);
  issueInstruction(t,'plannedEntryLevel',null);updateTrafficControl(s,3);
  assert.equal(t.sectorExitLevels.APWA,null);assert.equal(t.clearedFlightLevel,380);
});

test('an obsolete shortcut proposal cannot be applied to a replacement flight plan',()=>{
  const t=track(-2),s=state(t);updateTrafficControl(s);
  issueInstruction(t,'direct',{point:{name:'END',lon:6,lat:0},options:{planIndex:0}});
  setFlightPlan(t,[{name:'NEW',lon:-4,lat:0}]);updateTrafficControl(s,3);
  assert.equal(t.control.pending.navigation,undefined);assert.equal(t.directTo,null);
  assert.equal(t.flightPlan.waypoints[0].name,'NEW');
});

test('rerouting away from an imminent exit cancels that transfer; short visits do not bounce ownership',()=>{
  const t=track(3.9),s=state(t);updateTrafficControl(s);
  assert.equal(t.status,'accepted');updateTrafficControl(s,3);assert.equal(t.status,'intruder');
  setFlightPlan(t,[{name:'STAY',lon:2,lat:0}]);updateTrafficControl(s);assert.equal(t.status,'accepted');
  const shortIndex=index();shortIndex.epww[0].polygons[0].rings=[ring(0,0.1)];
  const fast=track(-0.01),ss=state(fast,shortIndex);updateTrafficControl(ss);assert.equal(fast.status,'accepted');
  fast.lon=0.01;updateTrafficControl(ss);assert.equal(fast.status,'accepted');
  updateTrafficControl(ss,1);assert.equal(fast.status,'accepted');
});

test('descent through a TMA roof or FIS ceiling continues to the coordinated level without boundary oscillation',()=>{
  for(const [i,xfl,receiving] of [[index([tma('EPWA',0,3)]),150,'APWA'],[index(),70,'FIS']]){
    const t=track(0.1,250);t.exitFlightLevel=xfl;t.clearedFlightLevel=xfl;
    const s=state(t,i);updateTrafficControl(s);
    assert(t.trajectory.complete);assert.equal(t.trajectory.sequence[1].sector,receiving);
    assert.equal(t.trajectory.sequence[1].targetLevel,xfl);
    advanceTraffic(s,600);
    assert.equal(t.control.physical,receiving);assert.equal(t.clearedFlightLevel,xfl);assert.equal(t.actualFlightLevel,xfl);
    assert(t.trajectory.complete);
  }
});
