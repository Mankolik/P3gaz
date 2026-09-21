import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createFirBoundary,findSpawnIndex} from '../src/radar/fir-boundary.js';
import {parseRouteCatalogue,tokenizeRoute,compileRouteCatalogue} from '../src/radar/route-catalogue.js';
import {createAircraftSpawner} from '../src/radar/spawner.js';
import {createAirwayResolver} from '../src/radar/airways.js';
import {createNavigationIndex,navigationTarget,bearingToPoint} from '../src/radar/routes.js';
import {createState} from '../src/core/state.js';
import {createBus} from '../src/core/bus.js';
import {updateTrackMovement} from '../src/radar/movement.js';
import {loadAircraftSpawner} from '../src/data/loader.js';
import {parseRouteAircraft,applyRouteAircraft} from '../src/radar/route-aircraft.js';
import {aircraftPerformance} from '../src/radar/performance.js';
import {convertIasToTas,convertMachToTas} from '../src/utils/speed.js';
import {greatCircleDistanceKm} from '../src/radar/route-metrics.js';
import {requestedCruiseLevel} from '../src/radar/cruise-level.js';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const json=p=>JSON.parse(read(p));
const geoNames=['pl_enr4_4_waypoints.geojson','WptsAbroad.geojson','airports_static.json','route-point-corrections.geojson'];
const nav=createNavigationIndex(geoNames.map(p=>json('assets/geojson/'+p)));
const resolver=createAirwayResolver(json('assets/navigation/pansa-airways.json'),nav);
const firData=json('assets/geojson/flightmap_europe_fir_uir.json');
const fir=createFirBoundary(firData);
const groups=parseRouteCatalogue(read('assets/sources/Airporty_revamped.txt'));
const pools=parseRouteAircraft(read('assets/sources/route-aircraft-types.txt'));
const catalogue=applyRouteAircraft(compileRouteCatalogue(groups,resolver,fir),pools);
const p=(name,lon,lat=5)=>({name,lon,lat});
const square=(holes=[])=>createFirBoundary({features:[{properties:{name:'EPWW'},geometry:{type:'Polygon',
  coordinates:[[[0,0],[10,0],[10,10],[0,10],[0,0]],...holes]}}]});
const state=()=>{const s=createState(createBus());s.map.project=(lon,lat)=>[lon*1000,-lat*1000];return s;};
const only=(departure,destination)=>({groups:[catalogue.groups.find(g=>g.departure===departure&&g.destination===destination)]});

test('source catalogue preserves all pairs, callsigns, aircraft variants and source levels',()=>{
  assert.equal(groups.length,184);
  assert.equal(groups.reduce((n,g)=>n+g.variants.length,0),251);
  assert.equal(groups[0].variants[0].aircraftType,'E295');
  assert.equal(groups[0].variants[0].sourceFlightLevel,220);
  assert(groups.some(g=>g.variants.some(v=>v.aircraftType===null)));
  assert.throws(()=>parseRouteCatalogue('EPWA - EPKK\n'),/Incomplete/);
});

test('route tokens accept level-only and speed/level annotations, adjacent fixes and missing final airport',()=>{
  const r=tokenizeRoute('EPWA SID OLILA/F340 MEBIV N133 OSLOG/N0400F120','EPWA','EPGD');
  assert.deepEqual(r.fixes,['EPWA','OLILA','MEBIV','OSLOG','EPGD']);
  assert.deepEqual(r.connectors,['SID','DCT','N133','STAR']);
  assert.equal(r.annotations.length,2);
  assert.throws(()=>tokenizeRoute('EPWA DCT','EPWA','EPGD'),/Missing/);
  assert.throws(()=>tokenizeRoute('EPWA DCT A/BAD STAR EPGD','EPWA','EPGD'),/annotation/);
});

