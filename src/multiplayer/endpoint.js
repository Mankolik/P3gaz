export function multiplayerEndpoint(baseURI,configured=''){
  const base=new URL(baseURI),url=new URL(configured || 'multiplayer',base);
  if(url.protocol==='https:')url.protocol='wss:';
  else if(url.protocol==='http:')url.protocol='ws:';
  if(!['ws:','wss:'].includes(url.protocol) || url.username || url.password || url.hash)throw Error('Invalid multiplayer server URL.');
  if(base.protocol==='https:' && url.protocol!=='wss:')throw Error('An HTTPS page requires a secure multiplayer server.');
  return url;
}
