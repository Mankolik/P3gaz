import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WebSocket } from 'ws';
import { createServer } from '../server/index.js';
import { loadSimulationData } from '../server/data.js';
import { PROTOCOL_VERSION } from '../src/multiplayer/protocol.js';

const data=await loadSimulationData();
const request=(origin,path,headers={},method='GET')=>new Promise((resolve,reject)=>{
  const req=http.request(origin+path,{headers,method},res=>{
    const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
  });req.on('error',reject);req.end();
});
const listen=async app=>{await new Promise(r=>app.server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+app.server.address().port;};

test('static files compress losslessly, revalidate without a body, and respect representation/HEAD semantics',async()=>{
  const app=await createServer({data}),origin=await listen(app);
  try{
    const path='/assets/geojson/WptsAbroad.geojson';
    const raw=await request(origin,path),gzip=await request(origin,path,{'Accept-Encoding':'gzip'});
    assert.equal(raw.status,200);assert.equal(gzip.headers['content-encoding'],'gzip');
    assert.deepEqual(gunzipSync(gzip.body),raw.body);assert(gzip.body.length<raw.body.length*.3);
    assert.notEqual(raw.headers.etag,gzip.headers.etag);assert.equal(gzip.headers.vary,'Accept-Encoding');
    const cached=await request(origin,path,{'Accept-Encoding':'gzip','If-None-Match':'W/'+gzip.headers.etag});
    assert.equal(cached.status,304);assert.equal(cached.body.length,0);
    const different=await request(origin,path,{'If-None-Match':gzip.headers.etag});assert.equal(different.status,200);
    const head=await request(origin,path,{'Accept-Encoding':'gzip'},'HEAD');assert.equal(head.body.length,0);assert.equal(+head.headers['content-length'],gzip.body.length);
    const disabled=await request(origin,path,{'Accept-Encoding':'gzip;q=0, *;q=1'});assert.equal(disabled.headers['content-encoding'],undefined);
    assert.deepEqual(disabled.body,raw.body);
    for(const path of ['/server/static.js','/scripts/build-static.mjs','/package.json','/.git/config','/assets/%00','/assets/%2e%2e/%2e%2e/server/index.js'])assert.equal((await request(origin,path)).status,404);
    assert.equal((await request(origin,'/',{},'POST')).status,405);
    console.log(JSON.stringify({staticExample:path,originalBytes:raw.body.length,gzipBytes:gzip.body.length,revalidatedBodyBytes:cached.body.length}));
  }finally{await app.close();}
});

test('backend-only mode preserves health/WebSockets and permits only configured cross-origin browser connections',async()=>{
  const allowed='https://p3gaz.example',app=await createServer({data,serveStatic:false,allowedOrigins:[allowed]}),origin=await listen(app),sockets=[];
  try{
    assert.equal((await request(origin,'/')).status,404);assert.equal((await request(origin,'/src/main.js')).status,404);
    assert.equal((await request(origin,'/health')).status,200);
    for(const frontend of [allowed,origin]){
      const ws=new WebSocket(origin.replace('http:','ws:')+'/multiplayer',{origin:frontend});sockets.push(ws);await once(ws,'open');
      const ack=new Promise(resolve=>ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='ack')resolve(m);}));
      ws.send(JSON.stringify({type:'create',id:'1',protocol:PROTOCOL_VERSION,initials:'AA'}));assert.equal((await ack).error,undefined);
    }
    for(const frontend of ['https://p3gaz.example.evil.test','https://other.example','null','https://p3gaz.example/path']){
      const ws=new WebSocket(origin.replace('http:','ws:')+'/multiplayer',{origin:frontend});sockets.push(ws);await assert.rejects(once(ws,'open'));
    }
  }finally{for(const ws of sockets)ws.terminate();await app.close();}
});

test('old clients are asked to refresh instead of joining an incompatible room',async()=>{
  const app=await createServer({data}),origin=await listen(app),ws=new WebSocket(origin.replace('http:','ws:')+'/multiplayer');
  try{
    await once(ws,'open');const result=once(ws,'message');ws.send(JSON.stringify({type:'create',id:'1',protocol:1,initials:'AA'}));
    assert.match(JSON.parse((await result)[0]).error,/Refresh/);assert.equal(app.rooms.size,0);
  }finally{ws.terminate();await app.close();}
});

test('static build contains only public files and an explicit backend configuration',async()=>{
  const cwd=new URL('../',import.meta.url);
  await promisify(execFile)(process.execPath,['scripts/build-static.mjs'],{cwd,env:{...process.env,MULTIPLAYER_URL:'wss://p3gaz-example.onrender.com/multiplayer'}});
  const files=await readdir(new URL('../dist/',import.meta.url));
  assert.deepEqual(files.sort(),['404.html','_headers','assets','index.html','runtime-config.js','src','styles.css']);
  assert.match(await readFile(new URL('../dist/runtime-config.js',import.meta.url),'utf8'),/wss:\/\/p3gaz-example\.onrender\.com\/multiplayer/);
  assert.match(await readFile(new URL('../dist/index.html',import.meta.url),'utf8'),/runtime-config\.js/);
  assert.match(await readFile(new URL('../dist/_headers',import.meta.url),'utf8'),/must-revalidate/);
});
