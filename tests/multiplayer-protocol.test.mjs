import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION, createPatch, applyPatch, createStateReceiver, wireTrack, MOVEMENT_FIELDS, MOVEMENT_SCALES } from '../src/multiplayer/protocol.js';
import { SnapshotStream } from '../server/snapshots.js';
import { Room } from '../server/room.js';
import { loadSimulationData } from '../server/data.js';
import { createTrack } from '../src/radar/tracks.js';
import { multiplayerEndpoint } from '../src/multiplayer/endpoint.js';

const json=value=>JSON.parse(JSON.stringify(value));
const data=await loadSimulationData();
const receive=(client,message)=>{if(message)assert(client.accept(json(message)));};
function assertState(client,room){
  assert.deepEqual([...client.tracks.values()],room.state.air.tracks.map(t=>json(wireTrack(t))));
  assert.deepEqual(client.room,json(room.metadata()));
}

test('nested patches preserve null, remove absent fields, and handle array/object transitions',()=>{
  const states=[{a:1,n:null,arr:[{x:1,y:2},{x:2}]},
    {a:null,n:{x:1},arr:[{x:2},{x:2,y:3}],empty:[]},
    {arr:[{x:2}],empty:{}},{arr:[],empty:null},{arr:{0:'value'}},{}];
  let state=states[0];
  for(const expected of states.slice(1)){state=applyPatch(state,json(createPatch(state,expected)));assert.deepEqual(state,expected);}
  assert.equal(createPatch(state,{}),undefined);
  assert.throws(()=>applyPatch({},JSON.parse('{"__proto__":[{"polluted":true}]}')),/Invalid/);
  assert.equal({}.polluted,undefined);
});

test('movement deltas stay accurate through acceleration, rate changes, turns, waypoint crossings and level-off',()=>{
  const room=new Room('MOTION',data),host=room.add('AA');room.command(host.id,{type:'claim',sectorId:'acc-1'});
  for(const [id,level,target,heading,groundSpeed] of [
    ['climb',249.9,255,90,300],['descent',151,145,270,450],['turn',330,330,359.8,450],['route',330,330,90,450],
  ]){
    const track=createTrack({id,callsign:id,aircraftType:'A320',lon:20.123456789,lat:52.123456789,
      actualFlightLevel:level,clearedFlightLevel:target,heading,groundSpeed,
      flightPlan:id==='route'?{waypoints:[{name:'NEAR',lon:20.128456789,lat:52.123456789},{name:'FAR',lon:21,lat:52.123456789}]}:undefined});
    if(id==='climb')track.assignedSpeed={mode:'IAS',value:220};
    room.state.air.tracks.push(track);
  }
  room.refresh();
  const stream=new SnapshotStream(),client=createStateReceiver();
  stream.capture(room);receive(client,stream.capture(room,true));
  const seenRates=new Set(),seenSpeeds=new Set(),climb=room.state.air.tracks[0],route=room.state.air.tracks[3];
  for(let tick=0;tick<1200;tick++){
    if(tick===10)room.command(host.id,{type:'instruction',trackId:'turn',kind:'heading',value:90});
    if(tick===40)room.command(host.id,{type:'instruction',trackId:'climb',kind:'vertical',value:{value:1000,comparator:'exact'}});
    if(tick===70)room.command(host.id,{type:'instruction',trackId:'route',kind:'direct',value:{point:route.flightPlan.waypoints[1]}});
    room.step(.1);seenRates.add(climb.verticalSpeed);seenSpeeds.add(climb.groundSpeed);
    if(tick%3===0 || [10,40,70].includes(tick)){
      const before=JSON.stringify(room.state.air.tracks);receive(client,stream.capture(room));
      assert.equal(JSON.stringify(room.state.air.tracks),before,'network encoding must not mutate simulation');
      assertState(client,room);
      for(const track of room.state.air.tracks)for(let i=0;i<MOVEMENT_FIELDS.length;i++){
        const key=MOVEMENT_FIELDS[i];if(!Number.isFinite(track[key]))continue;
        assert(Math.abs(client.tracks.get(track.id)[key]-track[key])<=.500001/MOVEMENT_SCALES[i],key+' quantisation bound');
      }
    }
  }
  assert(seenRates.size>2);assert(seenSpeeds.size>2);
  assert.equal(climb.actualFlightLevel,255);assert.equal(climb.verticalSpeed,0);
  assert.equal(room.state.air.tracks[1].actualFlightLevel,145);
  assert.equal(room.state.air.tracks[2].heading,90);
  assert(route.flightPlan.nextIndex>=1,'waypoint passage reaches client');
  assert.equal(client.tracks.get('route').flightPlan.waypoints[1].lon,21);
});

