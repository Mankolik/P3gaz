import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import path from 'node:path';

const compress=promisify(gzip);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json','.geojson':'application/geo+json',
  '.woff2':'font/woff2','.woff':'font/woff','.png':'image/png','.svg':'image/svg+xml'};
export function runtimeConfigScript(multiplayerUrl=''){
  return 'window.P3GAZ_CONFIG=Object.freeze('+JSON.stringify({multiplayerUrl})+');\n';
}
function acceptsGzip(header=''){
  const encodings=new Map(header.toLowerCase().split(',').map(part=>{
    const [name,...params]=part.trim().split(';');
    const q=params.find(p=>p.trim().startsWith('q='));
    return [name,q===undefined?1:Number(q.trim().slice(2))];
  }));
  return (encodings.get('gzip') ?? encodings.get('*') ?? 0)>0;
}

export function createStaticHandler(root,{multiplayerUrl='',cacheLimit=16*1024*1024}={}){
  const cache=new Map();let cacheBytes=0;
  return async(req,res,url)=>{
    const name=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    if(name.includes('\\') || !/^\/(?:index\.html|styles\.css|runtime-config\.js|favicon\.ico|(?:src|assets)\/[^\0]+)$/.test(name))throw Error('Not public');
    const file=path.resolve(root,'.'+name);
    if(!file.startsWith(root+path.sep) || name.split('/').some(p=>p.startsWith('.')))throw Error('Not public');
    const info=name==='/runtime-config.js'?{mtimeMs:0,size:0}:await stat(file);
    let entry=cache.get(name);
    if(!entry || entry.mtime!==info.mtimeMs || entry.fileSize!==info.size){
      const raw=name==='/runtime-config.js'?Buffer.from(runtimeConfigScript(multiplayerUrl)):await readFile(file);
      const packed=raw.length>=256 && /\.(?:html|js|css|json|geojson|svg)$/.test(name)?await compress(raw,{level:6}):null;
      entry={raw,gzip:packed && packed.length<raw.length?packed:null,mtime:info.mtimeMs,fileSize:info.size,
        hash:createHash('sha256').update(raw).digest('base64url')};
      entry.bytes=raw.length+(entry.gzip?.length || 0);
      // Concurrent initial requests may have populated this path while we read.
      if(cache.has(name)){cacheBytes-=cache.get(name).bytes;cache.delete(name);}
      if(entry.bytes<=cacheLimit){
        while(cacheBytes+entry.bytes>cacheLimit){const key=cache.keys().next().value;cacheBytes-=cache.get(key).bytes;cache.delete(key);}
        cache.set(name,entry);cacheBytes+=entry.bytes;
      }
    }else{cache.delete(name);cache.set(name,entry);}
    const useGzip=entry.gzip && acceptsGzip(req.headers['accept-encoding']);
    const body=useGzip?entry.gzip:entry.raw,etag='"'+entry.hash+(useGzip?'-gzip':'-identity')+'"';
    res.setHeader('Content-Type',types[path.extname(file)] || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','public, max-age=0, must-revalidate');
    res.setHeader('Vary','Accept-Encoding');res.setHeader('ETag',etag);
    if(useGzip)res.setHeader('Content-Encoding','gzip');
    if(req.headers['if-none-match']?.split(',').some(tag=>tag.trim()==='*' || tag.trim().replace(/^W\//,'')===etag)){
      res.writeHead(304);res.end();return;
    }
    res.setHeader('Content-Length',body.length);res.end(req.method==='HEAD'?undefined:body);
  };
}
