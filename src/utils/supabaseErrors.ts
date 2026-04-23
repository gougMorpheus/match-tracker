const SCHEMA_CACHE_ERROR = "Could not find the table 'public.games' in the schema cache";

export const normalizeSupabaseErrorMessage = (message: string): string => {
  if (
    message.includes(SCHEMA_CACHE_ERROR) ||
    (message.includes("schema cache") && message.includes("public.games"))
  ) {
    return "Supabase kennt die Tabelle public.games noch nicht. Fuehre die Datei supabase/schema.sql im SQL Editor des richtigen Supabase-Projekts aus und warte danach kurz, bis der Schema-Cache aktualisiert ist.";
  }

  if (message.includes("schema cache") && message.includes("public.events")) {
    return "Supabase kennt die Tabelle public.events noch nicht. Fuehre die Datei supabase/schema.sql im SQL Editor des richtigen Supabase-Projekts aus und warte danach kurz, bis der Schema-Cache aktualisiert ist.";
  }

  return message;
};
