import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createServer } from '../server/index.js';
import { cloneSectorisation,moveSectorMembers,ELEMENTARY_SECTORS } from '../src/radar/sectorisation.js';

const until=async(predicate,ms=15000)=>{
  const start=Date.now();while(!predicate()){if(Date.now()-start>ms)throw Error('Timed out waiting for server state');await new Promise(resolve=>setTimeout(resolve,20));}
};
async function client(url){
  const socket=new WebSocket(url),pending=new Map(),client={socket,tracks:new Map(),bytes:0,states:0,room:null,playerId:null};let serial=0;
  socket.on('message',raw=>{
    client.bytes+=raw.length;const m=JSON.parse(raw);
    if(m.type==='welcome')client.playerId=m.playerId;
    if(m.type==='state'){
      client.states++;client.room=m.room;if(m.full)client.tracks.clear();for(const id of m.removed)client.tracks.delete(id);
      for(const {id,fields} of m.upserts)client.tracks.set(id,Object.assign(client.tracks.get(id)||{},fields));
    }
    if(m.type==='ended')client.ended=m.message;
    if(m.type==='ack'){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve();}}
  });
  client.send=(type,fields={})=>new Promise((resolve,reject)=>{
    const id=String(++serial),timer=setTimeout(()=>{pending.delete(id);reject(Error('No acknowledgement'));},10000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({type,id,...fields}));
  });
  await once(socket,'open');return client;
}

test('public server isolates rooms, rejects unauthorised commands, and synchronises ten clients with 100 aircraft',async()=>{
  const app=await createServer();await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const clients=[],origin='http://127.0.0.1:'+app.server.address().port;
  try{
    assert.equal((await fetch(origin+'/')).status,200);
    assert.equal((await fetch(origin+'/health')).status,200);
    for(const name of ['/server/index.js','/.env','/.git/config','/assets/../../server/room.js','/assets/x%5c..%5c..%5cserver%5croom.js'])assert.equal((await fetch(origin+name)).status,404);
    const host=await client(origin.replace('http:','ws:')+'/multiplayer');clients.push(host);await host.send('create',{protocol:1,initials:'P0'});
    const room=app.rooms.get(host.room.code);
    await host.send('simulation',{paused:true,speed:1});
    for(let i=1;i<10;i++){
      const c=await client(origin.replace('http:','ws:')+'/multiplayer');clients.push(c);await c.send('join',{protocol:1,code:room.code,initials:'P'+i});assert.equal(c.room.players.find(p=>p.id===c.playerId).sectorId,null);
    }
    const extra=await client(origin.replace('http:','ws:')+'/multiplayer');clients.push(extra);
    await assert.rejects(extra.send('join',{protocol:1,code:room.code,initials:'XX'}),/ten players/);
    await assert.rejects(clients[1].send('spawn'),/Only the host/);
    const config=cloneSectorisation(room.config);moveSectorMembers(config,ELEMENTARY_SECTORS,null);config.controlledId=config.groups[0].id;
    const assignments=Object.fromEntries([...room.players.values()].map((p,i)=>[p.id,config.groups[i].id]));
    await host.send('configure',{config,assignments,revision:room.revision});
    await assert.rejects(clients[1].send('claim',{sectorId:assignments[host.playerId]}),/taken/);
    const started=performance.now();for(let i=0;i<100;i++)room.spawner.spawn(room.state);room.refresh();
    const initialMs=performance.now()-started;
    const stepTimes=[];const step=room.step.bind(room);room.step=seconds=>{const start=performance.now();step(seconds);stepTimes.push(performance.now()-start);};
    await host.send('simulation',{paused:false,speed:1});
    await until(()=>clients.slice(0,10).every(c=>c.tracks.size===100));
    const baselineBytes=clients.slice(0,10).map(c=>c.socket._socket.bytesRead),start=performance.now();
    await new Promise(resolve=>setTimeout(resolve,6000));
    await host.send('simulation',{paused:true,speed:1});await until(()=>clients.slice(0,10).every(c=>c.room.paused));
    const elapsed=(performance.now()-start)/1000;
    const positions=c=>[...c.tracks.values()].map(t=>[t.id,t.lon,t.lat,t.actualFlightLevel,t.clearedFlightLevel,t.control.owner]);
    for(const c of clients.slice(1,10))assert.deepEqual(positions(c),positions(host));
    assert([...host.tracks.values()].every(t=>Number.isFinite(t.lon) && Number.isFinite(t.actualFlightLevel)));
    const totalBytes=clients.slice(0,10).reduce((sum,c,i)=>sum+c.socket._socket.bytesRead-baselineBytes[i],0);
    stepTimes.sort((a,b)=>a-b);
    console.log(JSON.stringify({players:10,aircraft:100,initialPopulationMs:Math.round(initialMs),tickP95Ms:+stepTimes[Math.floor(stepTimes.length*.95)].toFixed(2),tickMaxMs:+stepTimes.at(-1).toFixed(2),totalOutboundKiBPerSecond:+(totalBytes/1024/elapsed).toFixed(1)}));
    // A late arrival receives a complete snapshot, including already-existing aircraft.
    const leaving=clients[9];leaving.socket.close();await until(()=>room.players.size===9);
    const late=await client(origin.replace('http:','ws:')+'/multiplayer');clients[9]=late;
    await late.send('join',{protocol:1,code:room.code,initials:'P9'});
    assert.equal(late.tracks.size,100);assert.deepEqual(positions(late),positions(host));
    // An independent room receives no traffic or commands from this room.
    await extra.send('create',{protocol:1,initials:'XX'});assert.equal(extra.tracks.size,0);
    host.socket.close();await until(()=>clients.slice(1,10).every(c=>c.ended));assert.equal(app.rooms.has(room.code),false);
    assert.equal(app.rooms.size,1);
  }finally{for(const c of clients)c.socket.terminate();await app.close();}
});
