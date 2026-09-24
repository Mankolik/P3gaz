const lastChecks=new WeakMap();

export function removeFinishedTraffic(state,seconds=0){
  const boundary=state.air.firBoundary;
  const removed=[];
  state.air.tracks=state.air.tracks.filter(track=>{
    // Spawn at FL030 is not a landing. Arm only after arrival handoff.
    if(track.arrivalManaged && track.actualFlightLevel<=30.05){removed.push([track,'landed']);return false;}
    if(!boundary)return true;
    const clock=(lastChecks.get(track) || 0)+Math.max(0,seconds);
    if(clock<1 && track.hasBeenInsideFir!==undefined){lastChecks.set(track,clock);return true;}
    lastChecks.set(track,0);
    track.hasBeenInsideFir ||= false;
    if(boundary.contains(track)){track.hasBeenInsideFir=true;return true;}
    if(track.hasBeenInsideFir && boundary.distanceToEdge(track)>=60){removed.push([track,'left-fir']);return false;}
    return true;
  });
  for(const [track,reason] of removed)state.bus?.emit('track:removed',{track,reason});
  return removed;
}
