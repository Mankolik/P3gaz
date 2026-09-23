import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { Room, PROTOCOL_VERSION } from './room.js';
import { loadSimulationData } from './data.js';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const wireTrack=t=>{
  const {x,y,vector,sectorMembership,...copy}=t;
  if(t.control)copy.control={shared:true,sectorised:true,physical:t.control.physical,activeSector:t.control.activeSector,
    owner:t.control.owner,hasEnteredFir:t.control.hasEnteredFir,visit:t.control.visit};
  if(t.trajectory)copy.trajectory={...t.trajectory,points:t.trajectory.points.slice(0,1),omitted:[]};
  if(t.directTo)copy.directTo={...t.directTo,plan:null};
  return copy;
};
export async function createServer({data,maxRooms=8,maxAircraft=200}={}){
  data ||= await loadSimulationData();
  const rooms=new Map(),baselines=new WeakMap();
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/health'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ok:true,protocol:PROTOCOL_VERSION}));}
      if(req.method!=='GET' && req.method!=='HEAD'){res.writeHead(405);return res.end();}
      const name=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
      if(name.includes('\\'))throw Error('Not public');
      if(!/^\/(?:index\.html|styles\.css|favicon\.ico|(?:src|assets)\/[^\0]+)$/.test(name))throw Error('Not public');
      const file=path.resolve(root,'.'+name);
      if(!file.startsWith(root+path.sep) || name.split('/').some(p=>p.startsWith('.')))throw Error('Not public');
      const content=await readFile(file);
      res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.geojson':'application/geo+json','.woff2':'font/woff2','.woff':'font/woff','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)] || 'application/octet-stream');
      res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-cache');
      res.end(req.method==='HEAD'?undefined:content);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:32768,perMessageDeflate:{
    serverNoContextTakeover:true,clientNoContextTakeover:true,concurrencyLimit:2,threshold:1024,zlibDeflateOptions:{level:3},
  }});
  const send=(socket,message)=>{
    if(socket.readyState!==WebSocket.OPEN)return;
    if(socket.bufferedAmount>2*1024*1024){socket.close(1013,'Connection too slow');return;}
    socket.send(typeof message==='string'?message:JSON.stringify(message));
  };
  function snapshot(room,full=false){
    const old=baselines.get(room) || new Map(),next=new Map(),upserts=[];
    for(const t of room.state.air.tracks){
      const fields=wireTrack(t),prior=old.get(t.id),serialized={};
      const changes={};
      for(const [key,value] of Object.entries(fields)){
        serialized[key]=JSON.stringify(value);
        if(full || !prior || prior[key]!==serialized[key])changes[key]=value;
      }
      if(Object.keys(changes).length)upserts.push({id:t.id,fields:changes});
      next.set(t.id,serialized);
    }
    const removed=[...old.keys()].filter(id=>!next.has(id));
    if(!full)baselines.set(room,next);
    return {type:'state',full,room:room.metadata(),upserts,removed};
  }
  function broadcast(room){
    if(room.ended)return;
    const message=JSON.stringify(snapshot(room));for(const p of room.players.values())p.send(message);
  }
  server.on('upgrade',(req,socket,head)=>{
    let origin;try{origin=req.headers.origin ? new URL(req.headers.origin).host : req.headers.host;}catch{socket.destroy();return;}
    if(req.url!=='/multiplayer' || origin!==req.headers.host || wss.clients.size>=100){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  wss.on('connection',socket=>{
    let room,player;socket.alive=true;socket.on('pong',()=>{socket.alive=true;});
    let count=0,windowStart=Date.now();
    const helloTimeout=setTimeout(()=>{if(!player)socket.close(1008,'Join a room first');},10000);
    socket.on('error',()=>{});
    socket.on('message',(raw,binary)=>{
      let message;
      try{
        if(Date.now()-windowStart>1000){count=0;windowStart=Date.now();}
        if(++count>60){socket.close(1008,'Too many commands');return;}
        if(binary)throw Error('Text messages required.');
        message=JSON.parse(raw.toString());
        if(!message || typeof message!=='object' || typeof message.id!=='string' || message.id.length>64)throw Error('Invalid message.');
        if(!player){
          if(message.protocol!==PROTOCOL_VERSION)throw Error('Refresh the page to use the current multiplayer version.');
          if(message.type==='create'){
            if(rooms.size>=maxRooms)throw Error('The server is full. Try again later.');
            const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let code;
            do{code=Array.from({length:8},()=>alphabet[randomInt(alphabet.length)]).join('');}while(rooms.has(code));
            const created=new Room(code,data,{maxAircraft});
            player=created.add(message.initials,msg=>send(socket,msg));room=created;rooms.set(code,room);
          }else if(message.type==='join'){
            const found=rooms.get(String(message.code || '').toUpperCase());if(!found)throw Error('Room not found or already ended.');
            player=found.add(message.initials,msg=>send(socket,msg));room=found;
          }else throw Error('Create or join a room first.');
          clearTimeout(helloTimeout);send(socket,{type:'welcome',playerId:player.id,code:room.code});send(socket,snapshot(room,true));
        }else if(message.type==='leave'){socket.close(1000,'Left room');return;}
        else room.command(player.id,message);
        broadcast(room);send(socket,{type:'ack',id:message.id});
      }catch(error){send(socket,{type:'ack',id:message?.id,error:error.message});}
    });
    socket.on('close',()=>{
      clearTimeout(helloTimeout);if(!room || !player)return;
      room.remove(player.id);
      if(room.ended){rooms.delete(room.code);for(const peer of wss.clients)if(peer.roomCode===room.code)peer.close(1000,'Host left');}
      else broadcast(room);
    });
    // Used only to close sockets of an ended room; no room credentials persist.
    socket.on('message',()=>{if(room)socket.roomCode=room.code;});
  });
  let last=performance.now(),broadcastElapsed=0;
  const timer=setInterval(()=>{
    const now=performance.now(),seconds=Math.min(1,(now-last)/1000);last=now;broadcastElapsed+=seconds;
    for(const room of rooms.values()){
      try{room.step(seconds);if(broadcastElapsed>=.5)broadcast(room);}
      catch(error){console.error('Room simulation failed',error);room.remove(room.hostId);rooms.delete(room.code);}
    }
    if(broadcastElapsed>=.5)broadcastElapsed=0;
  },100);
  const heartbeat=setInterval(()=>{for(const socket of wss.clients){if(!socket.alive){socket.terminate();continue;}socket.alive=false;socket.ping();}},15000);
  return {server,rooms,async close(){clearInterval(timer);clearInterval(heartbeat);for(const room of rooms.values())room.remove(room.hostId);for(const ws of wss.clients)ws.terminate();wss.close();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=await createServer();app.server.listen(Number(process.env.PORT || 3000),'0.0.0.0',()=>console.log('P3gaz multiplayer listening on port '+(process.env.PORT || 3000)));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
}
