export const MIN_SECTOR_VISIT_NM=3;

// Only a known exit establishes the length of a visit. A route ending inside
// a sector is not evidence that the aircraft will leave that sector shortly.
export function filterSectorSequence(raw,control=null){
  const sequence=[],omitted=[];
  for(let i=0;i<raw.length;i++){
    const visit=raw[i];
    const established=i===0 && (!control?.activeSector || control.retainPhysicalVisit
      || control.activeSector===visit.sector);
    const short=visit.exit && visit.exit.distanceNm-visit.entry.distanceNm<=MIN_SECTOR_VISIT_NM+1e-6;
    if(short && !established){
      omitted.push(visit);
      if(i===0 && control?.activeSector)sequence.push({sector:control.activeSector,
        entry:visit.entry,exit:visit.exit,targetLevel:control.computerTargetLevel ?? visit.entry.level});
      continue;
    }
    const previous=sequence.at(-1);
    if(previous?.sector===visit.sector){
      // A short excursion into another volume must not create a re-entry or
      // move the next meaningful boundary to that excursion's entrance.
      previous.exit=visit.exit;previous.end=visit.end;
    }else sequence.push({...visit});
  }
  return {sequence,omitted};
}
