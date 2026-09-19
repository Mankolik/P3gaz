import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createNavigationIndex, assignDirectTo, assignHeading, setFlightPlan, remainingPlanPoints, navigationTarget, passedNavigationPoint } from '../src/radar/routes.js';
import { updateTrackMovement } from '../src/radar/movement.js';
import { parseSpeedInstruction } from '../src/utils/speed.js';

const point=(name,lon,lat=0)=>({name,lon,lat});
const aircraft=()=>({lon:0,lat:0,heading:90,groundSpeed:360,assignedHeading:180,actualFlightLevel:200,clearedFlightLevel:200});
const advance=(track,seconds)=>updateTrackMovement({air:{tracks:[track]}},seconds);

test('an unassigned speed stays unassigned when labels normalize it',()=>{
  assert.deepEqual(parseSpeedInstruction(null),{mode:'IAS',value:null});
  assert.deepEqual(parseSpeedInstruction(undefined,'Mach'),{mode:'Mach',value:null});
});

test('navigation catalog uses real geographic points and retains ambiguous names',async()=>{
  const data=JSON.parse(await readFile(new URL('../assets/geojson/pl_enr4_4_waypoints.geojson',import.meta.url),'utf8'));
  const catalog=createNavigationIndex([data]);
  assert(catalog.size>100);
  assert.equal(catalog.get('ABAPA')[0].lon,21.194444444444446);
  const feature=(name,coords)=>({properties:{name},geometry:{type:'Point',coordinates:coords}});
  const duplicate=createNavigationIndex([{features:[feature(' fix ',[1,2]),feature('FIX',[1,2]),feature('FIX',[3,4]),feature('BAD',[NaN,0])]}]);
  assert.equal(duplicate.get('FIX').length,2);
  assert.equal(duplicate.has('BAD'),false);
});

test('explicit navigation corrections override duplicates independently of dataset order',()=>{
  const feature=(name,coordinates)=>({properties:{name},geometry:{type:'Point',coordinates}});
  const imported={features:[feature('ELVOT',[1,2]),feature('ELVOT',[3,4]),feature('OTHER',[5,6]),feature('OTHER',[7,8])]};
  const corrections={navigationOverrides:true,features:[feature('ELVOT',[16.409166666666664,50.611666666666665]),feature('SUXTU',[17.28111111111111,53.06])]};
  for(const collections of [[imported,corrections],[corrections,imported]]){
    const index=createNavigationIndex(collections);
    assert.deepEqual(index.get('ELVOT'),[{name:'ELVOT',lon:16.409166666666664,lat:50.611666666666665}]);
    assert.equal(index.get('SUXTU').length,1);
    assert.equal(index.get('OTHER').length,2,'unrelated ambiguities remain visible');
  }
  const conflict={navigationOverrides:true,features:[feature('ELVOT',[10,20])]};
  assert.equal(createNavigationIndex([imported,corrections,conflict]).get('ELVOT').length,2,'conflicting corrections must not silently win');
});

test('direct-to captures the point and holds arrival heading without resurrecting a clearance',()=>{
  const track=aircraft();
  assignDirectTo(track,point('END',0.1));
  assert.equal(track.assignedHeading,null);
  advance(track,90);
  assert.equal(track.directTo,null);
  assert.equal(track.navigationMode,'heading');
  assert(track.lon>0.14,'continues through the endpoint rather than stopping');
  assert(Math.abs(track.heading-90)<0.001);
  advance(track,60);
  assert(Math.abs(track.heading-90)<0.001);
  assert(track.lon>0.24);
});

test('a direct to the current position preserves the present heading',()=>{
  const track=aircraft(); track.heading=123;
  assignDirectTo(track,point('HERE',0));
  advance(track,1);
  assert.equal(track.directTo,null);
  assert.equal(track.heading,123);
});

