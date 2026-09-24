import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { Room, PROTOCOL_VERSION } from './room.js';
import { loadSimulationData } from './data.js';
import { SnapshotStream } from './snapshots.js';
import { createStaticHandler } from './static.js';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
export async function createServer({data,maxRooms=8,maxAircraft=200,
  snapshotHz=Number(process.env.SNAPSHOT_HZ || 2),
  serveStatic=process.env.SERVE_STATIC!=='false',
  allowedOrigins=(process.env.ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean),
  multiplayerUrl=process.env.MULTIPLAYER_URL || '',
}={}){
  if(!Number.isFinite(snapshotHz) || snapshotHz<1 || snapshotHz>20)throw Error('SNAPSHOT_HZ must be between 1 and 20.');
  const origins=new Set(allowedOrigins.map(origin=>{
    const url=new URL(origin);
    if(!['http:','https:'].includes(url.protocol) || url.origin!==origin)throw Error('ALLOWED_ORIGINS requires exact HTTP(S) origins without paths or trailing slashes.');
    return url.origin;
  }));
  data ||= await loadSimulationData();
  const rooms=new Map(),streams=new WeakMap();
  const staticHandler=createStaticHandler(root,{multiplayerUrl});
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/health'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ok:true,protocol:PROTOCOL_VERSION}));}
      if(req.method!=='GET' && req.method!=='HEAD'){res.writeHead(405);return res.end();}
      if(!serveStatic){res.writeHead(404);return res.end('Not found');}
      await staticHandler(req,res,url);
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
  function stream(room){
    if(!streams.has(room))streams.set(room,new SnapshotStream());
    return streams.get(room);
  }
  function broadcast(room,excludeId=null){
    if(room.ended)return;
    const snapshot=stream(room).capture(room);if(!snapshot)return;
    const message=JSON.stringify(snapshot);
    for(const p of room.players.values())if(p.id!==excludeId)p.send(message);
  }
  function sendFull(room,player){
    // Flush pending movement/membership changes to existing clients first so
    // the new full snapshot and every subsequent delta share one baseline.
    broadcast(room,player.id);
    player.send(stream(room).capture(room,true));
  }
  server.on('upgrade',(req,socket,head)=>{
    let allowed=!req.headers.origin;
    try{
      if(req.headers.origin){
        const origin=new URL(req.headers.origin);
        allowed=['http:','https:'].includes(origin.protocol) && origin.origin===req.headers.origin
          && (origin.host===req.headers.host || origins.has(origin.origin));
      }
    }catch{allowed=false;}
    if(req.url!=='/multiplayer' || !allowed || wss.clients.size>=100){socket.destroy();return;}
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
          clearTimeout(helloTimeout);send(socket,{type:'welcome',playerId:player.id,code:room.code});sendFull(room,player);
          send(socket,{type:'ack',id:message.id});return;
        }else if(message.type==='leave'){socket.close(1000,'Left room');return;}
        else if(message.type==='resync'){sendFull(room,player);send(socket,{type:'ack',id:message.id});return;}
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
  let last=performance.now();
  const timer=setInterval(()=>{
    const now=performance.now(),seconds=Math.min(1,(now-last)/1000);last=now;
    for(const room of rooms.values()){
      try{room.step(seconds);}
      catch(error){console.error('Room simulation failed',error);room.remove(room.hostId);rooms.delete(room.code);}
    }
  },100);
  const networkTimer=setInterval(()=>{for(const room of rooms.values())broadcast(room);},1000/snapshotHz);
  const heartbeat=setInterval(()=>{for(const socket of wss.clients){if(!socket.alive){socket.terminate();continue;}socket.alive=false;socket.ping();}},15000);
  return {server,rooms,async close(){clearInterval(timer);clearInterval(networkTimer);clearInterval(heartbeat);for(const room of rooms.values())room.remove(room.hostId);for(const ws of wss.clients)ws.terminate();wss.close();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=await createServer();app.server.listen(Number(process.env.PORT || 3000),'0.0.0.0',()=>console.log('P3gaz multiplayer listening on port '+(process.env.PORT || 3000)));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
}
