// Protocol 2: full state on join/resync, integer movement deltas thereafter.
// Simulation values are never rounded; only copies sent to browsers are.
export const PROTOCOL_VERSION=2;
export const MOVEMENT_FIELDS=['lon','lat','heading','groundSpeed','actualFlightLevel','verticalSpeed'];
export const MOVEMENT_SCALES=[1e6,1e6,100,100,1000,10];
const scales={lon:1e6,lat:1e6,heading:100,groundSpeed:100,actualFlightLevel:1000,
  verticalSpeed:10,level:1000,distanceNm:1000,timeSeconds:100};
const own=(value,key)=>Object.hasOwn(value,key);
const safeKey=key=>!['__proto__','prototype','constructor'].includes(key);

function wireValue(value,key){
  if(typeof value==='number')return Number.isFinite(value) ? (scales[key] ? Math.round(value*scales[key])/scales[key] : value) : null;
  if(Array.isArray(value))return value.map(item=>wireValue(item));
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value)
    .filter(([key,v])=>safeKey(key) && v!==undefined).map(([key,v])=>[key,wireValue(v,key)]));
  return value;
}

export function wireTrack(track){
  const {x,y,vector,vectorDx,vectorDy,sectorMembership,labelRevision,...copy}=track;
  if(track.control)copy.control={shared:true,sectorised:true,physical:track.control.physical,
    activeSector:track.control.activeSector,owner:track.control.owner,hasEnteredFir:track.control.hasEnteredFir,visit:track.control.visit};
  // Multiplayer renders sector crossings/levels; integration samples, exit
  // distances and prediction clocks are used only by the authoritative server.
  if(track.trajectory)copy.trajectory={complete:track.trajectory.complete,reason:track.trajectory.reason,
    sequence:track.trajectory.sequence.map(visit=>({sector:visit.sector,targetLevel:visit.targetLevel,
      skipped:visit.skipped,entry:{lon:visit.entry.lon,lat:visit.entry.lat,level:visit.entry.level}}))};
  if(track.directTo)copy.directTo={...track.directTo,plan:null};
  // Filed navigation coordinates must remain exact: DCT validates them against
  // the server catalogue. Quantise movement/prediction, not clearance inputs.
  const result=wireValue(copy);
  for(const key of ['flightPlan','directTo','navigationIntercept','sourceRoute']){
    if(copy[key]!==undefined)result[key]=structuredClone(copy[key]);
  }
  return result;
}

// [value] replaces a value, [] removes it, and an object patches only changed
// children. Equal-length arrays patch their indices; changed lengths replace.
export function createPatch(before,after){
  if(Object.is(before,after))return undefined;
  if(after===undefined)return [];
  if(!before || !after || typeof before!=='object' || typeof after!=='object'
    || Array.isArray(before)!==Array.isArray(after)
    || (Array.isArray(after) && before.length!==after.length))return [after];
  const patch={};
  for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
    if(!safeKey(key))continue;
    const child=createPatch(before[key],after[key]);
    if(child!==undefined)patch[key]=child;
  }
  return Object.keys(patch).length ? patch : undefined;
}

export function applyPatch(before,patch){
  if(Array.isArray(patch))return patch.length ? structuredClone(patch[0]) : undefined;
  const next=Array.isArray(before) ? before.slice() : {...before};
  for(const [key,child] of Object.entries(patch)){
    if(!safeKey(key))throw Error('Invalid state field.');
    const value=applyPatch(before?.[key],child);
    if(value===undefined)delete next[key];else next[key]=value;
  }
  return next;
}

export function movementDelta(before,after){
  let mask=0;const values=[];
  MOVEMENT_FIELDS.forEach((key,i)=>{
    if(Number.isFinite(before[key]) && Number.isFinite(after[key])){
      const delta=Math.round(after[key]*MOVEMENT_SCALES[i])-Math.round(before[key]*MOVEMENT_SCALES[i]);
      if(delta){mask|=1<<i;values.push(delta);}
    }
  });
  return mask ? [after.id,mask,...values] : null;
}

export function createStateReceiver(){
  const receiver={tracks:new Map(),room:null,sequence:null};
  receiver.reset=()=>{receiver.tracks.clear();receiver.room=null;receiver.sequence=null;};
  receiver.accept=message=>{
    if(message.protocol!==PROTOCOL_VERSION || !Number.isSafeInteger(message.sequence))throw Error('Refresh the page to use the current multiplayer version.');
    if(!message.full && message.sequence!==receiver.sequence+1)return false;
    if(!message.full && receiver.sequence===null)return false;
    const tracks=message.full ? new Map() : new Map(receiver.tracks);
    for(const id of message.removed)tracks.delete(id);
    for(const update of message.upserts){
      if(own(update,'fields'))tracks.set(update.id,structuredClone(update.fields));
      else{
        if(!tracks.has(update.id))return false;
        tracks.set(update.id,applyPatch(tracks.get(update.id),update.patch));
      }
    }
    for(const [id,mask,...values] of message.movement || []){
      const prior=tracks.get(id);if(!prior)return false;
      const next={...prior};let j=0;
      MOVEMENT_FIELDS.forEach((key,i)=>{
        if(mask & (1<<i))next[key]=(Math.round(prior[key]*MOVEMENT_SCALES[i])+values[j++])/MOVEMENT_SCALES[i];
      });
      tracks.set(id,next);
    }
    const room=message.full ? structuredClone(message.room) : message.roomPatch ? applyPatch(receiver.room,message.roomPatch) : receiver.room;
    receiver.tracks.clear();for(const [id,track] of tracks)receiver.tracks.set(id,track);
    receiver.room=room;receiver.sequence=message.sequence;
    return true;
  };
  return receiver;
}
