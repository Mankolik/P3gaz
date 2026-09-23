import { sectorName } from '../../radar/sectorisation.js';

export function mountMultiplayerPanel(root,state){
  const mp=state.multiplayer;if(!mp)return;
  const node=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
  const button=node('button','Multiplayer');button.className='textbtn sectorisation-trigger';root.append(button);
  const dialog=node('dialog');dialog.className='multiplayer-panel';dialog.setAttribute('aria-label','Multiplayer');document.body.append(dialog);
  const title=node('h2','Multiplayer'),login=node('div'),initials=node('input'),code=node('input');
  initials.setAttribute('aria-label','Initials');initials.placeholder='Your initials';initials.maxLength=4;
  initials.value=localStorage.getItem('p3gaz-initials') || '';
  code.setAttribute('aria-label','Room code');code.placeholder='Room code';code.maxLength=8;
  code.value=new URLSearchParams(location.hash.slice(1)).get('room') || '';
  const action=(text,handler)=>{const b=node('button',text);b.type='button';b.onclick=async()=>{try{await handler();}catch(e){mp.notice(e.message);}};return b;};
  const connect=mode=>{localStorage.setItem('p3gaz-initials',initials.value.trim().toUpperCase());return mp.connect(mode,initials.value,code.value.trim().toUpperCase());};
  const create=action('Create room',()=>connect('create')),join=action('Join room',()=>connect('join'));
  login.append(node('p','Join as an observer, then choose a free sector. Up to ten players per room.'),initials,code,create,join);
  const room=node('div'),heading=node('h3'),link=node('input');link.readOnly=true;link.setAttribute('aria-label','Invitation link');
  const copy=action('Copy invitation',async()=>{try{await navigator.clipboard.writeText(link.value);mp.notice('Invitation copied.');}catch{link.focus();link.select();mp.notice('Copy the selected invitation link.');}});
  const sector=node('select');sector.setAttribute('aria-label','Your sector');sector.onchange=()=>mp.command('claim',{sectorId:sector.value || null}).catch(e=>mp.notice(e.message));
  const players=node('div');players.className='multiplayer-players';
  const host=node('div'),pause=action('Pause',()=>mp.command('simulation',{paused:!mp.room.paused,speed:mp.room.speed})),speed=node('select');
  speed.setAttribute('aria-label','Simulation speed');for(const value of [1,2,4]){const o=node('option',`${value}×`);o.value=value;speed.append(o);}
  speed.onchange=()=>mp.command('simulation',{paused:mp.room.paused,speed:Number(speed.value)}).catch(e=>mp.notice(e.message));
  const aircraft=node('select');aircraft.setAttribute('aria-label','Aircraft to remove');
  host.append(pause,speed,aircraft,action('Remove aircraft',()=>mp.command('delete',{trackId:aircraft.value})));
  room.append(heading,link,copy,node('p','Your sector'),sector,players,host,action('Leave room',()=>mp.leave()));
  const message=node('p');message.className='multiplayer-message';
  dialog.append(title,login,room,message,action('Close',()=>dialog.close()));
  const toast=node('div');toast.className='multiplayer-toast';toast.hidden=true;document.body.append(toast);let lastMessage='',timer,lastKey='';
  function render(){
    login.hidden=mp.connected;room.hidden=!mp.connected;
    create.disabled=join.disabled=mp.connecting;message.textContent=mp.message;
    button.textContent=mp.connected?`Room ${mp.room?.code || ''}`:'Multiplayer';
    if(mp.message!==lastMessage){lastMessage=mp.message;if(lastMessage){toast.textContent=lastMessage;toast.hidden=false;clearTimeout(timer);timer=setTimeout(()=>{toast.hidden=true;},6500);}}
    if(!mp.room)return;
    const key=JSON.stringify([mp.room.code,mp.room.players,mp.room.config,mp.room.paused,mp.room.speed,state.air.tracks.map(t=>[t.id,t.callsign])]);
    if(key===lastKey)return;lastKey=key;
    heading.textContent=`Room ${mp.room.code}`;link.value=location.origin+location.pathname+'#room='+mp.room.code;
    const me=mp.room.players.find(p=>p.id===mp.playerId);sector.replaceChildren();
    const observer=node('option','Observer · no sector');observer.value='';sector.append(observer);
    for(const group of mp.room.config.groups){
      const occupant=mp.room.players.find(p=>p.sectorId===group.id),o=node('option',sectorName(group.members)+(occupant?` · ${occupant.initials}`:' · available'));
      o.value=group.id;o.disabled=!!occupant && occupant.id!==mp.playerId;sector.append(o);
    }
    sector.value=me?.sectorId || '';
    players.replaceChildren(...mp.room.players.map(p=>node('p',`${p.initials}${p.id===mp.room.hostId?' (host)':''} — ${sectorName(mp.room.config.groups.find(g=>g.id===p.sectorId)?.members || []) || 'Observer'}`)));
    host.hidden=!mp.isHost();pause.textContent=mp.room.paused?'Resume':'Pause';speed.value=mp.room.speed;
    const selected=aircraft.value;aircraft.replaceChildren(...state.air.tracks.map(t=>{const o=node('option',t.callsign);o.value=t.id;return o;}));
    if([...aircraft.options].some(o=>o.value===selected))aircraft.value=selected;
  }
  button.onclick=()=>{render();dialog.showModal();};state.bus.on('multiplayer:changed',render);render();
  if(code.value){dialog.showModal();initials.focus();}
}
