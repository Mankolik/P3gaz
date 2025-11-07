const ISA = {
  T0: 288.15, // sea level standard temperature (K)
  P0: 101325, // sea level standard pressure (Pa)
  RHO0: 1.225, // sea level standard density (kg/m^3)
  L: 0.0065, // temperature lapse rate (K/m)
  G: 9.80665, // gravity (m/s^2)
  R: 287.058, // specific gas constant for air (J/(kg·K))
  GAMMA: 1.4,
};

const KNOT_TO_MS = 0.514444;
const MS_TO_KNOT = 1 / KNOT_TO_MS;
const FT_TO_M = 0.3048;

function clamp(value, min, max){
  if(!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function temperatureAtAltitude(altMeters){
  if(!Number.isFinite(altMeters) || altMeters < 0){
    return ISA.T0;
  }
  if(altMeters <= 11000){
    return ISA.T0 - ISA.L * altMeters;
  }
  const tempAt11km = ISA.T0 - ISA.L * 11000;
  return tempAt11km;
}

function pressureAtAltitude(altMeters){
  if(!Number.isFinite(altMeters) || altMeters < 0){
    return ISA.P0;
  }
  if(altMeters <= 11000){
    const ratio = 1 - (ISA.L * altMeters) / ISA.T0;
    return ISA.P0 * Math.pow(ratio, (ISA.G / (ISA.R * ISA.L)));
  }
  const pressureAt11km = ISA.P0 * Math.pow(1 - (ISA.L * 11000) / ISA.T0, (ISA.G / (ISA.R * ISA.L)));
  const tempAt11km = ISA.T0 - ISA.L * 11000;
  return pressureAt11km * Math.exp((-ISA.G * (altMeters - 11000)) / (ISA.R * tempAt11km));
}

function densityAtAltitude(altMeters){
  const temp = temperatureAtAltitude(altMeters);
  const pressure = pressureAtAltitude(altMeters);
  if(temp <= 0) return ISA.RHO0;
  return pressure / (ISA.R * temp);
}

function normalizeHeading(heading){
  if(heading==null || Number.isNaN(heading)) return 0;
  return ((heading % 360) + 360) % 360;
}

function headingToRad(heading){
  return normalizeHeading(heading) * Math.PI / 180;
}

export function convertIasToTas(iasKnots, altitudeFt){
  const ias = Number(iasKnots);
  if(!Number.isFinite(ias) || ias <= 0){
    return 0;
  }
  const altitudeMeters = clamp(Number(altitudeFt) || 0, 0, 60000) * FT_TO_M;
  const density = densityAtAltitude(altitudeMeters);
  const tasMs = ias * KNOT_TO_MS * Math.sqrt(ISA.RHO0 / density);
  return tasMs * MS_TO_KNOT;
}

export function convertMachToTas(mach, altitudeFt){
  const m = Number(mach);
  if(!Number.isFinite(m) || m <= 0){
    return 0;
  }
  const altitudeMeters = clamp(Number(altitudeFt) || 0, 0, 60000) * FT_TO_M;
  const temp = temperatureAtAltitude(altitudeMeters);
  const speedOfSound = Math.sqrt(ISA.GAMMA * ISA.R * temp);
  return m * speedOfSound * MS_TO_KNOT;
}

export function parseSpeedInstruction(input, defaultMode='IAS'){
  const modeHint = (defaultMode || 'IAS').toUpperCase() === 'MACH' ? 'Mach' : (defaultMode || 'IAS').toUpperCase() === 'MN' ? 'Mach' : 'IAS';
  if(input && typeof input === 'object' && !Array.isArray(input)){
    const modeRaw = input.mode || modeHint;
    const normalizedMode = String(modeRaw).toUpperCase().startsWith('M') ? 'Mach' : 'IAS';
    const rawValue = input.value;
    const value = Number.isFinite(rawValue) ? Number(rawValue) : null;
    return { mode: normalizedMode, value };
  }
  if(typeof input === 'string'){
    const trimmed = input.trim().toUpperCase();
    if(!trimmed){
      return { mode: modeHint, value: null };
    }
    if(trimmed.startsWith('M')){
      const digits = parseFloat(trimmed.slice(1).replace(/[^0-9.]/g, ''));
      if(Number.isNaN(digits)){
        return { mode: 'Mach', value: null };
      }
      const value = digits >= 10 ? digits / 100 : digits;
      return { mode: 'Mach', value };
    }
    if(trimmed.startsWith('N')){
      const digitsStr = trimmed.slice(1).replace(/[^0-9]/g, '');
      if(!digitsStr){
        return { mode: 'IAS', value: null };
      }
      const significant = digitsStr.replace(/^0+/, '');
      const digits = significant ? parseInt(significant, 10) : 0;
      if(Number.isNaN(digits)){
        return { mode: 'IAS', value: null };
      }
      const length = significant.length || digitsStr.length;
      const missingDigits = Math.max(0, 3 - length);
      const factor = digits === 0 ? 1 : Math.pow(10, missingDigits);
      const value = digits * factor;
      return { mode: 'IAS', value };
    }
    const numeric = parseFloat(trimmed.replace(/[^0-9.]/g, ''));
    if(Number.isFinite(numeric)){
      return { mode: modeHint, value: numeric };
    }
    return { mode: modeHint, value: null };
  }
  if(Number.isFinite(Number(input))){
    return { mode: modeHint, value: Number(input) };
  }
  return { mode: modeHint, value: null };
}

export function formatSpeedInstruction(instruction){
  if(!instruction || instruction.value==null || Number.isNaN(instruction.value)){
    return '';
  }
  if((instruction.mode || '').toUpperCase() === 'MACH'){
    const value = Number(instruction.value);
    return `MN ${value.toFixed(2)}`;
  }
  const value = Math.round(Number(instruction.value));
  return `IAS ${value}`;
}

export function calculateGroundSpeedFromInstruction(instruction, altitudeFt, headingDeg, wind){
  if(!instruction || instruction.value==null || Number.isNaN(instruction.value)){
    return null;
  }
  const mode = (instruction.mode || 'IAS').toUpperCase().startsWith('M') ? 'Mach' : 'IAS';
  const altitude = Number.isFinite(altitudeFt) ? altitudeFt : 0;
  const heading = Number.isFinite(headingDeg) ? headingDeg : 0;
  const tasKnots = mode === 'Mach'
    ? convertMachToTas(instruction.value, altitude)
    : convertIasToTas(instruction.value, altitude);
  if(!Number.isFinite(tasKnots)){
    return null;
  }
  const windSpeed = Number.isFinite(wind?.speed) ? wind.speed : 0;
  if(Math.abs(windSpeed) < 1e-3){
    return Math.max(0, tasKnots);
  }
  const windDirection = Number.isFinite(wind?.direction) ? wind.direction : 0;
  const aircraftRad = headingToRad(heading);
  const windToRad = headingToRad(windDirection + 180);
  const vx = tasKnots * Math.sin(aircraftRad) + windSpeed * Math.sin(windToRad);
  const vy = tasKnots * Math.cos(aircraftRad) + windSpeed * Math.cos(windToRad);
  return Math.max(0, Math.hypot(vx, vy));
}
