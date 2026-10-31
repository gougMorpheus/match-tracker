import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { classifyDashboardConfig, MATCH_TRACKER_APP_SLUG } from "../utils/dashboardAccess";

export const DASHBOARD_AUTH_STORAGE_KEY = "match-tracker:dashboard-auth";

type AuthStorage = {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
};

export const getDashboardConfigState = (): "off" | "incomplete" | "ready" =>
  classifyDashboardConfig(import.meta.env.VITE_DASHBOARD_SUPABASE_URL, import.meta.env.VITE_DASHBOARD_SUPABASE_PUBLISHABLE_KEY);

// Gleiches Muster wie die Projektübersicht: Publishable-Key, Sitzung im Browser, Hash-Grant vom Dashboard.
export const createDashboardClient = (url: string, publishableKey: string, storage?: AuthStorage): SupabaseClient =>
  createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "implicit",
      storageKey: DASHBOARD_AUTH_STORAGE_KEY,
      ...(storage ? { storage } : {})
    }
  });

let cachedClient: SupabaseClient | null = null;

export const getDashboardClient = (): SupabaseClient => {
  const url = import.meta.env.VITE_DASHBOARD_SUPABASE_URL?.trim();
  const publishableKey = import.meta.env.VITE_DASHBOARD_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) {
    throw new Error("Dashboard-Anmeldung ist nicht konfiguriert.");
  }
  if (!cachedClient) {
    cachedClient = createDashboardClient(url, publishableKey);
  }
  return cachedClient;
};

// Ein Lese-RPC. Kein Schreiben von Freischaltungen oder Rollen.
export const fetchMyAppRole = async (client: SupabaseClient): Promise<unknown> => {
  const { data, error } = await client.schema("dashboard").rpc("my_app_role", {
    p_app_slug: MATCH_TRACKER_APP_SLUG
  });
  if (error) {
    throw new Error(error.message);
  }
  return data;
};
