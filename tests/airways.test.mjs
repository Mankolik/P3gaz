import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAirwayResolver, setRouteFlightPlan } from '../src/radar/airways.js';
import { createNavigationIndex, setFlightPlan } from '../src/radar/routes.js';
import { createTrack, createDemoTracks } from '../src/radar/tracks.js';
import { loadAirways } from '../src/data/loader.js';
import { createState } from '../src/core/state.js';

const data = JSON.parse(await readFile(new URL('../assets/navigation/pansa-airways.json', import.meta.url), 'utf8'));
const resolver = createAirwayResolver(data);
const names = points => points.map(point => point.name);

test('startup loads the bundled airway asset into the resolver', async t => {
  let requested;
  t.mock.method(globalThis, 'fetch', async url => {
    requested = url;
    return { ok: true, json: async () => JSON.parse(await readFile(url, 'utf8')) };
  });
  const state = createState(null);
  assert.equal(state.air.airwayResolver, null);
  state.air.airwayResolver = await loadAirways(state.air.navigationIndex);
  assert.equal(requested.pathname.split('/').slice(-3).join('/'), 'assets/navigation/pansa-airways.json');
  assert.deepEqual(names(state.air.airwayResolver.resolveRoute('GORAT L23 GRUDA')),
    ['GORAT', 'OTPES', 'GONTU', 'GRUDA']);
});

test('airway dataset load failures are reported, not treated as an empty catalog', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false }));
  await assert.rejects(() => loadAirways(new Map()), /Failed to load/);
});

test('track construction accepts airway text, preserves nextIndex and resolved-plan compatibility', () => {
  const track = createTrack({ callsign: 'TEST', flightPlan: 'GORAT L23 GRUDA' }, null, 0, resolver);
  assert.equal(track.navigationMode, 'route');
  assert.deepEqual(names(track.flightPlan.waypoints), ['GORAT', 'OTPES', 'GONTU', 'GRUDA']);
  const resumed = createTrack({ flightPlan: { route: 'GORAT L23 GRUDA', nextIndex: 2 } }, null, 0, resolver);
  assert.equal(resumed.flightPlan.nextIndex, 2);
  const resolved = createTrack({ flightPlan: { waypoints: [{ name: 'FIX', lon: 20, lat: 50 }] } });
  assert.deepEqual(names(resolved.flightPlan.waypoints), ['FIX']);
  assert.throws(() => createTrack({ flightPlan: 'GORAT L23 GRUDA' }), /not loaded/);
  assert.throws(() => createTrack({ flightPlan: 'BILRA Q800 IVGOR' }, null, 0, resolver), /uncovered/);
  assert.equal(createDemoTracks(null, resolver).length, 5);
});

test('complete source inventory with valid coordinates and explicit foreign gap', () => {
  assert.equal(Object.keys(data.airways).length, 137);
  assert.equal(Object.keys(data.points).length, 419);
  const legs = Object.values(data.airways).flatMap(a => a.legs);
  assert.equal(legs.filter(leg => leg.status === 'published').length, 605);
  assert.equal(legs.filter(leg => leg.status === 'external-gap').length, 1);
  assert.equal(Object.values(data.airways).reduce((n, a) => n + a.waypoints.length, 0), 743);
});

test('L23 includes TOMKO across a PDF page break', () => {
  assert.deepEqual(names(resolver.resolveRoute('GORAT L23 BINKA')),
    ['GORAT', 'OTPES', 'GONTU', 'GRUDA', 'UNDUK', 'ASGUL', 'TOMKO', 'BINKA']);
  assert.deepEqual(names(resolver.resolveRoute('binka l23 gorat')),
    ['BINKA', 'TOMKO', 'ASGUL', 'UNDUK', 'GRUDA', 'GONTU', 'OTPES', 'GORAT']);
});

test('alternate routes in L29 remarks are not inserted into the airway', () => {
  assert.deepEqual(names(resolver.resolveRoute('ALUKA L29 VABER')),
    ['ALUKA', 'TUPUR', 'PEPOX', 'TADAK', 'GRUDA', 'IXIXI', 'OLKIN', 'ARDUT', 'SUWGI', 'VABER']);
});

test('Q258 uses the RSW navaid identifier and retains the last page coordinate', () => {
  assert.deepEqual(names(resolver.resolveRoute('LUXAR Q258 UREKO')),
    ['LUXAR', 'UBEPE', 'KIKZA', 'RSW', 'EPLUZ', 'VELAX', 'UREKO']);
  const rsw = resolver.resolveRoute('RSW')[0];
  assert(Math.abs(rsw.lat - (50 + 6 / 60 + 31 / 3600)) < 1e-8);
  assert(Math.abs(rsw.lon - (22 + 8 / 60 + 3 / 3600)) < 1e-8);
});

