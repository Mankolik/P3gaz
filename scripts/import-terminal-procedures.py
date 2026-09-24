"""Import the supplied extraction ZIP; no third-party dependencies or chart guesses."""
import csv
import io
import json
from pathlib import Path
import sys
import zipfile

PREFERRED = {
    ('EPLB', 'SID', 'VADOL'): 'VADOL 1J',
    ('EPMO', 'STAR', 'DOSIX'): 'DOSIX 1Y',
    ('EPMO', 'STAR', 'GOGUS'): 'GOGUS 1Y',
    ('EPMO', 'STAR', 'NUBLI'): 'NUBLI 1Y',
    ('EPMO', 'STAR', 'SORIX'): 'SORIX 3Y',
    ('EPRZ', 'STAR', 'LUXAR'): 'LUXAR 3D',
}

def bounds(restriction, altitude=False):
    result = {}
    for v in restriction['values']:
        value = v['value'] * (100 if altitude and v['unit'] == 'FL' else 1)
        if v['operator'] in ('at', 'at_or_above'):
            result['min'] = max(result.get('min', value), value)
        if v['operator'] in ('at', 'at_or_below'):
            result['max'] = min(result.get('max', value), value)
    if result.get('min', 0) > result.get('max', float('inf')):
        raise ValueError(f'Conflicting restriction: {restriction}')
    return result

def main():
    selected = {}
    with zipfile.ZipFile(sys.argv[1]) as archive:
        for filename in sorted(archive.namelist()):
            if not filename.endswith('/procedures.json'):
                continue
            rows = csv.DictReader(io.StringIO(archive.read(filename.replace('procedures.json', 'waypoints.csv')).decode('utf-8-sig')))
            coordinates = {r['point']: r for r in rows}
            for procedure in json.loads(archive.read(filename)):
                named = [p for p in procedure['points'] if p['point']]
                connection = named[-1 if procedure['type'] == 'SID' else 0]['point']
                key = (procedure['icao'], procedure['type'], connection)
                if key in PREFERRED and procedure['name'] != PREFERRED[key]:
                    continue
                if key in selected:
                    raise ValueError(f'Choose one variant explicitly: {key}')
                points = []
                for leg in procedure['points']:
                    if not leg['point']:
                        # EPSC climb-to-600-ft legs are complete at our FL030 spawn.
                        limits = bounds(leg['altitude'], True)
                        if leg['path'] != 'VA' or limits.get('min', float('inf')) > 3000 or 'max' in limits:
                            raise ValueError(f'Unsupported unnamed leg: {procedure["name"]} {leg}')
                        continue
                    row = coordinates[leg['point']]
                    points.append(dict(name=leg['point'], lon=float(row['longitude_decimal']), lat=float(row['latitude_decimal']),
                        path=leg['path'], flyOver=leg['flyOver'] == 'Y',
                        altitude=bounds(leg['altitude'], True), speed=bounds(leg['speed']),
                        altitudeText=leg['altitude']['label'], speedText=leg['speed']['label']))
                selected[key] = dict(airport=procedure['icao'], type=procedure['type'], name=procedure['name'],
                    runway=procedure['runway'], connection=connection, effectiveDate=procedure['effectiveDate'],
                    source=coordinates[named[0]['point']]['source_file'], notes=procedure['notes'], points=points)
    output = Path(__file__).resolve().parents[1] / 'src/data/terminal-procedures.js'
    output.write_text('// Generated from SID_STAR_extraction.zip by scripts/import-terminal-procedures.py.\n'
                      '// Restrictions use feet and IAS knots; original labels retain FL/altitude notation.\n'
                      'export const TERMINAL_PROCEDURES = ' + json.dumps(list(selected.values()), ensure_ascii=False, separators=(',', ':')) + ';\n')
    print(f'Imported {len(selected)} fixed procedures into {output}')

if __name__ == '__main__':
    main()