test('supplied point corrections restore routes without bypassing missing points or entry rules',()=>{
  assert.equal(catalogue.validVariants,251);
  assert.equal(catalogue.groups.length,184);
  assert.deepEqual(catalogue.diagnostics.filter(d=>d.severity==='error'),[]);
  const elvot=resolver.resolvePoint('ELVOT');
  assert(Math.abs(elvot.lat-50.611666666666665)<1e-10);
  assert(Math.abs(elvot.lon-16.409166666666664)<1e-10);
  const restored=only('EPBY','EPWA').groups[0].variants[0];
  assert.equal(restored.waypoints[0].name,'EPBY');
  assert(restored.waypoints.some(p=>p.name==='ANHUR'));
  for(const [departure,destination,entry,exit] of [['EPKT','EGSS','SUBIX','SONUD'],['EPLL','EGSS','SUBIX','SONUD'],['EGSS','EPPO','SONUD','SUBIX']]){
    const v=only(departure,destination).groups[0].variants.find(v=>v.route.includes('IDOBA'));
    const names=v.waypoints.map(p=>p.name),i=names.indexOf('IDOBA');
    assert.deepEqual(names.slice(i-1,i+2),[entry,'IDOBA',exit]);
  }
  const corrected=only('LATI','ESSA').groups[0].variants[0].waypoints.map(p=>p.name);
  assert.equal(corrected.filter(n=>n==='KEROP').length,1);assert(!corrected.includes('BUG'));
  for(const [departure,destination] of [['EDDF','EETN'],['EDDF','EVRA'],['EDDF','EYVI'],['LFPG','EYVI']]){
    const v=only(departure,destination).groups[0].variants[0];
    assert(!v.route.split(/\s+/).includes('N858'));
    assert(v.waypoints.some(p=>p.name==='BOKSU'));
  }
  const unmodified=groups.find(g=>g.departure==='EGBB'&&g.destination==='EPBY');
  assert(unmodified.variants[0].route.includes('DENKO N858 DEKUT'));
  const magVariant=only('EGSS','EPLL').groups[0].variants[0];
  const magTokens=tokenizeRoute(magVariant.route,'EGSS','EPLL').fixes;
  const magIndex=magTokens.indexOf('MAG');
  const magSequence=['MAG','KISUC','BUROK','ESIKA','LULUL','SONUD','IDOBA','SUBIX'];
  assert.deepEqual(magTokens.slice(magIndex,magIndex+8),magSequence);
  const magRoute=magVariant.waypoints.map(p=>p.name);
  assert.deepEqual(magRoute.slice(magRoute.indexOf('MAG'),magRoute.indexOf('MAG')+8),magSequence);
  assert.deepEqual(magVariant.omittedPoints,[]);
  const okl=resolver.resolvePoint('OKL'),pam=resolver.resolvePoint('PAM');
  assert(Math.abs(okl.lat-50.09583055555556)<1e-10);
  assert(Math.abs(okl.lon-14.265555555555556)<1e-10);
  assert(Math.abs(pam.lat-52.33471944444444)<1e-10);
  assert(Math.abs(pam.lon-5.092222222222222)<1e-10);
  for(const destination of ['EETN','EYVI']){
    const g=only('LKPR',destination).groups[0];
    const t=createAircraftSpawner({groups:[g]},{random:()=>0}).spawn(state());
    assert.equal(t.onGround,false);assert.equal(t.spawnPoint,'LKPR');
    assert.equal(navigationTarget(t).name,'OKL');
  }
  assert(only('EGSS','EPBY').groups[0].variants[0].waypoints.some(p=>p.name==='PAM'));
});

test('boundary entry uses segments and selects two points before entry or a boundary fix',()=>{
  const b=square();
  const points=[p('GUNPA',-4),p('BIVKI',-3),p('SONAL',-2),p('BINKA',0),p('INSIDE',2)];
  assert.equal(findSpawnIndex(points,b).index,1);
  const crossing=[p('A',-4),p('B',-2),p('C',12)];
  const entry=b.firstEntry(crossing);
  assert.equal(entry.segmentIndex,1);
  assert.equal(findSpawnIndex(crossing,b).index,0);
  assert.throws(()=>findSpawnIndex([p('A',-1),p('B',2)],b),/two resolved/);
  assert.equal(b.firstEntry([p('A',-3,11),p('B',12,11)]),null);
});

