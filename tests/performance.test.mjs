import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {AIRCRAFT_PERFORMANCE} from '../src/data/aircraft-performance.js';
import {parseAircraftPerformance} from '../scripts/import-aircraft-performance.mjs';
import {parseRouteAircraft} from '../src/radar/route-aircraft.js';
import {aircraftPerformance,performanceSchedule} from '../src/radar/performance.js';
import {requestedVerticalRate} from '../src/radar/vertical-rate.js';
import {updateTrackMovement} from '../src/radar/movement.js';
import {convertIasToTas,convertMachToTas} from '../src/utils/speed.js';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const track=(aircraftType='A320',level=10,target=level)=>({aircraftType,lon:20,lat:52,heading:90,
  actualFlightLevel:level,clearedFlightLevel:target,verticalSpeed:0,groundSpeed:convertIasToTas(180,level*100),
  assignedSpeed:{mode:'IAS',value:null}});
const advance=(t,seconds)=>updateTrackMovement({air:{tracks:[t]}},seconds);
const close=(actual,expected,tolerance=1e-8)=>assert(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);

test('generated table preserves every supplied field and covers every operator aircraft type',()=>{
  assert.deepEqual(AIRCRAFT_PERFORMANCE,parseAircraftPerformance(read('assets/sources/aircraft-performance.txt')));
  const pools=parseRouteAircraft(read('assets/sources/route-aircraft-types.txt'));
  const types=[...new Set([...pools.values()].flatMap(ops=>Object.values(ops).flat()))].sort();
  assert.equal(types.length,23);assert.deepEqual(Object.keys(AIRCRAFT_PERFORMANCE).sort(),types);
  assert.equal(aircraftPerformance('A319').ceilingFL,390);
  assert.equal(aircraftPerformance('B734').cruise.mach,0.74);
  assert.equal(aircraftPerformance('E195').minimumCleanSpeedKnots,210);
  assert.equal(aircraftPerformance('B788').initialDescent.rateFpm,2600);
  assert.equal(aircraftPerformance('B77L').rangeNm,9380);
});

test('phase boundaries select initial, IAS and Mach climb, cruise, descent and approach',()=>{
  for(const type of Object.keys(AIRCRAFT_PERFORMANCE)){
    const profile=aircraftPerformance(type);
    for(const [level,phase] of [[10,'initialClimb'],[49.99,'initialClimb'],[50,'climb150'],[149.99,'climb150'],
      [150,'climb240'],[239.99,'climb240'],[240,'machClimb'],[350,'machClimb']]){
      const result=performanceSchedule(track(type,level,profile.ceilingFL));
      assert.equal(result.phase,phase);assert.deepEqual(result.speed,profile[phase].speed);assert.equal(result.rateFpm,profile[phase].rateFpm);
    }
    for(const [level,phase] of [[350,'initialDescent'],[240.01,'initialDescent'],[240,'descent100'],[100.01,'descent100'],[100,'approach'],[30,'approach']]){
      const result=performanceSchedule(track(type,level,0));
      assert.equal(result.phase,phase);assert.deepEqual(result.speed,profile[phase].speed);assert.equal(result.rateFpm,profile[phase].rateFpm);
    }
    const cruise=performanceSchedule(track(type,350,350));
    assert.deepEqual(cruise,{phase:'cruise',speed:{mode:'Mach',value:profile.cruise.mach},rateFpm:0});
  }
});

test('unassigned departure IAS converges to the type target without becoming a manual command',()=>{
  for(const type of Object.keys(AIRCRAFT_PERFORMANCE)){
    const t=track(type);advance(t,15);
    close(t.groundSpeed,convertIasToTas(aircraftPerformance(type).initialClimb.speed.value,1000));
    assert.equal(t.assignedSpeed.value,null);assert.equal(t.actualFlightLevel,10);assert.equal(t.verticalSpeed,0);
  }
});

test('every type actually climbs and descends at its supplied phase rates',()=>{
  for(const type of Object.keys(AIRCRAFT_PERFORMANCE))for(const [level,target,phase,sign] of [
    [10,100,'initialClimb',1],[70,200,'climb150',1],[180,300,'climb240',1],[300,350,'machClimb',1],
    [350,200,'initialDescent',-1],[180,80,'descent100',-1],[80,10,'approach',-1]]){
    const t=track(type,level,target);advance(t,75);
    assert.equal(t.verticalSpeed,sign*aircraftPerformance(type)[phase].rateFpm,`${type} ${phase}`);
    assert(sign*(t.actualFlightLevel-level)>0);
  }
});

test('profile changes at altitude boundaries and reaches a clearance without overshoot',()=>{
  const t=track('A320',49.9,155);t.verticalSpeed=2500;advance(t,2);
  assert.equal(t.performancePhase,'climb150');
  advance(t,360);assert.equal(t.actualFlightLevel,155);assert.equal(t.verticalSpeed,0);
  t.clearedFlightLevel=250;advance(t,700);
  assert.equal(t.actualFlightLevel,250);assert.equal(t.performancePhase,'cruise');
  close(t.groundSpeed,convertMachToTas(0.79,25000));
  t.clearedFlightLevel=95;advance(t,800);
  assert.equal(t.actualFlightLevel,95);assert.equal(t.verticalSpeed,0);assert.equal(t.performancePhase,'approach');
  close(t.groundSpeed,convertIasToTas(250,9500));
});

