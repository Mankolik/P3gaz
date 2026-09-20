import {AIRCRAFT_PERFORMANCE} from '../data/aircraft-performance.js';

export function aircraftPerformance(type) {
  return AIRCRAFT_PERFORMANCE[String(type||'').toUpperCase()] || null;
}

export function aircraftCeiling(track) {
  return aircraftPerformance(track?.aircraftType)?.ceilingFL ?? 600;
}

export function performanceSchedule(track) {
  const profile=aircraftPerformance(track?.aircraftType);
  if(!profile || !Number.isFinite(track.actualFlightLevel))return null;
  const level=track.actualFlightLevel;
  const target=Math.min(Number.isFinite(track.clearedFlightLevel)?track.clearedFlightLevel:level,profile.ceilingFL);
  const climbing=target-level>0.05,descending=level-target>0.05;
  // A low-altitude level-off after descent keeps the descent/approach speed.
  const descent=descending || (!climbing && level<240 && ['initialDescent','descent100','approach'].includes(track.performancePhase));
  let phase;
  if(descent)phase=level>240?'initialDescent':level>100?'descent100':'approach';
  else if(!climbing && level>=240)phase='cruise';
  else phase=level<50?'initialClimb':level<150?'climb150':level<240?'climb240':'machClimb';
  if(phase==='cruise')return {phase,speed:{mode:'Mach',value:profile.cruise.mach},rateFpm:0};
  return {phase,speed:profile[phase].speed,rateFpm:profile[phase].rateFpm};
}