test('boundary supports holes, multipolygons and ignores tangent touches',()=>{
  const b=square([[[3,3],[7,3],[7,7],[3,7],[3,3]]]);
  assert(!b.contains(p('HOLE',5)));
  assert(b.contains(p('INSIDE',1)));
  assert.equal(b.firstEntry([p('A',-1,1),p('B',1,-1)]),null);
  const multi=createFirBoundary({features:[{properties:{AV_AIRSPAC:'EPWWFIR'},geometry:{type:'MultiPolygon',coordinates:[[[[0,0],[2,0],[2,2],[0,2],[0,0]]],[[[5,5],[7,5],[7,7],[5,7],[5,5]]]]}}]});
  assert(multi.contains(p('ISLAND',6,6)));assert(!multi.contains(p('GAP',4,4)));
});

test('real KJFK arrival starts at BIVKI, with SONAL and BINKA ahead and expanded P150',()=>{
  const variant=only('KJFK','EPWA').groups[0].variants[0];
  assert.equal(variant.waypoints[variant.spawnIndex].name,'BIVKI');
  assert.deepEqual(variant.waypoints.slice(variant.spawnIndex,variant.spawnIndex+3).map(p=>p.name),['BIVKI','SONAL','BINKA']);
  assert(variant.waypoints.some(p=>p.name==='DIPKI'));
  const s=state(),t=createAircraftSpawner(only('KJFK','EPWA'),{random:()=>0}).spawn(s);
  assert.equal(t.status,'accepted');assert.equal(t.onGround,false);
  assert.equal(t.spawnPoint,'BIVKI');assert.equal(navigationTarget(t).name,'SONAL');
  assert.equal(t.actualFlightLevel,t.expectedCruiseLevel);
  assert.equal(t.actualFlightLevel,t.clearedFlightLevel);
  assert.equal(t.groundSpeed,convertMachToTas(aircraftPerformance(t.aircraftType).cruise.mach,t.actualFlightLevel*100));
  const before={lon:t.lon,lat:t.lat};updateTrackMovement(s,10);
  assert.notDeepEqual({lon:t.lon,lat:t.lat},before);assert.equal(t.actualFlightLevel,t.clearedFlightLevel);
});

test('foreign airway names are ignored, while EPWW published segments expand',()=>{
  const group=catalogue.groups.find(g=>g.departure==='EPKK'&&g.destination==='EGSS');
  assert(group);
  const v=group.variants[0];
  assert(v.waypoints.some(p=>p.name==='LASIS'));
  assert(v.waypoints.some(p=>p.name==='KOBUS'));
  assert(!v.waypoints.some(p=>/^[A-Z]\d+$/.test(p.name)));
  const local=only('EPKK','EPWA').groups[0].variants[0];
  const expanded=resolver.expandAirway('M985','POBOK','KOTEK').map(p=>p.name);
  assert(expanded.every(name=>local.waypoints.some(p=>p.name===name)));
});

test('missing local fixes are rejected, foreign prefix omissions never bridge the gap',()=>{
  const bad=[{departure:'EPWA',destination:'EPKK',callsigns:['TEST1'],variants:[{route:'EPWA DCT NONEXIST DCT EPKK',sourceLine:1}]}];
  const result=compileRouteCatalogue(bad,resolver,fir);
  assert.equal(result.groups.length,0);assert.equal(result.diagnostics[0].severity,'error');
  assert(catalogue.diagnostics.some(d=>d.severity==='notice'));
  assert(!catalogue.diagnostics.some(d=>d.severity==='error'));
});