test('manual IAS/Mach overrides the schedule and clearing resumes automatic speed',()=>{
  const t=track('A320',300);t.assignedSpeed={mode:'IAS',value:230};advance(t,120);
  close(t.groundSpeed,convertIasToTas(230,30000));
  t.assignedSpeed={mode:'Mach',value:0.7};advance(t,120);
  close(t.groundSpeed,convertMachToTas(0.7,30000));
  t.assignedSpeed={mode:'Mach',value:null};advance(t,120);
  close(t.groundSpeed,convertMachToTas(0.79,30000));assert.equal(t.assignedSpeed.value,null);
});

test('vertical assignments respect type capability and level capture',()=>{
  for(const [comparator,value,expected] of [['exact',900,900],['or-less',1000,1000],['or-greater',1000,2500],['exact',4000,2750]]){
    const t=track('A320',10,100);t.verticalRateAssigned=true;t.assignedVertical={comparator,value};advance(t,60);
    assert.equal(t.verticalSpeed,expected);
  }
  const t=track('A320',10,100);t.verticalRateAssigned=true;t.assignedVertical={comparator:'exact',value:0};advance(t,30);
  assert.equal(t.actualFlightLevel,10);assert.equal(t.verticalSpeed,0);
});

test('climbs never exceed each type ceiling',()=>{
  for(const type of Object.keys(AIRCRAFT_PERFORMANCE)){
    const ceiling=aircraftPerformance(type).ceilingFL,t=track(type,ceiling-1,600);advance(t,60);
    assert.equal(t.actualFlightLevel,ceiling);assert.equal(t.verticalSpeed,0);
  }
});

test('requested climb can exceed baseline by only 10 percent, descent can freely exceed baseline',()=>{
  assert.equal(requestedVerticalRate(800,1,{value:1000}),880);
  assert.equal(requestedVerticalRate(800,1,{value:500}),500);
  assert.equal(requestedVerticalRate(800,1),800);
  assert.equal(requestedVerticalRate(800,-1,{value:-7000}),-7000);
  assert.equal(requestedVerticalRate(800,-1,{value:-300}),-300);
  assert.equal(requestedVerticalRate(800,-1,{value:1200,comparator:'or-greater'}),-1200);
  assert.equal(requestedVerticalRate(800,-1,{value:300,comparator:'or-less'}),-300);
});

test('phase changes adjust actual rate gradually up and down without snapping to the new baseline',()=>{
  for(const [type,level,target,initial,after,final] of [
    ['A320',50,200,2500,2450,2000],['A320',150,300,2000,1950,1400],
    ['A320',240,350,1400,1350,1000],['A320',240,0,-1000,-1050,-3500],
    ['A320',100,0,-3500,-3450,-1500]]){
    const t=track(type,level,target);t.verticalSpeed=initial;advance(t,1);
    assert.equal(t.verticalSpeed,after,`${type} FL${level}`);
    advance(t,55);assert.equal(t.verticalSpeed,final);
  }
});

test('slow vertical-rate response works at normal frame times and accelerated time',()=>{
  const a=track('A320',10,100),b=structuredClone(a);
  advance(a,1);for(let i=0;i<120;i++)advance(b,1/120);
  close(a.verticalSpeed,50);close(b.verticalSpeed,50);
  assert(b.actualFlightLevel>10);
});

test('manual descent above old UI/movement caps is honoured, lower rates and clearing also work',()=>{
  const t=track('B738',400,0);t.verticalRateAssigned=true;t.assignedVertical={value:-7000,comparator:'exact'};
  advance(t,140);assert.equal(t.verticalSpeed,-7000);
  t.assignedVertical={value:-300,comparator:'exact'};advance(t,134);assert.equal(t.verticalSpeed,-300);
  t.verticalRateAssigned=false;advance(t,80);
  assert.equal(t.verticalSpeed,-aircraftPerformance('B738')[t.performancePhase].rateFpm);
});

test('accelerated simulation has the same phase crossings with and without a route',()=>{
  const a=track('E170',45,250),b=structuredClone(a);
  advance(a,900);for(let i=0;i<1800;i++)advance(b,0.5);
  close(a.actualFlightLevel,b.actualFlightLevel);close(a.groundSpeed,b.groundSpeed);close(a.lon,b.lon);
});

test('unknown ad hoc types retain generic movement, never borrow an unrelated profile',()=>{
  const t=track('UNKNOWN',200,210),initial=t.groundSpeed;
  assert.equal(performanceSchedule(t),null);advance(t,60);
  assert.equal(t.actualFlightLevel,210);assert.equal(t.groundSpeed,initial);
});
