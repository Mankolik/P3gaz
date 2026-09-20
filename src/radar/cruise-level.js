export const CRUISE_FLIGHT_LEVELS={
  east:[190,210,230,250,270,290,310,330,350,370,390,410,450],
  west:[180,200,220,240,260,280,300,320,340,360,380,400,430],
};

export function cruiseLevelRange(distanceKm) {
  if(!Number.isFinite(distanceKm)||distanceKm<0)throw new Error('A cached route distance is required for ECL.');
  if(distanceKm<250)return [180,240];
  if(distanceKm<450)return [220,280];
  if(distanceKm<700)return [260,320];
  if(distanceKm<1000)return [280,340];
  if(distanceKm<1500)return [300,360];
  if(distanceKm<2200)return [320,380];
  if(distanceKm<=3500)return [340,400];
  return [350,410];
}

export function cruiseLevelTarget(distanceKm,random=Math.random) {
  const [min,max]=cruiseLevelRange(distanceKm),roll=random();
  if(!Number.isFinite(roll))throw new Error('Invalid cruise-level random draw.');
  // Modest variation around the midpoint: +/- FL020, enough to survive
  // snapping to either direction's 2,000-ft spacing.
  return Math.max(min,Math.min(max,(min+max)/2+(Math.max(0,Math.min(1,roll))*2-1)*20));
}

export function snapCruiseLevel(target,generalTrack,performance=null) {
  if(!Number.isFinite(target)||!Number.isFinite(generalTrack))throw new Error('Cruise target and general track are required.');
  const heading=((generalTrack%360)+360)%360;
  const limits=[performance?.ceilingFL,performance?.maxCruiseFL].filter(Number.isFinite);
  const ceiling=limits.length?Math.min(...limits):Infinity;
  const levels=CRUISE_FLIGHT_LEVELS[heading<180?'east':'west'].filter(level=>level<=ceiling);
  if(!levels.length)throw new Error('No directional cruise level below the aircraft ceiling.');
  const capped=Math.min(target,ceiling);
  // Stable lower-level tie break; filtering first preserves parity at the cap.
  return levels.reduce((best,level)=>Math.abs(level-capped)<Math.abs(best-capped)?level:best);
}

export function requestedCruiseLevel(group,performance=null,random=Math.random) {
  return snapCruiseLevel(cruiseLevelTarget(group.routeDistanceKm,random),group.generalTrack,performance);
}
