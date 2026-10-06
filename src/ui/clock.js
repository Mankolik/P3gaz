// Room time is authoritative: do not advance it locally while paused or
// extrapolate across delayed snapshots. Solo mode always uses real UTC.
export function clockText(multiplayer,now=Date.now()){
  let milliseconds=now;
  if(multiplayer?.connected){
    const elapsed=multiplayer.room?.time;
    if(!Number.isFinite(elapsed))return '--:--:--Z';
    milliseconds=(12*60*60+elapsed)*1000;
  }
  return new Date(milliseconds).toISOString().slice(11,19)+'Z';
}
