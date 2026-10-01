// Live read-only startup/CORS check. Does not authenticate or create invitations.
import assert from 'node:assert/strict';

const endpoint='https://nlzlbrfwaloyxksaevne.supabase.co/functions/v1/team-invitations';
const registrationEndpoint=endpoint.replace('team-invitations','register-invitation');
const registrationPreflight=await fetch(registrationEndpoint,{method:'OPTIONS',headers:{Origin:'https://quantisgrowth.github.io'},signal:AbortSignal.timeout(30000)});
assert.ok(registrationPreflight.ok,'Registration function must start and support CORS');
assert.equal(registrationPreflight.headers.get('access-control-allow-origin'),'https://quantisgrowth.github.io');
const invalidRegistration=await fetch(registrationEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'invalid'}),signal:AbortSignal.timeout(30000)});
assert.equal(invalidRegistration.status,400,'Invalid invitation must be rejected without creating an account');
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
