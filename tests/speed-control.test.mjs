import test from 'node:test';
import assert from 'node:assert/strict';
import { AIRCRAFT_PERFORMANCE } from '../src/data/aircraft-performance.js';
import { speedLimits, speedMode, effectiveSpeedInstruction, limitSpeedInstruction } from '../src/radar/speed-control.js';
import { updateTrackMovement } from '../src/radar/movement.js';
import { convertIasToTas, convertMachToTas } from '../src/utils/speed.js';
import { assignHeading, assignDirectTo, setFlightPlan } from '../src/radar/routes.js';

const track=(level=300,target=level)=>({aircraftType:'A320',actualFlightLevel:level,clearedFlightLevel:target,
  lon:20,lat:52,heading:90,groundSpeed:400,verticalSpeed:0});
const advance=(t,s)=>updateTrackMovement({air:{tracks:[t]}},s);
const close=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('every type has independent cruise Mach bounds and an MCS-minus-25 IAS floor',()=>{
  for(const [aircraftType,p] of Object.entries(AIRCRAFT_PERFORMANCE)){
    for(const level of [10,100,239,240,300,p.ceilingFL]){
      const t={...track(level),aircraftType};
      assert.equal(speedLimits(t,'IAS').min,p.minimumCleanSpeedKnots-25);
      const {min,max}=speedLimits(t,'Mach');
      assert(min<=max,`${aircraftType} FL${level} has usable Mach speeds`);
      close(min,p.cruise.mach-0.05);close(max,p.cruise.mach+0.01);
      assert.equal(limitSpeedInstruction(t,{mode:'Mach',value:0.99}).value,max);
      assert.equal(limitSpeedInstruction(t,{mode:'IAS',value:100}).value,p.minimumCleanSpeedKnots-25);
    }
  }
});

test('speed mode uses FL240 consistently for climb, descent and level flight',()=>{
  for(const level of [239.99,240,240.01])for(const target of [100,level,350]){
    const t=track(level,target);
    assert.equal(speedMode(t),level<240?'IAS':'Mach');
    assert.equal(effectiveSpeedInstruction(t).mode,speedMode(t));
  }
});

test('Mach waits below conversion, activates on climb and remains recorded',()=>{
  const t=track(239,250);t.assignedSpeed={mode:'Mach',value:0.76};
  assert.deepEqual(effectiveSpeedInstruction(t),{mode:'IAS',value:290});
  advance(t,150);assert.equal(t.actualFlightLevel,250);
  assert.deepEqual(effectiveSpeedInstruction(t),t.assignedSpeed);
  advance(t,60);close(t.groundSpeed,convertMachToTas(0.76,25000));
});

test('IAS waits above conversion and activates on descent',()=>{
  const t=track(241,230);t.assignedSpeed={mode:'IAS',value:230};
  assert.deepEqual(effectiveSpeedInstruction(t),{mode:'Mach',value:0.78});
  advance(t,150);assert.equal(t.actualFlightLevel,230);
  assert.deepEqual(effectiveSpeedInstruction(t),t.assignedSpeed);
  advance(t,60);close(t.groundSpeed,convertIasToTas(230,23000));
});

test('same-mode restrictions apply to high and low cruise; clearing restores baselines',()=>{
  for(const [level,mode,value,baseline] of [[300,'Mach',0.76,0.79],[180,'IAS',240,290]]){
    const t=track(level);t.assignedSpeed={mode,value};advance(t,120);
    const convert=mode==='Mach'?convertMachToTas:convertIasToTas;
    close(t.groundSpeed,convert(value,level*100));
    t.assignedSpeed={mode,value:null};advance(t,120);
    close(t.groundSpeed,convert(baseline,level*100));
  }
});

test('MCS minus 25 constrains automatic and assigned low-altitude targets, including approach',()=>{
  const t=track(10);t.assignedSpeed={mode:'IAS',value:100};advance(t,120);
  close(t.groundSpeed,convertIasToTas(185,1000));
  t.assignedSpeed=null;advance(t,60);close(t.groundSpeed,convertIasToTas(185,1000));
  t.performancePhase='approach';t.assignedSpeed={mode:'IAS',value:185};advance(t,60);
  close(t.groundSpeed,convertIasToTas(185,1000));
});

test('FL430 overflights use only cruise Mach bounds, without an MCS-derived floor',()=>{
  for(const aircraftType of ['B77L','B77W']){
    const t={...track(430),aircraftType,assignedSpeed:{mode:'Mach',value:0.79}};
    assert.deepEqual(speedLimits(t,'Mach'),{min:0.79,max:0.85});
    advance(t,120);close(t.groundSpeed,convertMachToTas(0.79,43000));
    t.assignedSpeed={mode:'IAS',value:100};advance(t,120);
    close(t.groundSpeed,convertMachToTas(0.84,43000));
  }
});

test('clearing a heading hides it but completes its turn; point/route/new heading replace the hold',()=>{
  const t=track();assignHeading(t,180);advance(t,5);assert.equal(t.heading,105);
  assignHeading(t);assert.equal(t.assignedHeading,null);assert.equal(t.heldHeading,180);
  advance(t,30);assert.equal(t.heading,180);
  const point={name:'EAST',lon:22,lat:52};assignDirectTo(t,point);
  assert.equal(t.heldHeading,null);advance(t,5);assert.notEqual(t.heading,180);
  assignHeading(t,270);assignHeading(t);assignHeading(t,90);
  assert.equal(t.heldHeading,null);assert.equal(t.assignedHeading,90);
  assignHeading(t);setFlightPlan(t,[point]);assert.equal(t.heldHeading,null);
  assignHeading(t);assert.equal(t.navigationMode,'route','empty heading clear preserves an active route');
  assignDirectTo(t,point);assignHeading(t);assert.equal(t.navigationMode,'direct');
});
