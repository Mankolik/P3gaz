import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { multiplayerEndpoint } from '../src/multiplayer/endpoint.js';
import { runtimeConfigScript } from '../server/static.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'dist');
const configured=process.env.MULTIPLAYER_URL || '';
// Production split builds must use a secure, absolute backend address.
if(configured && (!/^wss:\/\//.test(configured) || multiplayerEndpoint('https://static.example/',configured).pathname!=='/multiplayer')){
  throw Error('MULTIPLAYER_URL must be wss://your-render-service/multiplayer.');
}
await rm(output,{recursive:true,force:true});await mkdir(output);
for(const name of ['index.html','styles.css','src','assets'])await cp(path.join(root,name),path.join(output,name),{recursive:true});
await writeFile(path.join(output,'runtime-config.js'),runtimeConfigScript(configured));
// Unhashed URLs must revalidate so a deployment cannot mix protocol versions.
await writeFile(path.join(output,'_headers'),'/*\n  Cache-Control: public, max-age=0, must-revalidate\n  X-Content-Type-Options: nosniff\n');
// Disable Pages SPA fallback for missing assets/server paths.
await writeFile(path.join(output,'404.html'),'<!doctype html><title>Not found</title><h1>Not found</h1>\n');
console.log('Static site built in dist/; multiplayer: '+(configured || 'same origin'));
