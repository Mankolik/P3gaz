import { statusForSector } from '../radar/traffic-control.js';
import { sectorName } from '../radar/sectorisation.js';

export function playerSector(room,playerId){
  const groupId=room.players.find(p=>p.id===playerId)?.sectorId;
  const group=room.config.groups.find(g=>g.id===groupId);
  return group ? sectorName(group.members) : null;
}
export function trackForPlayer(track,sector,playerId,proposals=[]){
  const sequence=track.trajectory?.sequence || [],entry=sequence.findIndex(v=>v.sector===sector);
  const preceding=entry>0 ? sequence[entry-1] : null;
  const own=sector && track.control?.owner===sector;
  const outgoing={},incoming=[];
  for(const p of proposals.filter(p=>p.trackId===track.id)){
    if(p.sender===playerId)outgoing[p.key]=p;
    else if(p.recipient===playerId)incoming.push(p);
  }
  return {...track,status:sector ? statusForSector(track,sector) : 'unconcerned',
    exitFlightLevel:sector ? track.sectorExitLevels?.[sector] ?? null : null,
    plannedEntryLevel:preceding ? track.sectorExitLevels?.[preceding.sector] ?? preceding.targetLevel : null,
    control:{...track.control,sector,readOnly:!sector,pending:outgoing,incoming},
    multiplayer:true,canControl:!!own};
}
