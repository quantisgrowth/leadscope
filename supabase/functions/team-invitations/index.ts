import '@supabase/functions-js/edge-runtime.d.ts';
import { withSupabase } from '@supabase/server';
import { createClient } from '@supabase/supabase-js';
import { accountId } from '../_shared/account.ts';

const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const escape = (value: string) => value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const fields='id,email,role,status,created_at,sent_at,expires_at,accepted_at,candidate_name,candidate_user_id,approved_by';

export default { fetch: withSupabase({auth:'user'},async(req,ctx)=>{
  if(req.method!=='POST') return Response.json({error:'Método não permitido'},{status:405});
  try {
    const userId=ctx.userClaims?.id;
    if(!userId) return Response.json({error:'Autenticação necessária'},{status:401});
    const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if(!secret) return Response.json({error:'Configure a função de convites no servidor.'},{status:503});
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    const body=await req.json();
    const action=body.action||'list';
    if(action==='accept') {
      const token=String(body.token||'');
      if(!/^[a-f0-9]{64}$/.test(token)) return Response.json({error:'Convite inválido'},{status:400});
      const {data:user,error:userError}=await admin.auth.admin.getUserById(userId);
      if(userError||!user.user?.email||!user.user.email_confirmed_at) return Response.json({error:'Confirme seu e-mail antes de aceitar o convite.'},{status:403});
      if(user.user.app_metadata?.leadscope_activation==='pending_manual') return Response.json({error:'Aguarde a aprovação do titular.'},{status:403});
      if(user.user.app_metadata?.leadscope_activation==='approved_manual') {
        const {data:approved}=await admin.from('team_invitations').select('account_id').eq('token_hash',await hash(token)).eq('candidate_user_id',userId).eq('status','accepted').maybeSingle();
        if(!approved) return Response.json({error:'Convite não corresponde ao cadastro aprovado.'},{status:403});
        const {data:member}=await admin.from('account_members').select('account_id').eq('member_id',userId).eq('account_id',approved.account_id).maybeSingle();
        if(!member) return Response.json({error:'Acesso removido.'},{status:403});
        return Response.json({accepted:true,account_id:approved.account_id});
      }
      const {data,error}=await admin.rpc('accept_team_invitation',{p_hash:await hash(token),p_user:userId,p_email:user.user.email});
      if(error) return Response.json({error:error.message},{status:400});
      return Response.json({accepted:true,account_id:data});
    }
    const owner=await accountId(ctx);
    if(owner!==userId) return Response.json({error:'Somente o titular da conta pode gerenciar convites.'},{status:403});
    if(action==='list') {
      const {data:invitations,error}=await admin.from('team_invitations').select(fields).eq('account_id',owner).order('created_at',{ascending:false}).limit(100);
      if(error) throw error;
      const {data:members,error:memberError}=await admin.from('account_members').select('member_id,role,joined_at').eq('account_id',owner);
      if(memberError) throw memberError;
      // Never expose Auth secrets or invitation hashes to the browser.
      const memberRows=await Promise.all((members||[]).map(async(member)=>{
        const {data}=await admin.auth.admin.getUserById(member.member_id);
        return {...member,email:data.user?.email||'',manual_activation:data.user?.app_metadata?.leadscope_activation==='approved_manual'};
      }));
      return Response.json({invitations,members:memberRows});
    }
    if(action==='approve') {
      const {data:candidate,error}=await admin.rpc('approve_manual_invitation',{p_id:String(body.id||''),p_owner:owner});
      if(error) return Response.json({error:error.message},{status:409});
      // Auth requires technical activation for password login. This is NOT proof
      // of email ownership; preserve that distinction in server-set metadata/UI.
      const {data:existing,error:readError}=await admin.auth.admin.getUserById(candidate);
      if(readError||!existing.user) throw new Error('Não foi possível consultar o cadastro aprovado. Tente aprovar novamente.');
      const {error:activationError}=await admin.auth.admin.updateUserById(candidate,{email_confirm:true,app_metadata:{...existing.user.app_metadata,leadscope_activation:'approved_manual',leadscope_email_identity_verified:false}});
      if(activationError) throw new Error('Aprovação registrada, mas a ativação falhou. Tente aprovar novamente.');
      return Response.json({message:'Acesso aprovado manualmente. A pessoa já pode entrar com sua senha.'});
    }
    if(action==='remove_member') {
      const {error}=await admin.from('account_members').delete().eq('account_id',owner).eq('member_id',String(body.member_id||''));
      if(error) throw error;
      return Response.json({removed:true});
    }
    if(action==='revoke') {
      const {data,error}=await admin.from('team_invitations').update({status:'revoked'}).eq('account_id',owner).eq('id',String(body.id||'')).in('status',['sending','sent','failed','registering','awaiting_approval']).select('id').maybeSingle();
      if(error) throw error;
      if(!data) return Response.json({error:'Convite não encontrado ou já aceito.'},{status:409});
      return Response.json({revoked:true});
    }
    if(!['invite','resend'].includes(action)) return Response.json({error:'Ação inválida'},{status:400});
    if(body.delivery!==undefined&&!['email','link'].includes(body.delivery)) return Response.json({error:'Forma de convite inválida.'},{status:400});
    const manualLink=body.delivery==='link';
    const apiKey=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('INVITE_FROM_EMAIL');
    if(!manualLink&&(!apiKey||!from)) return Response.json({error:'Envio por e-mail não configurado. Use Gerar link de convite ou configure o remetente no servidor.'},{status:503});
    const appUrl=new URL(Deno.env.get('LEADSCOPE_SITE_URL')||'https://quantisgrowth.github.io/leadscope/');
    if(appUrl.protocol!=='https:') throw new Error('LEADSCOPE_SITE_URL deve usar HTTPS.');
    let email=String(body.email||'').trim().toLowerCase();
    let role=body.role==='viewer'?'viewer':'editor';
    const token=[...crypto.getRandomValues(new Uint8Array(32))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
    const tokenHash=await hash(token);
    const expiresAt=new Date(Date.now()+7*86400000).toISOString();
    let invitation;
    if(action==='resend') {
      const {data:old,error}=await admin.from('team_invitations').select('*').eq('account_id',owner).eq('id',String(body.id||'')).single();
      if(error||!old) return Response.json({error:'Convite não encontrado.'},{status:404});
      if(!['sent','failed'].includes(old.status)||Date.now()-new Date(old.sent_at||old.created_at).getTime()<60000) return Response.json({error:'Aguarde um minuto ou revogue o convite pendente.'},{status:409});
      email=old.email;role=old.role;
      const {data,error:claimError}=await admin.from('team_invitations').update({status:manualLink?'sent':'sending',token_hash:tokenHash,expires_at:expiresAt,sent_at:manualLink?new Date().toISOString():null,provider_message_id:null}).eq('id',old.id).eq('status',old.status).eq('token_hash',old.token_hash).select('*').maybeSingle();
      if(claimError) throw claimError;
      if(!data) return Response.json({error:'Outra operação está processando esse convite.'},{status:409});
      invitation=data;
    } else {
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254) return Response.json({error:'Informe um e-mail válido.'},{status:400});
      const {data:sender}=await admin.auth.admin.getUserById(userId);
      if(sender.user?.email?.toLowerCase()===email) return Response.json({error:'Você já é o titular da conta.'},{status:400});
      const {count,error:countError}=await admin.from('team_invitations').select('id',{count:'exact',head:true}).eq('account_id',owner).gte('created_at',new Date(Date.now()-3600000).toISOString());
      if(countError) throw countError;
      if((count||0)>=10) return Response.json({error:'Limite de 10 novos convites por hora atingido.'},{status:429});
      const {data,error}=await admin.from('team_invitations').insert({account_id:owner,email,role,token_hash:tokenHash,expires_at:expiresAt,status:manualLink?'sent':'sending',sent_at:manualLink?new Date().toISOString():null}).select('*').single();
      if(error?.code==='23505') return Response.json({error:'Já existe um convite pendente. Use Gerar novo link, Reenviar por e-mail ou Revogar.'},{status:409});
      if(error) throw error;
      invitation=data;
    }
    appUrl.search='';appUrl.hash='';appUrl.searchParams.set('team_invite',token);
    // Existing SQL treats "sent" as an issued invitation eligible for acceptance.
    // Manual delivery issues it without sending email; the raw token is returned once,
    // never persisted. Regeneration replaces the hash and invalidates the old link.
    if(manualLink) return Response.json({link:appUrl.href,email,expires_at:expiresAt,message:'Link gerado. Compartilhe somente com o destinatário informado.'},{headers:{'Cache-Control':'no-store'}});
    try {
      const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':`invite-${invitation.id}-${tokenHash}`},body:JSON.stringify({from,to:[email],subject:'Convite para participar do LeadScope',html:`<!doctype html><html lang="pt-BR"><body><h1>Você recebeu um convite para o LeadScope</h1><p>Entre com o e-mail que recebeu este convite. Se ainda não possui conta, crie sua senha e confirme seu e-mail.</p><p><a href="${escape(appUrl.href)}">Abrir o LeadScope e aceitar convite</a></p><p>O convite expira em 7 dias. Seu acesso será ${role==='viewer'?'somente leitura':'de colaborador'}. Se não esperava este convite, ignore esta mensagem.</p></body></html>`}),signal:AbortSignal.timeout(15000)});
      if(!response.ok) throw new Error(`O serviço de e-mail recusou o envio (${response.status}). Confira remetente e configuração.`);
      const result=await response.json();
      const {error}=await admin.from('team_invitations').update({status:'sent',sent_at:new Date().toISOString(),provider_message_id:result.id}).eq('id',invitation.id).eq('token_hash',tokenHash).eq('status','sending');
      if(error) throw error;
      return Response.json({sent:true,message:'Convite aceito pelo serviço de envio. A entrega ainda depende do destinatário.'});
    } catch(error) {
      await admin.from('team_invitations').update({status:'failed'}).eq('id',invitation.id).eq('token_hash',tokenHash).eq('status','sending');
      throw error;
    }
  } catch(error) {
    return Response.json({error:error instanceof Error?error.message:'Não foi possível processar o convite. Verifique a instalação das tabelas e funções.'},{status:500});
  }
})};
