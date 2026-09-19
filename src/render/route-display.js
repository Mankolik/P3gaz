import { remainingPlanPoints, validPoint } from '../radar/routes.js';

// Show the remaining filed route on a heading, and the cleared route on a direct.
// Never reconnect an "end here" direct to the old flight plan.
export function routeDisplayPoints(track){
  const remaining=remainingPlanPoints(track);
  if(track?.navigationMode !== 'direct') return remaining;
  const direct=track.directTo;
  if(!validPoint(direct?.target)) return [];
  const points=[direct.target];
  if(direct.plan && direct.plan === track.flightPlan){
    if(Number.isInteger(direct.planIndex)){
      points.push(...remaining.filter(p=>p.index > direct.planIndex));
    }else if(Number.isInteger(direct.rejoinIndex)){
      points.push(...remaining.filter(p=>p.index >= direct.rejoinIndex));
    }
  }
  return points;
}

// Called in the map's world transform. Symbols and names keep a fixed CSS size.
export function drawTrackRoutes(ctx,camera,tracks,project,previewTrack=null){
  if(typeof project !== 'function') return;
  const scale=1/Math.max(camera.z || 1,1e-6);
  ctx.save();
  ctx.strokeStyle='#00ff55';
  ctx.fillStyle='#00ff55';
  ctx.lineWidth=1.5*scale;
  ctx.lineJoin='round';
  ctx.font=`${11*scale}px "Aldrich", "Courier New", monospace`;
  ctx.textAlign='left';
  ctx.textBaseline='middle';
  const names=new Set();
  for(const track of tracks){
    if(!track.routeVisible && track !== previewTrack) continue;
    if(!Number.isFinite(track.x) || !Number.isFinite(track.y)) continue;
    const fixes=[];
    ctx.beginPath();
    ctx.moveTo(track.x,track.y);
    for(const point of routeDisplayPoints(track)){
      // Stop at corrupt data rather than drawing a shortcut across a missing fix.
      if(!validPoint(point)) break;
      const xy=project(point.lon,point.lat);
      if(!xy || !Number.isFinite(xy[0]) || !Number.isFinite(xy[1])) break;
      const [x,y]=xy;
      ctx.lineTo(x,y);
      fixes.push({name:point.name,x,y});
    }
    ctx.stroke();
    for(const {name,x,y} of fixes){
      ctx.beginPath();
      ctx.arc(x,y,3*scale,0,Math.PI*2);
      ctx.fill();
      // Shared fixes across displayed routes need only one name.
      const key=`${name}:${x}:${y}`;
      if(names.has(key)) continue;
      names.add(key);
      ctx.save();
      ctx.strokeStyle='#020609';
      ctx.lineWidth=3*scale;
      ctx.strokeText(name,x+7*scale,y-7*scale);
      ctx.fillText(name,x+7*scale,y-7*scale);
      ctx.restore();
    }
  }
  ctx.restore();
}
