import test from 'node:test';
import assert from 'node:assert/strict';
import { assignClearedLevel, assignVerticalRate } from '../src/radar/clearances.js';
import { aircraftPerformance } from '../src/radar/performance.js';
import { AIRCRAFT_PERFORMANCE } from '../src/data/aircraft-performance.js';
import { updateTrackMovement } from '../src/radar/movement.js';

const track = (level=300,target=350)=>({aircraftType:'A21N',lon:20,lat:52,heading:90,
  actualFlightLevel:level,clearedFlightLevel:target,verticalSpeed:1000,groundSpeed:400});
const advance = (t,seconds)=>updateTrackMovement({air:{tracks:[t]}},seconds);
const rate = (t,value,comparator='exact')=>assignVerticalRate(t,{value,comparator});

test('above-ceiling CFL rejects the request and finishes climbing to the last accepted CFL',()=>{
  const t=track();
  assert.equal(assignClearedLevel(t,450),false);
  assert.equal(t.unableCfl,450);assert.equal(t.clearedFlightLevel,350);
  advance(t,600);
  assert.equal(t.actualFlightLevel,350);assert.equal(t.verticalSpeed,0);
  assignClearedLevel(t,400);advance(t,60);
  assert.equal(t.actualFlightLevel,350);assert.equal(t.clearedFlightLevel,350);
});

test('rejected CFL preserves a descent clearance too',()=>{
  const t=track(350,300);t.verticalSpeed=-1000;
  assignClearedLevel(t,450);advance(t,300);
  assert.equal(t.actualFlightLevel,300);assert.equal(t.clearedFlightLevel,300);
});

test('all type ceilings accept the ceiling itself and reject levels above it',()=>{
  for(const aircraftType of Object.keys(AIRCRAFT_PERFORMANCE)){
    const t={...track(),aircraftType};const ceiling=aircraftPerformance(aircraftType).ceilingFL;
    assert.equal(assignClearedLevel(t,ceiling+10),false);
    assert.equal(t.clearedFlightLevel,350);
    assert.equal(assignClearedLevel(t,ceiling),true);
    assert.equal(t.unableCfl,null);assert.equal(t.clearedFlightLevel,ceiling);
  }
});

test('reissuing the accepted CFL or clearing it clears the unable response',()=>{
  const t=track();assignClearedLevel(t,450);assignClearedLevel(t,350);
  assert.equal(t.unableCfl,null);
  assignClearedLevel(t,450);assignClearedLevel(t,null);
  assert.equal(t.unableCfl,null);assert.equal(t.clearedFlightLevel,null);
});

test('RoC unable starts strictly above 130%, while movement remains capped at 110%',()=>{
  const t=track();rate(t,1300);assert.equal(t.unableVerticalRate,false);
  rate(t,1301);assert.equal(t.unableVerticalRate,true);
  advance(t,2);assert.equal(t.verticalSpeed,1100);
  rate(t,800);assert.equal(t.unableVerticalRate,false);
  advance(t,6);assert.equal(t.verticalSpeed,800);
  rate(t,2000);assignVerticalRate(t,null);
  assert.equal(t.unableVerticalRate,false);assert.equal(t.verticalRateAssigned,false);
});

test('RoC checks each type and altitude band baseline, including while level at cruise',()=>{
  for(const aircraftType of Object.keys(AIRCRAFT_PERFORMANCE)){
    for(const [level,phase] of [[10,'initialClimb'],[50,'climb150'],[150,'climb240'],[300,'machClimb']]){
      const t={...track(level,level),aircraftType};const baseline=aircraftPerformance(aircraftType)[phase].rateFpm;
      rate(t,baseline*1.3);assert.equal(t.unableVerticalRate,false,`${aircraftType} ${phase}`);
      rate(t,baseline*1.3+1);assert.equal(t.unableVerticalRate,true,`${aircraftType} ${phase}`);
    }
  }
});

test('rate comparators, descent freedom, and independent response clearing',()=>{
  const t=track();assignClearedLevel(t,450);
  rate(t,2000,'or-greater');assert.equal(t.unableVerticalRate,true);
  rate(t,2000,'or-less');assert.equal(t.unableVerticalRate,false);
  assert.equal(t.unableCfl,450);
  rate(t,2000);assignClearedLevel(t,300);
  assert.equal(t.unableVerticalRate,true);assert.equal(t.unableCfl,null);
  t.actualFlightLevel=350;
  rate(t,-7000);assert.equal(t.unableVerticalRate,false);
  rate(t,7000);assert.equal(t.unableVerticalRate,false,'CFL determines descent regardless of sign');
  rate(t,0);assert.equal(t.unableVerticalRate,false);
});
