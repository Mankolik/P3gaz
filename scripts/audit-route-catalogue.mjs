import fs from 'node:fs';
import {createNavigationIndex} from '../src/radar/routes.js';
import {createAirwayResolver} from '../src/radar/airways.js';
import {createFirBoundary} from '../src/radar/fir-boundary.js';
import {parseRouteCatalogue,compileRouteCatalogue} from '../src/radar/route-catalogue.js';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const json=path=>JSON.parse(read(path));
const nav=createNavigationIndex(['pl_enr4_4_waypoints.geojson','WptsAbroad.geojson','airports_static.json'].map(p=>json('assets/geojson/'+p)));
const resolver=createAirwayResolver(json('assets/navigation/pansa-airways.json'),nav);
const boundary=createFirBoundary(json('assets/geojson/flightmap_europe_fir_uir.json'));
const catalogue=compileRouteCatalogue(parseRouteCatalogue(read('assets/sources/Airporty_revamped.txt')),resolver,boundary);
const result={summary:{airportPairs:catalogue.groups.length,totalAirportPairs:catalogue.totalGroups,
  routeVariants:catalogue.validVariants,totalRouteVariants:catalogue.totalVariants},diagnostics:catalogue.diagnostics};
console.log(JSON.stringify(result,null,2));
if(!catalogue.groups.length)process.exitCode=1;
