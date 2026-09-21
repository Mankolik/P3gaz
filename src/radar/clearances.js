import { aircraftCeiling, aircraftPerformance } from './performance.js';

// Rejected instructions never replace the level used by movement/navigation.
export function assignClearedLevel(track, level){
  if(level!=null && !Number.isFinite(level)) return false;
  const unable = level!=null && level>aircraftCeiling(track);
  track.unableCfl = unable ? level : null;
  if(!unable) track.clearedFlightLevel = level;
  track.labelRevision = (track.labelRevision || 0) + 1;
  return !unable;
}

export function assignVerticalRate(track, assignment){
  track.assignedVertical = assignment;
  track.verticalRateAssigned = assignment!=null;
  track.unableVerticalRate = false;
  const profile = aircraftPerformance(track.aircraftType);
  const level = track.actualFlightLevel;
  // CFL determines direction in the movement model. At level flight, use
  // the requested sign so a climb instruction can be checked before a CFL.
  const target = track.clearedFlightLevel ?? level;
  const climbing = target>level+0.05 || (Math.abs(target-level)<=0.05 && assignment?.value>0);
  if(profile && Number.isFinite(level) && climbing && assignment?.comparator!=='or-less'){
    const phase = level<50 ? 'initialClimb' : level<150 ? 'climb150' : level<240 ? 'climb240' : 'machClimb';
    track.unableVerticalRate = Math.abs(assignment?.value)>profile[phase].rateFpm*1.3;
  }
  // The response is to this instruction, not regenerated on every tick.
  track.labelRevision = (track.labelRevision || 0) + 1;
}
