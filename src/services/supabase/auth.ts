import { createClient, type SupabaseClient, type User, type Session } from "@supabase/supabase-js";

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!supabaseClient) {
    supabaseClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      },
    );
  }
  return supabaseClient;
}

export interface AuthState {
  user: User | null;
  session: Session | null;
  isGuest: boolean;
  isConfigured: boolean;
}

const MOCK_GUEST_USER: User = {
  id: "guest-traveler-demo",
  app_metadata: {},
  user_metadata: { name: "Guest Traveler (Demo)" },
  aud: "authenticated",
  created_at: new Date().toISOString(),
};

export async function getCurrentUser(): Promise<User | null> {
  const client = getSupabaseClient();
  if (!client) return MOCK_GUEST_USER;
  const { data } = await client.auth.getUser();
  return data.user ?? MOCK_GUEST_USER;
}

export async function signInWithMagicLink(email: string): Promise<{ error?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { error: "Supabase not configured. Running in Demo Mode." };
  }
  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/trips` : undefined,
    },
  });
  return { error: error?.message };
}

export async function signInAnonymously(): Promise<{ error?: string }> {
  const client = getSupabaseClient();
  if (!client) return {};
  const { error } = await client.auth.signInAnonymously();
  return { error: error?.message };
}

export async function signOutUser(): Promise<{ error?: string }> {
  const client = getSupabaseClient();
  if (!client) return {};
  const { error } = await client.auth.signOut();
  return { error: error?.message };
}
