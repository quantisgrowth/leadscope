import {createClient} from '@supabase/supabase-js';
const headers={'Access-Control-Allow-Origin':'https://quantisgrowth.github.io','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store'};
const reply=(body:object,status=200)=>Response.json(body,{status,headers});
// Public endpoint: authorization is the single-use, 256-bit invitation token.
// No session, membership, email or password is returned; no email is sent.
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
  if(req.method!=='POST') return reply({error:'Método não permitido'},405);
  try {
    const body=await req.json();
    const token=String(body.token||''),email=String(body.email||'').trim().toLowerCase();
    const name=String(body.name||'').trim(),password=String(body.password||'');
    if(!/^[a-f0-9]{64}$/.test(token)) return reply({error:'Convite inválido'},400);
    if(!name||name.length>120||password.length<8||password.length>128||!/[a-z]/.test(password)||!/[A-Z]/.test(password)||!/[0-9]/.test(password)||!/[\W_]/.test(password)) return reply({error:'Informe seu nome e uma senha forte de 8 a 128 caracteres.'},400);
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(b=>b.toString(16).padStart(2,'0')).join('');
    const {data:invite,error}=await admin.from('team_invitations').update({status:'registering',candidate_name:name}).eq('token_hash',digest).eq('email',email).eq('status','sent').gt('expires_at',new Date().toISOString()).select('id').maybeSingle();
    if(error) return reply({error:'Cadastro indisponível. Consulte o titular.'},503);
    if(!invite) return reply({error:'Convite inválido, já utilizado, expirado ou destinado a outro e-mail.'},403);
    const {data:created,error:createError}=await admin.auth.admin.createUser({email,password,email_confirm:false,user_metadata:{nome:name},app_metadata:{leadscope_activation:'pending_manual',leadscope_email_identity_verified:false,leadscope_invitation_id:invite.id}});
    if(createError||!created.user){
      await admin.from('team_invitations').update({status:'sent',candidate_name:null}).eq('id',invite.id).eq('status','registering');
      return reply({error:'Não foi possível cadastrar. Se já possui conta, use Entrar; caso contrário, solicite revisão ao titular. Nenhuma senha existente foi alterada.'},409);
    }
    const {data:attached,error:attachError}=await admin.from('team_invitations').update({candidate_user_id:created.user.id,status:'awaiting_approval'}).eq('id',invite.id).eq('status','registering').select('id').maybeSingle();
    if(attachError||!attached) return reply({error:'Cadastro sem acesso. Solicite revisão ao titular; não repita o cadastro.'},409);
    return reply({pending:true,message:'Cadastro recebido! Peça ao titular para aprovar seu acesso em Configurações → Usuários. Depois da aprovação, entre com o e-mail e a senha cadastrados. Não enviamos e-mail.'});
  } catch { return reply({error:'Não foi possível cadastrar. Consulte o titular.'},500); }
});
