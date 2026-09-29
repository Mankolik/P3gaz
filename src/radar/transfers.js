// Manual transfer of control. A pending transfer lives on track.control:
//   {from,to,directional,initiator:'computer'|'controller',due}
// Human controllers must accept every transfer addressed to them; computer
// sectors accept after COMPUTER_ACCEPT_SECONDS.
export const COMPUTER_ACCEPT_SECONDS=3;

const transports=new WeakMap();
export const bindTransferTransport=(track,handler)=>transports.set(track,handler);

const touched=track=>{track.labelRevision=(track.labelRevision || 0)+1;};
const usable=sector=>!!sector && sector!=='UNKNOWN';

// The sector after the owner's visit, or the current sector once the owner's
// airspace has been left.
export function nextTransferSector(track,owner=track.control?.owner){
  const sequence=track.trajectory?.sequence || [],index=sequence.findIndex(v=>v.sector===owner);
  const next=index>=0 ? sequence[index+1]?.sector : sequence[0]?.sector;
  return usable(next) && next!==owner ? next : null;
}

export function offerTransfer(track,to,{directional=false,initiator='computer',human=()=>false}={}){
  const c=track.control;
  if(!c || !usable(to) || to===c.owner)return false;
  if(c.transfer?.to===to && c.transfer.from===c.owner)return true;
  c.transfer={from:c.owner,to,directional,initiator,due:human(to) ? null : c.time+COMPUTER_ACCEPT_SECONDS};
  touched(track);
  return true;
}

export function completeTransfer(track){
  const c=track.control,t=c?.transfer;
  if(!t)return false;
  c.owner=t.to;c.sentTo=null;c.transfer=null;c.rejected=null;
  touched(track);
  return true;
}

export function rejectTransfer(track){
  const c=track.control,t=c?.transfer;
  if(!t)return false;
  // A computer re-offers only on the aircraft's next sector visit.
  c.rejected={to:t.to,visit:c.visit};c.transfer=null;
  touched(track);
  return true;
}

export function cancelTransfer(track){
  if(!track.control?.transfer)return false;
  track.control.transfer=null;touched(track);
  return true;
}

export const transferRejected=(track,to)=>track.control?.rejected?.to===to && track.control.rejected.visit===track.control.visit;

// Drop obsolete offers and let computer receivers accept after their delay.
export function advanceTransfer(track,human){
  const c=track.control,t=c?.transfer;
  if(!t)return;
  if(c.owner!==t.from || t.to===c.owner){cancelTransfer(track);return;}
  if(human(t.to)){if(t.due!=null){t.due=null;touched(track);}return;}
  t.due ??= c.time+COMPUTER_ACCEPT_SECONDS;
  if(c.time+1e-8>=t.due)completeTransfer(track);
}

// Single-player actions; multiplayer tracks forward them to the server.
export function requestTransfer(track,action,sector=null){
  if(transports.has(track))return transports.get(track)(action,sector);
  const c=track.control,me=c?.sector,human=s=>s===me;
  if(!c || !me)return false;
  if(action==='transfer' || action==='directional'){
    if(c.owner!==me || c.transfer)return false;
    const to=action==='transfer' ? nextTransferSector(track) : sector;
    if(action==='directional' && !(c.humanSectors || []).includes(to))return false;
    return offerTransfer(track,to,{directional:action==='directional',initiator:'controller',human});
  }
  if(action==='accept' || action==='reject'){
    if(c.transfer?.to!==me)return false;
    return action==='accept' ? completeTransfer(track) : rejectTransfer(track);
  }
  if(action==='undo'){
    if(c.transfer?.from!==me || c.transfer.initiator!=='controller')return false;
    return cancelTransfer(track);
  }
  return false;
}

// What the label menu may offer the viewing controller.
export function transferMenu(track){
  const c=track.control,me=c?.sector,t=c?.transfer;
  if(!c || !me || c.readOnly)return {kind:'none'};
  if(t?.to===me)return {kind:'incoming',from:t.from,directional:t.directional};
  if(c.owner!==me)return {kind:'none'};
  if(t)return {kind:'outgoing',to:t.to,directional:t.directional,undo:t.initiator==='controller'};
  return {kind:'owned',next:nextTransferSector(track),directional:(c.humanSectors || []).filter(s=>s!==me)};
}
