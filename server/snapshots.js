import { PROTOCOL_VERSION, MOVEMENT_FIELDS, wireTrack, createPatch, movementDelta } from '../src/multiplayer/protocol.js';

export class SnapshotStream {
  constructor(){this.tracks=new Map();this.room=null;this.sequence=0;}
  capture(room,full=false){
    const next=new Map(),upserts=[],movement=[];
    for(const track of room.state.air.tracks){
      const fields=wireTrack(track),prior=this.tracks.get(track.id);
      next.set(track.id,fields);
      if(full || !prior){upserts.push({id:track.id,fields});continue;}
      const row=movementDelta(prior,fields);if(row)movement.push(row);
      const patch=createPatch(prior,fields);
      if(patch){
        for(const key of MOVEMENT_FIELDS)if(Number.isFinite(prior[key]) && Number.isFinite(fields[key]))delete patch[key];
        if(Object.keys(patch).length)upserts.push({id:track.id,patch});
      }
    }
    const removed=full ? [] : [...this.tracks.keys()].filter(id=>!next.has(id));
    const metadata=structuredClone(room.metadata()),roomPatch=createPatch(this.room,metadata);
    if(!full && !upserts.length && !movement.length && !removed.length && !roomPatch)return null;
    const message={type:'state',protocol:PROTOCOL_VERSION,full,sequence:full?this.sequence:++this.sequence,upserts,removed};
    if(full)message.room=metadata;
    else{
      if(movement.length)message.movement=movement;
      if(roomPatch)message.roomPatch=roomPatch;
      this.tracks=next;this.room=metadata;
    }
    return message;
  }
}
