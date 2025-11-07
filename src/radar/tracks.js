import { parseSpeedInstruction } from '../utils/speed.js';

const KNOWN_TRACK_STATUSES = new Set([
  'accepted',
  'inbound',
  'preinbound',
  'intruder',
  'unconcerned',
]);

function normalizeHeading(heading){
  if(heading==null || Number.isNaN(heading)) return 0;
  return ((heading % 360) + 360) % 360;
}

function baseTrack(data, project, index){
  const id = data.id || `track-${index+1}`;
  const heading = normalizeHeading(data.heading);
  const vectorScale = data.vectorScale || 8;
  const vectorMinutes = data.vectorMinutes || 6;
  const status = KNOWN_TRACK_STATUSES.has(data.status) ? data.status : 'accepted';
  const speedInstruction = parseSpeedInstruction(data.assignedSpeed, data.speedMode || data.speedInstructionMode || 'IAS');
  const base = {
    id,
    callsign: data.callsign || id.toUpperCase(),
    status,
    lat: data.lat,
    lon: data.lon,
    heading,
    vectorScale,
    vectorMinutes,
    symbolSize: data.symbolSize || 18,
    groundSpeed: data.groundSpeed,
    verticalSpeed: data.verticalSpeed,
    actualFlightLevel: data.actualFlightLevel,
    clearedFlightLevel: data.clearedFlightLevel,
    plannedEntryLevel: data.plannedEntryLevel,
    exitFlightLevel: data.exitFlightLevel,
    levelMode: data.levelMode || 'cfl',
    aircraftType: data.aircraftType,
    squawk: data.squawk,
    wake: data.wake,
    destination: data.destination,
    exitPoint: data.exitPoint,
    assignedHeading: data.assignedHeading,
    assignedSpeed: speedInstruction,
    verticalRateAssigned: data.verticalRateAssigned || false,
    assignedVertical: data.assignedVertical ?? null,
    expectedCruiseLevel: data.expectedCruiseLevel,
    alerts: data.alerts || [],
    labelSide: data.labelSide,
    labelOffset: data.labelOffset,
    showGroundSpeed: true,
    showType: true,
  };
  if(typeof project === 'function' && data.lon!=null && data.lat!=null){
    const [x,y] = project(data.lon, data.lat) || [0,0];
    base.x = x;
    base.y = y;
  }else{
    base.x = data.x ?? 0;
    base.y = data.y ?? 0;
  }
  return base;
}

export function createDemoTracks(project){
  const tracks = [
    {
      id: 'WZZ1891',
      callsign: 'WZZ1891',
      status: 'accepted',
      lat: 52.165,
      lon: 20.967,
      heading: 278,
      vectorMinutes: 7,
      groundSpeed: 451,
      verticalSpeed: 0,
      actualFlightLevel: 380,
      clearedFlightLevel: 380,
      exitFlightLevel: 380,
      levelMode: 'cfl',
      aircraftType: 'A21N',
      squawk: '4632',
      wake: 'M',
      destination: 'EPKK',
      assignedHeading: 354,
      assignedSpeed: 'N25',
      verticalRateAssigned: true,
      expectedCruiseLevel: 380,
      labelSide: 'right',
    },
    {
      id: 'LOT612',
      callsign: 'LOT612',
      status: 'preinbound',
      lat: 54.377,
      lon: 18.466,
      heading: 186,
      vectorMinutes: 5,
      groundSpeed: 320,
      verticalSpeed: -14,
      actualFlightLevel: 140,
      plannedEntryLevel: 180,
      exitFlightLevel: 220,
      levelMode: 'pel',
      aircraftType: 'E75L',
      squawk: '4132',
      wake: 'M',
      destination: 'EPWA',
      exitPoint: 'DOSAP',
      assignedHeading: null,
      assignedSpeed: null,
      verticalRateAssigned: false,
      expectedCruiseLevel: 220,
      labelSide: 'left',
      labelOffset: { x: 82, y: -40 },
    },
    {
      id: 'RYR9021',
      callsign: 'RYR9021',
      status: 'intruder',
      lat: 50.072,
      lon: 19.79,
      heading: 42,
      vectorMinutes: 6,
      groundSpeed: 482,
      verticalSpeed: 0,
      actualFlightLevel: 330,
      clearedFlightLevel: 360,
      exitFlightLevel: 360,
      aircraftType: 'B738',
      squawk: '7001',
      wake: 'M',
      destination: 'EPGD',
      assignedHeading: 20,
      assignedSpeed: 'N28',
      verticalRateAssigned: false,
      expectedCruiseLevel: 360,
      alerts: ['INTRUDER'],
      labelSide: 'right',
      labelOffset: { x: 88, y: -48 },
    },
    {
      id: 'SAS442',
      callsign: 'SAS442',
      status: 'inbound',
      lat: 52.4,
      lon: 16.83,
      heading: 122,
      vectorMinutes: 8,
      groundSpeed: 410,
      verticalSpeed: 5,
      actualFlightLevel: 240,
      plannedEntryLevel: 230,
      clearedFlightLevel: 260,
      exitFlightLevel: 260,
      aircraftType: 'CRJ9',
      squawk: '4521',
      wake: 'M',
      destination: 'ESSA',
      assignedHeading: 118,
      assignedSpeed: 'N23',
      verticalRateAssigned: true,
      expectedCruiseLevel: 260,
      labelSide: 'left',
    },
    {
      id: 'BAW77',
      callsign: 'BAW77',
      status: 'accepted',
      lat: 53.4,
      lon: 14.5,
      heading: 302,
      vectorMinutes: 9,
      groundSpeed: 430,
      verticalSpeed: -8,
      actualFlightLevel: 280,
      clearedFlightLevel: 290,
      exitFlightLevel: 310,
      aircraftType: 'B789',
      squawk: '6234',
      wake: 'H',
      exitPoint: 'MABUR',
      assignedHeading: 302,
      assignedSpeed: 'M78',
      verticalRateAssigned: true,
      expectedCruiseLevel: 310,
      labelSide: 'right',
    },
  ];

  return tracks.map((data, index)=>baseTrack(data, project, index));
}
