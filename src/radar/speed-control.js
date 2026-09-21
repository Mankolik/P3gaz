import { aircraftPerformance, performanceSchedule } from './performance.js';

// The supplied schedule changes speed mode at FL240, rather than using a
// calculated aerodynamic crossover. Rate phase boundaries stay independent.
export const SPEED_CONVERSION_FL = 240;
export const speedMode = track => track.actualFlightLevel>=SPEED_CONVERSION_FL ? 'Mach' : 'IAS';

export function speedLimits(track, mode){
  const profile=aircraftPerformance(track.aircraftType);
  // IAS restrictions wait above conversion; this floor only applies when
  // IAS is active. Mach limits are independent of MCS at every altitude.
  if(mode!=='Mach') return {min:profile ? profile.minimumCleanSpeedKnots-25 : 120,max:480};
  if(!profile) return {min:0.3,max:0.9};
  return {
    min:Number((profile.cruise.mach-0.05).toFixed(2)),
    max:Number((profile.cruise.mach+0.01).toFixed(2)),
  };
}

export function limitSpeedInstruction(track, instruction){
  if(!Number.isFinite(instruction?.value)) return instruction;
  const limits=speedLimits(track,instruction.mode);
  return {...instruction,value:Math.min(limits.max,Math.max(limits.min,instruction.value))};
}

export function effectiveSpeedInstruction(track, schedule=performanceSchedule(track)){
  const assigned=Number.isFinite(track.assignedSpeed?.value) ? track.assignedSpeed : null;
  if(!schedule) return assigned;
  const mode=speedMode(track);
  let baseline=schedule.speed;
  // Exactly FL240 belongs to Mach, including during a descent.
  if(baseline.mode!==mode){
    baseline={mode,value:aircraftPerformance(track.aircraftType).initialDescent.speed.value};
  }
  return limitSpeedInstruction(track,assigned?.mode===mode ? assigned : baseline);
}
