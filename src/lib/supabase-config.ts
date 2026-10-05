/** Shared Supabase presence check: the anon env pair decides whether the
 * persistence/auth layer exists at all. Was defined identically twice. */
export function isSupabaseEnvConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
