import { plannedRoutePoints } from '../../radar/planned-route.js';
import { radioCallsign } from '../../radar/radio-callsigns.js';
import { calculateAirSpeeds } from '../../utils/speed.js';

const three=value=>Number.isFinite(value) ? String(Math.round(value)).padStart(3,'0') : '---';
const heading=value=>Number.isFinite(value) ? `${three(((Math.round(value)%360)+360)%360)}º` : '---º';

export function extendedSectorSequence(track){
  const visits=track?.trajectory?.sequence || [];
  const current=visits.findIndex(visit=>!visit.skipped && visit.sector===track?.control?.owner);
  const next=visits.findIndex((visit,i)=>i>current && !visit.skipped);
  return visits.map((visit,i)=>{
    const level=visit.sector===(track.control?.sector || 'ALLFIR') ? track.exitFlightLevel
      : track.sectorExitLevels?.[visit.sector] ?? visit.targetLevel;
    return {text:`${visit.sector}/${three(level)}`,status:visit.skipped ? 'skipped'
      : i===current ? 'current' : i===next ? 'next' : 'later'};
  });
}

// Display actual values, not pending proposals or assigned speed targets.
export function extendedLabelData(track){
  if(!track)return null;
  const altitude=Number.isFinite(track.actualFlightLevel) ? track.actualFlightLevel*100 : null;
  const air=calculateAirSpeeds(track.groundSpeed,altitude,track.heading,track.wind);
  const squawk=String(track.squawk ?? '').trim();
  return {
    callsign:track.callsign || track.id || '---',rvsm:'W',spacing:'Y',radio:radioCallsign(track) || '---',
    transponder:`S/${/^[0-7]{1,4}$/.test(squawk) ? squawk.padStart(4,'0') : '----'}`,
    type:track.aircraftType || '----',wake:track.wake || '-',status:'',
    departure:track.departure || track.sourceRoute?.departure || '----',
    destination:track.destination || track.sourceRoute?.destination || '----',frequency:'XXX,XXX',
    rules:'I',route:plannedRoutePoints(track).slice(0,5).map(p=>p.name).join(' '),
    cfl:`CFL${three(track.clearedFlightLevel)}`,ecl:`ECL${three(track.expectedCruiseLevel)}`,
    freeText:'',selectedAltitude:`SEL ALT FL${three(track.clearedFlightLevel)}`,
    heading:`HDG ${heading(track.heading)}`,track:`TRK ${heading(track.heading)}`,
    ias:`IAS ${three(air?.ias)}`,mach:`MN ${air ? air.mach.toFixed(2) : '-.--'}`,
    gs:`GS ${three(Number.isFinite(track.groundSpeed) && track.groundSpeed>=0 ? track.groundSpeed : null)}`,
  };
}
