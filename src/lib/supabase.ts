import { createClient, type SupabaseClient } from "./supabaseRestClient";
import type { Database } from "../types/supabase";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

let cachedClient: SupabaseClient<Database> | null = null;

export const getSupabaseConfigError = (): string | null => {
  if (!supabaseUrl || !supabasePublishableKey) {
    return "Supabase ist nicht konfiguriert. Setze VITE_SUPABASE_URL und VITE_SUPABASE_PUBLISHABLE_KEY in .env.local oder in den Netlify Environment Variables.";
  }

  return null;
};

export const getSupabaseClient = (): SupabaseClient<Database> => {
  const configError = getSupabaseConfigError();
  if (configError) {
    throw new Error(configError);
  }

  if (!cachedClient) {
    cachedClient = createClient<Database>(supabaseUrl!, supabasePublishableKey!, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }

  return cachedClient;
};
