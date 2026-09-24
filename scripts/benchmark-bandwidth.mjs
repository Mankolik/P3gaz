// Measures actual WebSocket TCP bytes (including frames/compression, excluding TLS).
// Run the same seed/duration on both revisions; do not compare decoded JSON sizes.
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createServer } from '../server/index.js';
import { PROTOCOL_VERSION } from '../server/room.js';
import { createAircraftSpawner } from '../src/radar/spawner.js';

const args=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const seconds=Number(args.seconds || 20),players=Number(args.players || 2),aircraft=Number(args.aircraft || 100);
if(!Number.isInteger(players)||players<1||players>10||!Number.isInteger(aircraft)||aircraft<1||aircraft>200||!Number.isFinite(seconds)||seconds<1||seconds>300)throw Error('Use players=1..10, aircraft=1..200, seconds=1..300.');
let seed=Number(args.seed || 20260924)>>>0;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const app=await createServer();await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const clients=[];
try{
  for(let i=0;i<players;i++){
    const ws=new WebSocket(`ws://127.0.0.1:${app.server.address().port}/multiplayer`),pending=new Map();
    const c={ws,states:0,decoded:0};clients.push(c);let serial=0;
    ws.on('message',raw=>{c.decoded+=raw.length;const m=JSON.parse(raw);if(m.type==='state'){
      c.states++;if(m.room)c.paused=m.room.paused;else if(m.roomPatch?.paused)c.paused=m.roomPatch.paused[0];
    }if(m.type==='ack'){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve();}}});
    c.send=(type,fields={})=>new Promise((resolve,reject)=>{const id=String(++serial),timer=setTimeout(()=>reject(Error('No acknowledgement')),10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,type,...fields}));});
    await once(ws,'open');
    await c.send(i?'join':'create',{protocol:PROTOCOL_VERSION,initials:'P'+i,code:[...app.rooms.keys()][0]});
    if(!i)await c.send('simulation',{paused:true,speed:1});
  }
  const room=[...app.rooms.values()][0];room.spawner=createAircraftSpawner(room.data.catalogue,{random});
  for(let i=0;i<aircraft;i++)room.spawner.spawn(room.state);room.refresh();
  await clients[0].send('simulation',{paused:false,speed:1});
  // Let both clients consume their initial snapshots before measuring steady traffic.
  await new Promise(r=>setTimeout(r,1000));
  const before=clients.map(c=>({wire:c.ws._socket.bytesRead,decoded:c.decoded,states:c.states}));
  const ticks=[],step=room.step.bind(room);room.step=dt=>{const start=performance.now();step(dt);ticks.push(performance.now()-start);};
  const start=performance.now();await new Promise(r=>setTimeout(r,seconds*1000));
  await clients[0].send('simulation',{paused:true,speed:1});
  const stopDeadline=Date.now()+10000;
  while(!clients.every(c=>c.paused)){
    if(Date.now()>stopDeadline)throw Error('Clients did not receive final pause state.');
    await new Promise(r=>setTimeout(r,5));
  }
  const elapsed=(performance.now()-start)/1000;
  const wire=clients.reduce((n,c,i)=>n+c.ws._socket.bytesRead-before[i].wire,0);
  const decoded=clients.reduce((n,c,i)=>n+c.decoded-before[i].decoded,0);
  ticks.sort((a,b)=>a-b);
  console.log(JSON.stringify({protocol:PROTOCOL_VERSION,players,aircraft,seed:Number(args.seed||20260924),elapsedSeconds:+elapsed.toFixed(2),compression:clients.every(c=>c.ws.extensions.includes('permessage-deflate')),statesPerPlayer:clients.map((c,i)=>c.states-before[i].states),wireBytes:wire,decodedBytes:decoded,totalWireKiBPerSecond:+(wire/1024/elapsed).toFixed(2),projectedTotalMBPerHour:+(wire/elapsed*3600/1e6).toFixed(2),tickP95Ms:+ticks[Math.floor(ticks.length*.95)].toFixed(2)},null,2));
}finally{for(const c of clients)c.ws.terminate();await app.close();}