test('cross-border airways use a unique published boundary endpoint; unknown local airways fail',()=>{
  const points=[p('WEST',0),p('MID',5),p('EAST',10),p('OUTX',15),p('EXT',12),p('EPSA',4)];
  const index=new Map(points.map(point=>[point.name,[point]]));
  const dataset={schemaVersion:1,points:Object.fromEntries(points.slice(0,3).map(p=>[p.name,p])),airways:{A1:{
    waypoints:['WEST','MID','EAST'],legs:[{from:'WEST',to:'MID',status:'published',directions:['forward','reverse']},
      {from:'MID',to:'EAST',status:'published',directions:['forward','reverse']}]}}};
  const localResolver=createAirwayResolver(dataset,index);
  const group={departure:'OUTX',destination:'EPSA',callsigns:['TEST1'],variants:[{route:'OUTX DCT EXT A1 MID DCT EPSA',sourceLine:1}]};
  const cat=compileRouteCatalogue([group],localResolver,square());
  assert.equal(cat.validVariants,1);
  assert.deepEqual(cat.groups[0].variants[0].waypoints.map(p=>p.name),['OUTX','EXT','EAST','MID','EPSA']);
  group.variants[0].route='OUTX DCT EXT A9 MID DCT EPSA';
  assert.equal(compileRouteCatalogue([group],localResolver,square()).validVariants,0);
});

test('foreign airway tolerance cannot discard a route through the FIR interior',()=>{
  const b=square();
  assert(b.foreignLeg(p('A',-2),p('B',-1)));
  assert(!b.foreignLeg(p('A',-2),p('B',12)));
  assert(b.foreignLeg(p('EDGE',0),p('B',-1)));
  assert(!b.foreignLeg(p('EDGE',0),p('B',11)));
});

test('every eligible airborne variant spawns outside with two prior points and an onward leg',()=>{
  assert(catalogue.validVariants>=200);
  for(const g of catalogue.groups)for(const v of g.variants){
    const s=state(),t=createAircraftSpawner({groups:[{...g,variants:[v]}]},{random:()=>0.4}).spawn(s);
    assert.equal(t.status,'accepted');assert.equal(t.flightPlan.nextIndex,v.spawnIndex+1);
    assert(navigationTarget(t));assert(Number.isFinite(t.x)&&Number.isFinite(t.y));
    if(!v.groundStart){
      assert(!fir.contains(t),`${g.departure}-${g.destination}`);
      assert(v.waypoints.length-v.spawnIndex>=3);
      assert.equal(findSpawnIndex(v.waypoints,fir).index,v.spawnIndex);
    }
  }
});

test('airport departures start at FL010 / IAS180 and adopt type speed while holding their clearance',()=>{
  for(const departure of ['EPWA','EPKK','EYVI','LKPR','EDDB']){
    const g=catalogue.groups.find(g=>g.departure===departure);
    assert(g,departure);
    const s=state(),t=createAircraftSpawner({groups:[g]},{random:()=>0}).spawn(s);
    assert.equal(t.onGround,false);assert.equal(t.spawnPoint,departure);
    assert.equal(t.actualFlightLevel,10);assert.equal(t.clearedFlightLevel,10);assert.equal(t.groundSpeed,convertIasToTas(180,1000));
    assert.equal(t.assignedSpeed.value,null);
    const location=[t.lon,t.lat];updateTrackMovement(s,60);
    assert.notDeepEqual([t.lon,t.lat],location);assert.equal(t.actualFlightLevel,10);
    const profile=aircraftPerformance(t.aircraftType);
    assert.equal(t.groundSpeed,convertIasToTas(Math.max(profile.initialClimb.speed.value,profile.minimumCleanSpeedKnots-25),1000));
    t.clearedFlightLevel=100;updateTrackMovement(s,10);
    assert(t.actualFlightLevel>10);
  }
});

test('selection draws pair then callsign then variant then operator type independently',()=>{
  const g=only('KJFK','EPWA').groups[0],other=only('EPWA','EPKK').groups[0];
  const rolls=[0.75,0.75,0.9,0,0.5],s=state();
  const spawner=createAircraftSpawner({groups:[g,{...other,callsigns:['LOT1','LOT2']}]},{random:()=>rolls.shift()});
  const t=spawner.spawn(s);
  assert.equal(t.departure,'EPWA');assert.equal(t.callsign,'LOT2');assert.equal(t.aircraftType,'E170');
  assert.equal(t.sourceRoute.sourceLine,other.variants[2].sourceLine);
  assert.equal(rolls.length,0);
});

