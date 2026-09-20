import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

// Preserve the supplied figures; do not infer values from related variants.
export function parseAircraftPerformance(text) {
  const blocks=text.replace(/\r/g,'').trim().split(/\n(?=[A-Z][A-Z0-9]{3}\n)/).slice(1);
  const profiles={};
  for(const block of blocks) {
    const lines=block.split('\n').map(line=>line.trim()).filter(Boolean);
    const type=lines.shift();
    if(profiles[type])throw new Error(`Duplicate performance type ${type}.`);
    const expect=pattern=>{
      const line=lines.shift(),match=line?.match(pattern);
      if(!match)throw new Error(`${type}: unexpected performance row ${line}.`);
      return match[1]===undefined?null:Number(match[1]);
    };
    const phase=(heading,mode,rate)=>{
      expect(heading);
      return {speed:{mode,value:expect(mode==='Mach'?/^MACH ([\d.]+)$/:/^IAS (\d+) kts?$/)},
        rateFpm:expect(new RegExp(`^${rate} (\\d+) ft/min$`))};
    };
    const initialClimb=phase(/^Initial climb \(to 5000ft\)$/,'IAS','ROC');
    const climb150=phase(/^Climb \(to FL 150\)$/,'IAS','ROC');
    const climb240=phase(/^Climb \(to FL 240\)$/,'IAS','ROC');
    const machClimb=phase(/^MACH climb$/,'Mach','ROC');
    expect(/^Cruise$/);
    const cruise={tasKnots:expect(/^TAS (\d+) kt$/),mach:expect(/^MACH ([\d.]+)$/)};
    const ceilingFL=expect(/^Ceiling FL (\d+)$/),rangeNm=expect(/^Range (\d+) NM$/);
    const initialDescent=phase(/^Initial Descent \(to FL 240\)$/,'Mach','ROD');
    const descent100=phase(/^Descent \(to FL 100\)$/,'IAS','ROD');
    const approach=phase(/^Approach$/,'IAS','ROD');
    const minimumCleanSpeedKnots=expect(/^MCS (\d+) kt$/);
    // The supplied E195 block repeats the MCS value once without its label.
    if(type==='E195' && lines[0]===`${minimumCleanSpeedKnots} kt`)lines.shift();
    if(lines.length)throw new Error(`${type}: unparsed performance rows.`);
    profiles[type]={initialClimb,climb150,climb240,machClimb,cruise,ceilingFL,rangeNm,
      initialDescent,descent100,approach,minimumCleanSpeedKnots};
  }
  if(!Object.keys(profiles).length)throw new Error('Empty aircraft performance table.');
  return profiles;
}

if(process.argv[1] && fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])) {
  const profiles=parseAircraftPerformance(fs.readFileSync(new URL('../assets/sources/aircraft-performance.txt',import.meta.url),'utf8'));
  const output='// Generated from the supplied aircraft-performance.txt; run scripts/import-aircraft-performance.mjs.\n'
    +'export const AIRCRAFT_PERFORMANCE = '+JSON.stringify(profiles,null,2)+';\n';
  fs.writeFileSync(new URL('../src/data/aircraft-performance.js',import.meta.url),output);
  console.log(`Imported ${Object.keys(profiles).length} aircraft performance profiles.`);
}