test('subsections, mixed DCT and airway changes preserve order without duplicate joins', () => {
  assert.deepEqual(names(resolver.resolveRoute('BODLA DCT GORAT L23 GRUDA L29 VABER')),
    ['BODLA', 'GORAT', 'OTPES', 'GONTU', 'GRUDA', 'IXIXI', 'OLKIN', 'ARDUT', 'SUWGI', 'VABER']);
  assert.deepEqual(names(resolver.resolveRoute('GORAT GRUDA')), ['GORAT', 'GRUDA']);
  assert.deepEqual(names(resolver.resolveRoute('N0450F350 GORAT/N0440F330 L23 GRUDA/N0430F310')),
    ['GORAT', 'OTPES', 'GONTU', 'GRUDA']);
});

test('every published leg expands in both geometric directions and checks its arrows', () => {
  let count = 0;
  for (const [name, airway] of Object.entries(data.airways)) {
    for (const leg of airway.legs) {
      if (leg.status !== 'published') continue;
      for (const [from, to, direction] of [[leg.from, leg.to, 'forward'], [leg.to, leg.from, 'reverse']]) {
        assert.deepEqual(names(resolver.expandAirway(name, from, to)), [from, to]);
        if (leg.directions.includes(direction)) {
          assert.deepEqual(names(resolver.expandAirway(name, from, to, { respectDirection: true })), [from, to]);
        } else {
          assert.throws(() => resolver.expandAirway(name, from, to, { respectDirection: true }), /opposes/);
        }
      }
      count++;
    }
    if (!airway.legs.some(leg => leg.status === 'external-gap')) {
      assert.deepEqual(names(resolver.expandAirway(name, airway.waypoints[0], airway.waypoints.at(-1))), airway.waypoints);
      assert.deepEqual(names(resolver.expandAirway(name, airway.waypoints.at(-1), airway.waypoints[0])), [...airway.waypoints].reverse());
    }
  }
  assert.equal(count, 605);
});

test('Q800 never silently bridges the Sweden section, but its two published portions work', () => {
  assert.throws(() => resolver.resolveRoute('BILRA Q800 IVGOR'), /uncovered.*POKEN.*LARMA/);
  assert.throws(() => resolver.resolveRoute('IVGOR Q800 BILRA'), /uncovered/);
  assert.deepEqual(names(resolver.resolveRoute('BILRA Q800 POKEN')), ['BILRA', 'POKEN']);
  assert.deepEqual(names(resolver.resolveRoute('LARMA Q800 IVGOR')), ['LARMA', 'IVGOR']);
});

test('bad syntax, missing fixes, unavailable airway aliases and wrong entry points fail', () => {
  for (const route of ['', 'DCT GORAT', 'GORAT DCT', 'GORAT L23', 'GORAT DCT DCT GRUDA',
    'GORAT L23 VABER', 'GORAT UL23 BINKA', 'GORAT L23 GORAT', 'GORAT/BOGUS L23 BINKA',
    'GORAT/N0450F350/EXTRA', 'N0450F350']) {
    assert.throws(() => resolver.resolveRoute(route), route);
  }
});

test('existing repository coordinates agree and extra DCT fixes use the navigation index', async () => {
  const collections = await Promise.all(['pl_enr4_4_waypoints.geojson', 'WptsAbroad.geojson', 'airports_static.json'].map(async file =>
    JSON.parse(await readFile(new URL(`../assets/geojson/${file}`, import.meta.url), 'utf8'))));
  const index = createNavigationIndex(collections);
  for (const [name, point] of Object.entries(data.points)) {
    if (name === 'RSW') continue;
    assert(index.get(name)?.some(p => Math.abs(p.lon - point.lon) < 1e-7 && Math.abs(p.lat - point.lat) < 1e-7), name);
  }
  const extra = [...index.keys()].find(name => !data.points[name]);
  assert(extra);
  const mixed = createAirwayResolver(data, index);
  assert.deepEqual(names(mixed.resolveRoute(`${extra} DCT GORAT L23 GRUDA`)),
    [extra, 'GORAT', 'OTPES', 'GONTU', 'GRUDA']);
});

test('ambiguous external fixes fail, returned points are independent and assignment is atomic', () => {
  const catalog = new Map([['AMB', [{ name: 'AMB', lon: 10, lat: 50 }, { name: 'AMB', lon: 11, lat: 51 }]]]);
  assert.throws(() => createAirwayResolver(data, catalog).resolveRoute('AMB DCT GORAT'), /Ambiguous/);
  const points = resolver.resolveRoute('GORAT L23 GRUDA');
  points[0].lat = 0;
  assert.notEqual(resolver.resolveRoute('GORAT')[0].lat, 0);
  const track = {};
  setFlightPlan(track, [{ name: 'OLD', lon: 20, lat: 50 }]);
  const before = JSON.stringify(track);
  assert.throws(() => setRouteFlightPlan(track, 'GORAT L23 VABER', resolver));
  assert.equal(JSON.stringify(track), before);
  setRouteFlightPlan(track, 'GORAT L23 GRUDA', resolver);
  assert.equal(track.navigationMode, 'route');
  assert.deepEqual(names(track.flightPlan.waypoints), ['GORAT', 'OTPES', 'GONTU', 'GRUDA']);
});
