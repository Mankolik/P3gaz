// A 1,000 ft/min change takes 20 seconds, including phase-boundary changes.
export const PERFORMANCE_RATE_CHANGE_FPM_PER_SECOND=50;

export function requestedVerticalRate(baseline,direction,assignment=null) {
  if(!Number.isFinite(baseline)||baseline<0)throw new Error('A vertical-rate baseline is required.');
  let magnitude=baseline;
  if(assignment && Number.isFinite(assignment.value)) {
    magnitude=Math.abs(assignment.value);
    if(magnitude!==0) {
      if(assignment.comparator==='or-greater')magnitude=Math.max(magnitude,baseline);
      else if(assignment.comparator==='or-less')magnitude=Math.min(magnitude,baseline);
    }
    if(direction>0)magnitude=Math.min(magnitude,Math.round(baseline*1.1));
  }
  return direction*magnitude;
}
