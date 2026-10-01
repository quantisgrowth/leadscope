export async function accountId(ctx: any): Promise<string | null> {
  if (!ctx.userClaims?.id) return null;
  const { data, error } = await ctx.supabase.rpc('current_account_id');
  if (error || !data) throw new Error('A atualização de contas ainda não foi instalada. Aplique os SQLs de instalação.');
  const {data: canWrite,error: permissionError}=await ctx.supabase.rpc('current_account_can_write');
  if(permissionError||canWrite!==true) throw new Error('Seu acesso é somente leitura ou a atualização de permissões não foi instalada.');
  return data;
}
