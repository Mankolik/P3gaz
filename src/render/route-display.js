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
export function drawTrackRoutes(ctx,camera,tracks,project,previewTrack=null,previewPoint=null){
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
    // The plan view shares the route line; crossing labels expose the
    // predicted vertical profile without replacing filed waypoint labels.
    if(track.trajectory){
      ctx.save();ctx.fillStyle='#8fdde8';ctx.strokeStyle='#8fdde8';
      for(const visit of track.trajectory.sequence.slice(1)){
        const [x,y]=project(visit.entry.lon,visit.entry.lat);
        ctx.strokeRect(x-4*scale,y-4*scale,8*scale,8*scale);
        ctx.fillText(`${visit.sector} FL${String(Math.round(visit.entry.level)).padStart(3,'0')}`,x+7*scale,y+10*scale);
      }
      ctx.restore();
    }
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
  // Add the proposed shortcut over the green route without changing navigation.
  if(previewTrack && tracks.includes(previewTrack) && validPoint(previewPoint)
    && Number.isFinite(previewTrack.x) && Number.isFinite(previewTrack.y)){
    const xy=project(previewPoint.lon,previewPoint.lat);
    if(xy && Number.isFinite(xy[0]) && Number.isFinite(xy[1])){
      ctx.strokeStyle='#00ffff';
      ctx.lineWidth=1.5*scale;
      ctx.beginPath();
      ctx.moveTo(previewTrack.x,previewTrack.y);
      ctx.lineTo(xy[0],xy[1]);
      ctx.stroke();
    }
  }
  ctx.restore();
}
