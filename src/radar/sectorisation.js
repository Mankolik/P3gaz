// Stable group IDs survive renaming; elementary volumes always have one owner.
export const SECTOR_CODES = [...'FGNEBDTCJR'];
export const ELEMENTARY_SECTORS = SECTOR_CODES.flatMap(code=>['LOW','HIGH'].map(layer=>`${code}:${layer}`));
const members=(codes,layer)=>[...codes].map(code=>`${code}:${layer}`);
export const SECTOR_PRESETS = Object.freeze({
  ALLFIR:ELEMENTARY_SECTORS,
  'ALLFIR L':members(SECTOR_CODES,'LOW'), 'ALLFIR H':members(SECTOR_CODES,'HIGH'),
  NFIR:[...members('FGNEBD','LOW'),...members('FGNEBD','HIGH')],
  'NFIR L':members('FGNEBD','LOW'), 'NFIR H':members('FGNBD','HIGH'),
  SFIR:[...members('TCJR','LOW'),...members('TCJR','HIGH')],
  'SFIR L':members('TCJR','LOW'), 'SFIR H':members('TCJRE','HIGH'),
});
const sameMembers=(a,b)=>a.length===b.length && a.every(id=>b.includes(id));
export function sectorName(ids){
  for(const [name,preset] of Object.entries(SECTOR_PRESETS))if(sameMembers(ids,preset))return name;
  const codes=layer=>SECTOR_CODES.filter(code=>ids.includes(`${code}:${layer}`)).join('');
  const low=codes('LOW'),high=codes('HIGH');
  return low && low===high ? `${low} L+H` : [low && `${low} L`,high && `${high} H`].filter(Boolean).join(' ');
}
export const createSectorisation=()=>({groups:[{id:'acc-1',members:[...ELEMENTARY_SECTORS]}],controlledId:'acc-1',nextId:2});
export const cloneSectorisation=config=>({...config,groups:config.groups.map(g=>({...g,members:[...g.members]}))});
export function validateSectorisation(config){
  if(!config?.groups?.length)throw Error('Create at least one sector.');
  const ids=new Set(),assigned=new Set();
  for(const group of config.groups){
    if(!group.id || ids.has(group.id) || !group.members?.length)throw Error('Every sector must contain at least one elementary volume.');
    ids.add(group.id);
    for(const member of group.members){
      if(!ELEMENTARY_SECTORS.includes(member) || assigned.has(member))throw Error('Each elementary volume must belong to exactly one sector.');
      assigned.add(member);
    }
  }
  if(assigned.size!==ELEMENTARY_SECTORS.length)throw Error('Assign all 20 elementary volumes.');
  if(!ids.has(config.controlledId))throw Error('Choose the sector you will control.');
  return true;
}
export function addSectorGroup(config){
  let id;
  do{id=`acc-${config.nextId++}`;}while(config.groups.some(g=>g.id===id));
  config.groups.push({id,members:[]});return id;
}
// Move selected volumes to a group; null releases each into its own sector.
export function moveSectorMembers(config,selected,destination){
  if(destination!=null && !config.groups.some(g=>g.id===destination))throw Error('Unknown destination sector.');
  const ids=[...new Set(selected)];
  if(ids.some(id=>!ELEMENTARY_SECTORS.includes(id)))throw Error('Unknown elementary volume.');
  for(const group of config.groups)group.members=group.members.filter(id=>!ids.includes(id));
  if(destination!=null)config.groups.find(g=>g.id===destination).members.push(...ids);
  else for(const id of ids){const groupId=addSectorGroup(config);config.groups.find(g=>g.id===groupId).members.push(id);}
  // Empty drafts may be created explicitly, but a emptied source disappears.
  config.groups=config.groups.filter(g=>g.members.length || g.id===destination);
  return config;
}
export function sectorAssignments(config){
  return new Map(config.groups.flatMap(g=>g.members.map(id=>[id,{id:g.id,name:sectorName(g.members)}])));
}
export function groupAirspace(index,config){
  const assignments=sectorAssignments(config);
  return {...index,accSectors:config.groups.map(g=>sectorName(g.members)),
    volumes:index.volumes.map(v=>v.kind==='ACC' ? {...v,designator:assignments.get(v.id)?.name || 'UNKNOWN',groupId:assignments.get(v.id)?.id} : v)};
}
