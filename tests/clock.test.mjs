import test from 'node:test';
import assert from 'node:assert/strict';
import { clockText } from '../src/ui/clock.js';
import { Room } from '../server/room.js';
import { loadSimulationData } from '../server/data.js';
import { SnapshotStream } from '../server/snapshots.js';
import { createStateReceiver } from '../src/multiplayer/protocol.js';

const data=await loadSimulationData();

test('solo clock uses actual UTC and restores it after leaving a room',()=>{
  const now=Date.parse('2026-10-06T23:59:58Z');
  assert.equal(clockText(undefined,now),'23:59:58Z');
  assert.equal(clockText({connected:false,room:{time:90}},now),'23:59:58Z');
  assert.equal(clockText({connected:true,room:{time:90}},now),'12:01:30Z');
  assert.equal(clockText({connected:false},now+3000),'00:00:01Z');
  assert.equal(clockText({connected:true,room:null},now),'--:--:--Z');
});

test('room clocks share elapsed time through empty-room snapshots, pause, speed changes and late joins',()=>{
  const room=new Room('CLOCK',data),host=room.add('AA');
  const stream=new SnapshotStream(),a=createStateReceiver(),b=createStateReceiver();
  const display=client=>clockText({connected:true,room:client.room});
  stream.capture(room);a.accept(stream.capture(room,true));assert.equal(display(a),'12:00:00Z');
  room.step(1);a.accept(stream.capture(room));assert.equal(display(a),'12:00:01Z');
  room.command(host.id,{type:'simulation',paused:true,speed:1});
  a.accept(stream.capture(room));room.step(60);
  assert.equal(stream.capture(room),null,'paused empty rooms send no redundant clock updates');
  assert.equal(display(a),'12:00:01Z');
  room.command(host.id,{type:'simulation',paused:false,speed:4});
  room.step(15);a.accept(stream.capture(room));assert.equal(display(a),'12:01:01Z');
  room.add('BB');b.accept(stream.capture(room,true));
  assert.equal(display(b),display(a),'joining must not restart the clock');
  room.command(host.id,{type:'simulation',paused:false,speed:2});room.step(30);
  const delta=stream.capture(room);a.accept(delta);b.accept(delta);
  assert.equal(display(a),'12:02:01Z');assert.equal(display(b),display(a));
  room.time=12*3600;room.step(.5);a.accept(stream.capture(room));
  assert.equal(display(a),'00:00:01Z');
  assert.equal(clockText({connected:true,room:new Room('NEW',data).metadata()}),'12:00:00Z');
});