test('duplicate callsigns and ids are avoided, exhaustion makes no partial track',()=>{
  const g=only('KJFK','EPWA').groups[0],s=state();s.air.tracks.push({id:'spawn-1',callsign:'OTHER'});
  const spawner=createAircraftSpawner({groups:[g]},{random:()=>0});
  const t=spawner.spawn(s);assert.equal(t.id,'spawn-2');
  assert.throws(()=>spawner.spawn(s),/already in use/);assert.equal(s.air.tracks.length,2);
});

test('heading follows the onward spawn leg and metadata preserves original route levels',()=>{
  const s=state(),g=only('EPWA','EPKK').groups[0];
  const t=createAircraftSpawner({groups:[g]},{random:()=>0}).spawn(s);
  assert(Math.abs(t.heading-bearingToPoint(t,navigationTarget(t)))<1e-9);
  assert.equal(t.sourceRoute.sourceFlightLevel,220);assert.equal(t.exitFlightLevel,null);
  assert.equal(t.expectedCruiseLevel,180);
});

test('startup loads the source catalogue and fails clearly if navigation or routes are unavailable',async t=>{
  t.mock.method(globalThis,'fetch',async url=>({ok:true,text:async()=>read('assets/sources/'+String(url).split('/').at(-1))}));
  const spawner=await loadAircraftSpawner(resolver,firData);assert(spawner.catalogue.groups.length>100);
  await assert.rejects(()=>loadAircraftSpawner(null,firData),/Navigation/);
  t.mock.method(globalThis,'fetch',async()=>({ok:false}));
  await assert.rejects(()=>loadAircraftSpawner(resolver,firData),/Failed to load/);
});

test('all 184 directional routes and 290 operator pools exactly cover catalogue callsigns',()=>{
  assert.equal(pools.size,184);
  assert.equal([...pools.values()].reduce((n,ops)=>n+Object.keys(ops).length,0),290);
  for(const g of groups){
    const ops=pools.get(`${g.departure}-${g.destination}`);
    assert.deepEqual(Object.keys(ops).sort(),[...new Set(g.callsigns.map(c=>c.slice(0,3)))].sort());
  }
  assert.deepEqual(pools.get('EPWA-LFPG').TAY,['B734','B738']);
  assert.equal(pools.get('LFPG-EPWA').TAY,undefined);
  assert.deepEqual(pools.get('EYVI-LTAI').CAI,['B738','B38M']);
  assert.equal(pools.get('LTAI-EYVI').CAI,undefined);
});

test('every supplied aircraft type can spawn for its operator regardless of route type or level',()=>{
  for(const g of catalogue.groups)for(const [operator,types] of Object.entries(g.aircraftTypesByOperator)){
    const callsign=g.callsigns.find(c=>c.startsWith(operator));
    for(const [index,type] of types.entries()){
      const variant={...g.variants[0],aircraftType:'ZZZZ',sourceFlightLevel:999};
      const rolls=[0,0,0,(index+0.5)/types.length,0.5];
      const t=createAircraftSpawner({groups:[{...g,callsigns:[callsign],variants:[variant]}]},{random:()=>rolls.shift()}).spawn(state());
      assert.equal(t.aircraftType,type,`${g.departure}-${g.destination} / ${operator}`);
      assert.equal(t.sourceRoute.operator,operator);
      assert.equal(t.sourceRoute.aircraftTypeSource,'route-operator-pool');
      assert.equal(t.wake,/^(B74|B77|B78|A33|A34|A35|A38)/.test(type)?'H':'M');
      assert.notEqual(t.expectedCruiseLevel,999);
      assert.equal(rolls.length,0);
    }
  }
});

