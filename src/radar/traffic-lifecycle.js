const lastChecks=new WeakMap();

export function removeFinishedTraffic(state,seconds=0){
  const boundary=state.air.firBoundary;
  const removed=[];
  state.air.tracks=state.air.tracks.filter(track=>{
    const human=sector=>state.air.shared ? state.air.humanSectors?.has(sector)
      : sector===(state.air.controlledSector || 'ALLFIR');
    // Cleanup must not bypass manual ownership or a player's pending offer.
    const retained=human(track.control?.owner) || human(track.control?.transfer?.to);
    // Spawn at FL030 is not a landing. Arm only after arrival handoff.
    if(!retained && track.arrivalManaged && track.actualFlightLevel<=30.05){removed.push([track,'landed']);return false;}
    if(!boundary)return true;
    const clock=(lastChecks.get(track) || 0)+Math.max(0,seconds);
    if(clock<1 && track.hasBeenInsideFir!==undefined){lastChecks.set(track,clock);return true;}
    lastChecks.set(track,0);
    track.hasBeenInsideFir ||= false;
    if(boundary.contains(track)){track.hasBeenInsideFir=true;return true;}
    if(retained)return true;
    if(track.hasBeenInsideFir && boundary.distanceToEdge(track)>=60){removed.push([track,'left-fir']);return false;}
    return true;
  });
  for(const [track,reason] of removed)state.bus?.emit('track:removed',{track,reason});
  return removed;
}