test('joins, missed updates, full resync, field removal and track deletion do not corrupt delta baselines',()=>{
  const room=new Room('SYNC',data);room.add('AA');room.spawner.spawn(room.state);room.refresh();
  const stream=new SnapshotStream(),a=createStateReceiver(),b=createStateReceiver();
  stream.capture(room);receive(a,stream.capture(room,true));
  room.step(.1);receive(a,stream.capture(room));
  room.add('BB');receive(a,stream.capture(room));receive(b,stream.capture(room,true));
  room.step(.1);const missed=stream.capture(room);receive(a,missed);
  room.step(.1);const following=stream.capture(room);receive(a,following);
  const before=json([...b.tracks.values()]);assert.equal(b.accept(json(following)),false);assert.deepEqual([...b.tracks.values()],before);
  receive(b,stream.capture(room,true));assertState(b,room);
  const track=room.state.air.tracks[0];track.alerts=['TEST'];receive(a,stream.capture(room));
  // A full snapshot can recover a client at any room sequence.
  receive(b,stream.capture(room,true));delete track.alerts;track.directTo=null;
  const deletion=stream.capture(room);receive(a,deletion);receive(b,deletion);assertState(a,room);assertState(b,room);
  room.state.air.tracks=[];const removed=stream.capture(room);receive(a,removed);receive(b,removed);assertState(a,room);
  assert.equal(stream.capture(room),null,'unchanged rooms send no state frames');
  assert.throws(()=>a.accept({...stream.capture(room,true),protocol:1}),/Refresh/);
  assert.equal(PROTOCOL_VERSION,2);
});

test('navigation coordinates and clearance values survive the wire exactly',()=>{
  const room=new Room('DCT',data),host=room.add('AA');room.command(host.id,{type:'claim',sectorId:'acc-1'});
  const point={name:'EXACT',lon:20.987654321987,lat:52.123456789123};
  const track=createTrack({id:'exact',aircraftType:'A320',lon:20,lat:52,heading:90,groundSpeed:450,
    actualFlightLevel:330,clearedFlightLevel:330,flightPlan:{waypoints:[point]}});
  room.state.air.tracks.push(track);room.refresh();
  const wire=wireTrack(track);assert.deepEqual(wire.flightPlan.waypoints[0],point);
  room.command(host.id,{type:'instruction',trackId:track.id,kind:'direct',value:{point:wire.flightPlan.waypoints[0]}});
  assert.deepEqual(wireTrack(track).directTo.target,point);
});

test('endpoint defaults to same origin and explicitly supports a secure separate backend',()=>{
  assert.equal(multiplayerEndpoint('https://front.example/game/').href,'wss://front.example/game/multiplayer');
  assert.equal(multiplayerEndpoint('http://localhost:3000/').href,'ws://localhost:3000/multiplayer');
  assert.equal(multiplayerEndpoint('https://front.example/','wss://backend.example/multiplayer').href,'wss://backend.example/multiplayer');
  for(const value of ['ws://backend.example/multiplayer','javascript:alert(1)','wss://user:pass@example.com/multiplayer'])assert.throws(()=>multiplayerEndpoint('https://front.example/',value));
});