test('invalid or missing aircraft pools fail without defaulting to source types',async t=>{
  for(const input of ['', 'EPWA-EPKK', 'LOT E170', 'EPWA-EPKK\nLOT',
    'EPWA-EPKK\nLOT E170\nLOT E195','EPWA-EPKK\nLOT E170\nEPWA-EPKK\nLOT E195'])
    assert.throws(()=>parseRouteAircraft(input));
  const g=only('EPWA','EPKK').groups[0];
  assert.throws(()=>applyRouteAircraft({groups:[g]},new Map()),/Missing aircraft pool/);
  assert.throws(()=>createAircraftSpawner({groups:[{...g,aircraftTypesByOperator:{}}]}),/aircraft pool/);
  t.mock.method(globalThis,'fetch',async url=>({ok:!String(url).endsWith('route-aircraft-types.txt'),text:async()=>read('assets/sources/Airporty_revamped.txt')}));
  await assert.rejects(()=>loadAircraftSpawner(resolver,firData),/Failed to load the route aircraft pools/);
});

test('compilation measures each directional airport pair once; all later spawns and ticks reuse it',()=>{
  let calculations=0;
  const compiled=applyRouteAircraft(compileRouteCatalogue(groups,resolver,fir,{measureDistance:(a,b)=>{
    calculations++;return greatCircleDistanceKm(a,b);
  }}),pools);
  assert.equal(calculations,184);
  for(const g of compiled.groups){
    assert(g.routeDistanceKm>0);assert(g.generalTrack>=0&&g.generalTrack<360);
    for(const v of g.variants){
      const s=state();createAircraftSpawner({groups:[{...g,variants:[v]}]},{random:()=>0.5}).spawn(s);
      updateTrackMovement(s,3);
    }
  }
  assert.equal(calculations,184);
  const warsawKrakow=compiled.groups.find(g=>g.departure==='EPWA'&&g.destination==='EPKK');
  assert(warsawKrakow.routeDistanceKm>240&&warsawKrakow.routeDistanceKm<250);
});

test('legacy aircraft/level annotations do not influence ECL, type or empty initial XFL',()=>{
  const g=only('EPWA','EPKK').groups[0];
  const mutated={...g,variants:g.variants.map(v=>({...v,aircraftType:'B77W',sourceFlightLevel:450,annotations:['N0500F450']}))};
  const a=createAircraftSpawner({groups:[g]},{random:()=>0.5}).spawn(state());
  const b=createAircraftSpawner({groups:[mutated]},{random:()=>0.5}).spawn(state());
  for(const key of ['aircraftType','actualFlightLevel','clearedFlightLevel','exitFlightLevel','expectedCruiseLevel'])assert.equal(a[key],b[key]);
  assert.equal(a.expectedCruiseLevel,requestedCruiseLevel(g,aircraftPerformance(a.aircraftType),()=>0.5));
  assert.equal(a.exitFlightLevel,null);
  assert.notEqual(a.expectedCruiseLevel,a.exitFlightLevel);
});

test('ECL uses airport general track and changes independently of initial XFL and spawn altitude',()=>{
  const g=only('EPWA','EPKK').groups[0];
  const spawn=(generalTrack,lastRoll)=>{
    const rolls=[0,0,0,0,lastRoll];
    return createAircraftSpawner({groups:[{...g,generalTrack}]},{random:()=>rolls.shift()}).spawn(state());
  };
  const west=spawn(270,0.5),east=spawn(90,0.5),higher=spawn(90,1);
  assert.equal(west.expectedCruiseLevel,200);assert.equal(east.expectedCruiseLevel,210);assert.equal(higher.expectedCruiseLevel,230);
  for(const t of [west,east,higher]){
    assert.equal(t.exitFlightLevel,null);assert.equal(t.actualFlightLevel,10);assert.equal(t.clearedFlightLevel,10);
  }
});

test('all arrivals and overflights spawn at calculated ECL; departures retain FL010',()=>{
  let airborne=0,departures=0;
  for(const group of catalogue.groups)for(const variant of group.variants){
    const t=createAircraftSpawner({groups:[{...group,variants:[variant]}]},{random:()=>0.5}).spawn(state());
    const expected=variant.groundStart?10:t.expectedCruiseLevel;
    assert.equal(t.actualFlightLevel,expected);assert.equal(t.clearedFlightLevel,expected);
    assert.equal(t.plannedEntryLevel,t.expectedCruiseLevel);assert.equal(t.exitFlightLevel,null);
    if(variant.groundStart)departures++;else airborne++;
  }
  assert(airborne>0&&departures>0);
});
