// Live read-only startup/CORS check. Does not authenticate or create invitations.
import assert from 'node:assert/strict';

const endpoint='https://nlzlbrfwaloyxksaevne.supabase.co/functions/v1/team-invitations';
const origin='https://quantisgrowth.github.io';
const preflight=await fetch(endpoint,{
  method:'OPTIONS',
  headers:{
    Origin:origin,
    'Access-Control-Request-Method':'POST',
    'Access-Control-Request-Headers':'authorization,x-client-info,apikey,content-type'
  },
  signal:AbortSignal.timeout(30000)
});
assert.ok(preflight.ok,`Invitation function failed to start or handle OPTIONS: ${preflight.status}, ${preflight.headers.get('sb-error-code')||'no error code'}`);
assert.ok(['*',origin].includes(preflight.headers.get('access-control-allow-origin')),'Browser origin must be allowed');
const allowed=(preflight.headers.get('access-control-allow-headers')||'').toLowerCase();
for(const header of ['authorization','x-client-info','apikey','content-type']) assert.ok(allowed.includes(header),`Missing browser header: ${header}`);
const unauthenticated=await fetch(endpoint,{
  method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
  body:JSON.stringify({action:'list'}),signal:AbortSignal.timeout(30000)
});
assert.equal(unauthenticated.status,401,'Unauthenticated requests must remain blocked');
console.log('Live invitation startup and browser preflight passed; unauthenticated access blocked. No invitations or data created.');