test('shortcut skips prior fixes, sequences remaining route and completes its last point',()=>{
  const track=aircraft();
  setFlightPlan(track,[point('A',0.1),point('B',0.2),point('C',0.3)]);
  assignDirectTo(track,track.flightPlan.waypoints[1],{planIndex:1});
  assert.deepEqual(remainingPlanPoints(track).map(p=>p.name),['B','C']);
  advance(track,125);
  assert.equal(track.flightPlan.nextIndex,2);
  assert.equal(navigationTarget(track).name,'C');
  assert.deepEqual(remainingPlanPoints(track).map(p=>p.name),['C']);
  advance(track,100);
  assert.equal(track.navigationMode,'heading');
  assert.equal(track.flightPlan.nextIndex,3);
  assert(track.lon>0.37);
});

test('off-route direct rejoins the chosen FPL point after the new point',()=>{
  const track=aircraft();
  setFlightPlan(track,[point('SKIP',0.1),point('JOIN',0.3),point('LAST',0.4)]);
  assignDirectTo(track,point('VIA',0.2),{rejoinIndex:1});
  advance(track,125);
  assert.equal(track.directTo,null);
  assert.equal(track.flightPlan.nextIndex,1);
  assert.equal(navigationTarget(track).name,'JOIN');
  advance(track,60);
  assert.equal(navigationTarget(track).name,'LAST');
});

test('ending an off-route direct suspends an existing plan; explicit heading cancels navigation',()=>{
  const track=aircraft();
  setFlightPlan(track,[point('LATER',1)]);
  assignDirectTo(track,point('END',0.1));
  advance(track,90);
  assert.equal(track.navigationMode,'heading');
  assert.equal(track.flightPlan.nextIndex,0);
  assert.equal(navigationTarget(track),null);
  assignDirectTo(track,point('LATER',1));
  assignHeading(track,180);
  advance(track,10);
  assert.equal(track.directTo,null);
  assert.equal(track.heading,120,'heading command keeps the existing 3 deg/s turn rate');
});

test('invalid and obsolete route selections leave navigation unchanged',()=>{
  const track=aircraft();
  assert.throws(()=>assignDirectTo(track,point('X',NaN)));
  assert.throws(()=>assignDirectTo(track,point('X',1),{rejoinIndex:0}));
  setFlightPlan(track,[point('REPEAT',0.1),point('REPEAT',0.2)],1);
  assert.throws(()=>assignDirectTo(track,point('REPEAT',0.1),{planIndex:0}));
  assert.throws(()=>assignDirectTo(track,point('WRONG',0.2),{planIndex:1}));
  assert.equal(track.directTo,null);
  assignDirectTo(track,point('END',0.1),{rejoinIndex:1});
  track.flightPlan={waypoints:[point('REPLACED',2)],nextIndex:0};
  advance(track,90);
  assert.equal(track.navigationMode,'heading');
  assert.equal(track.flightPlan.nextIndex,0);
});

test('segment capture handles overshoot but rejects points far off the travelled segment',()=>{
  assert(passedNavigationPoint(point('FROM',0),point('TO',1),point('FIX',0.5)));
  assert(!passedNavigationPoint(point('FROM',0),point('TO',1),point('FIX',0.5,0.1)));
  const track=aircraft(); track.groundSpeed=0;
  assignDirectTo(track,point('STILL',0));
  advance(track,100);
  assert.equal(track.directTo.target.name,'STILL');
  assert.equal(track.lon,0);
});

test('navigation takes rate-limited turns and reaches a distant point behind the aircraft',()=>{
  const track=aircraft();
  assignDirectTo(track,point('BEHIND',-0.2));
  advance(track,10);
  assert(Math.abs(track.heading-90)<=30.001);
  advance(track,1000);
  assert.equal(track.directTo,null);
});

test('a nearby point behind the aircraft can be intercepted without orbiting forever',()=>{
  const track=aircraft();
  assignDirectTo(track,point('CLOSE',-0.01));
  advance(track,1200);
  assert.equal(track.directTo,null);
});

test('points inside the initial turn circle use an intercept instead of endless circling',()=>{
  for(const lat of [0.005,0.01,0.02,0.03]){
    const track=aircraft();
    assignDirectTo(track,point('CLOSE',0,lat));
    advance(track,1200);
    assert.equal(track.directTo,null,`latitude ${lat}`);
    assert.equal(track.navigationIntercept,null);
    assert.equal(track.navigationMode,'heading');
  }
});
