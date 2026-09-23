import { groupAirspace } from '../radar/sectorisation.js';
import { playerSector, trackForPlayer } from './view.js';
import { bindInstructionTransport } from '../radar/coordination.js';
import { updateTrackMovement } from '../radar/movement.js';

export function createMultiplayerClient(state){
  const mp={connected:false,connecting:false,room:null,playerId:null,message:'',socket:null};
  state.multiplayer=mp;
  const shared=new Map(),pending=new Map();let serial=0,local=null,configKey='';
  const changed=()=>state.bus.emit('multiplayer:changed');
  const notice=message=>{mp.message=message;changed();};
  const request=(type,fields={})=>new Promise((resolve,reject)=>{
    if(mp.socket?.readyState!==WebSocket.OPEN)return reject(Error('Not connected to multiplayer.'));
    const id=String(++serial),timer=setTimeout(()=>{pending.delete(id);reject(Error('The server did not answer.'));},10000);
    pending.set(id,{resolve,reject,timer});mp.socket.send(JSON.stringify({id,type,...fields}));
  });
  function redrawViews(){
    if(!mp.room)return;
    const sector=playerSector(mp.room,mp.playerId),before=state.air.controlledSector;
    state.air.controlledSector=sector;
    const nextKey=JSON.stringify(mp.room.config);
    if(configKey!==nextKey){configKey=nextKey;state.air.sectorisation=mp.room.config;state.air.airspaceIndex=groupAirspace(state.air.airspaceIndex,mp.room.config);}
    const previous=new Map(state.air.tracks.map(t=>[t.id,t]));
    state.air.tracks=[...shared.values()].map(raw=>{
      const target=previous.get(raw.id) || {},view=trackForPlayer(raw,sector,mp.playerId,mp.room.proposals);
      const presentation=Object.fromEntries(['labelOffset','labelSide','routeVisible','showGroundSpeed','showType'].filter(k=>Object.hasOwn(target,k)).map(k=>[k,target[k]]));
      const revision=(target.labelRevision || 0)+1;
      Object.assign(target,view,presentation,{labelRevision:revision});
      target.control.accSectors=state.air.airspaceIndex.accSectors;
      if(target.directTo)target.directTo={...target.directTo,plan:target.flightPlan};
      const [x,y]=state.map.project(target.lon,target.lat);target.x=x;target.y=y;
      bindInstructionTransport(target,(kind,value)=>{request('instruction',{trackId:target.id,kind,value}).catch(e=>notice(e.message));return true;});
      target.respondProposal=(proposalId,decision)=>request('proposal',{proposalId,decision}).catch(e=>notice(e.message));
      return target;
    });
    updateTrackMovement(state,0);
    if(before!==sector)state.bus.emit('sectorisation:changed');
  }
  function disconnected(message){
    mp.connected=false;mp.connecting=false;mp.room=null;mp.playerId=null;shared.clear();configKey='';
    for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(message));}pending.clear();
    if(local){Object.assign(state.air,local);local=null;state.bus.emit('sectorisation:changed');}
    notice(message);
  }
  mp.connect=async(mode,initials,code)=>{
    if(mp.connected || mp.connecting)throw Error('Already connected.');
    if(!state.air.airspaceIndex?.complete || !state.map.project)throw Error('Wait for the map to load.');
    mp.connecting=true;changed();
    const url=new URL('multiplayer',document.baseURI);url.protocol=location.protocol==='https:'?'wss:':'ws:';
    const socket=new WebSocket(url);mp.socket=socket;let endMessage='Disconnected from multiplayer.';
    socket.addEventListener('message',event=>{
      const message=JSON.parse(event.data);
      if(message.type==='welcome'){
        local={tracks:state.air.tracks,sectorisation:state.air.sectorisation,controlledSector:state.air.controlledSector,airspaceIndex:state.air.airspaceIndex};
        state.air.tracks=[];mp.playerId=message.playerId;mp.connected=true;mp.connecting=false;mp.message='Joined as observer. Choose an available sector.';
        history.replaceState(null,'','#room='+message.code);
      }else if(message.type==='state'){
        if(message.full)shared.clear();
        for(const id of message.removed)shared.delete(id);
        for(const {id,fields} of message.upserts)shared.set(id,Object.assign(shared.get(id) || {},fields));
        mp.room=message.room;redrawViews();changed();
      }else if(message.type==='ack'){
        const waiting=pending.get(message.id);if(waiting){clearTimeout(waiting.timer);pending.delete(message.id);message.error?waiting.reject(Error(message.error)):waiting.resolve();}
      }else if(message.type==='notice')notice(message.message);
      else if(message.type==='ended'){endMessage=message.message;socket.close();}
    });
    socket.addEventListener('close',()=>{if(mp.socket===socket)disconnected(endMessage);});
    try{
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{socket.close();reject(Error('Could not connect. Open the Render multiplayer address or run the server locally.'));},8000);
        socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
        socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Multiplayer server unavailable. Use the Render address.'));},{once:true});
      });
      await request(mode,{initials,code,protocol:1});
    }catch(error){socket.close();mp.connecting=false;notice(error.message);throw error;}
  };
  mp.command=(type,fields)=>request(type,fields);
  mp.leave=()=>{mp.socket?.close(1000,'Left room');history.replaceState(null,'',location.pathname+location.search);};
  mp.isHost=()=>mp.connected && mp.room?.hostId===mp.playerId;
  mp.notice=notice;
  return mp;
}
