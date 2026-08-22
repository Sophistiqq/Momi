import { createClient } from '@supabase/supabase-js';

let _supabase: any = null;
let _anon: any = null;

export function supabase(): any {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return _supabase;
}

export function anon(): any {
  if (!_anon) _anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  return _anon;
}

export const BUCKET = () => process.env.MOMENTS_BUCKET ?? 'moments';
export const TOKEN_COOKIE = 'sb-auth-token';
