import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY mancanti. Crea un file .env.local (vedi .env.example)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseAnonKey;

export const SYMBOLS_TABLE = "spine_symbols";
export const ANIMATIONS_TABLE = "spine_symbol_animations";
export const STORAGE_BUCKET = "spine-symbols";
