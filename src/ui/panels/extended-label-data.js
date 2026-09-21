import { plannedRoutePoints } from '../../radar/planned-route.js';
import { radioCallsign } from '../../radar/radio-callsigns.js';
import { calculateAirSpeeds } from '../../utils/speed.js';
import { TMA_DESIGNATORS } from '../../radar/airspace.js';

const three=value=>Number.isFinite(value) ? String(Math.round(value)).padStart(3,'0') : '---';
const heading=value=>Number.isFinite(value) ? `${three(((Math.round(value)%360)+360)%360)}°` : '---°';
const epwwSectors=new Set(['ALLFIR','FIS',...Object.values(TMA_DESIGNATORS)]);

export function extendedSectorSequence(track){
  const visits=track?.trajectory?.sequence || [];
  const current=visits.findIndex(visit=>!visit.skipped && visit.sector===track?.control?.owner);
  const next=visits.findIndex((visit,i)=>i>current && !visit.skipped);
  let reachedEpww=!!(track?.control?.hasEnteredFir || track?.control?.hasEntered);
  return visits.map((visit,i)=>{
    const domestic=epwwSectors.has(visit.sector);
    if(domestic)reachedEpww=true;
    const level=visit.sector===(track.control?.sector || 'ALLFIR') ? track.exitFlightLevel
      : track.sectorExitLevels?.[visit.sector] ?? visit.targetLevel;
    return {text:domestic || !reachedEpww ? `${visit.sector}/${three(level)}` : visit.sector,status:visit.skipped ? 'skipped'
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
    callsign:track.callsign || track.id || '---',capabilities:'WY',radio:radioCallsign(track).replace(/\s+(?=\d[A-Z0-9]*$)/,'') || '---',
    transponder:`S/${/^[0-7]{1,4}$/.test(squawk) ? squawk.padStart(4,'0') : '----'}`,
    aircraft:`${track.aircraftType || '----'}/${track.wake || '-'}`,status:'',
    departure:track.departure || track.sourceRoute?.departure || '----',
    destination:track.destination || track.sourceRoute?.destination || '----',frequency:'XXX,XXX',
    rules:'I',route:plannedRoutePoints(track).slice(0,5).map(p=>p.name).join(' '),
    cfl:`CFL${three(track.clearedFlightLevel)}`,ecl:`ECL${three(track.expectedCruiseLevel)}`,
    freeText:'',selectedAltitude:`FL${three(track.clearedFlightLevel)}`,
    heading:heading(track.heading),track:heading(track.heading),
    ias:three(air?.ias),mach:air ? air.mach.toFixed(2) : '-.--',
    gs:three(Number.isFinite(track.groundSpeed) && track.groundSpeed>=0 ? track.groundSpeed : null),
  };
}
