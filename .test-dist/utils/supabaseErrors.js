"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeSupabaseErrorMessage = exports.isTransientSupabaseErrorMessage = void 0;
const SCHEMA_CACHE_ERROR = "Could not find the table 'public.games' in the schema cache";
const isTransientSupabaseErrorMessage = (message) => {
    const normalizedMessage = message.toLowerCase();
    return (normalizedMessage.includes("failed to fetch") ||
        normalizedMessage.includes("networkerror") ||
        normalizedMessage.includes("network error") ||
        normalizedMessage.includes("load failed") ||
        normalizedMessage.includes("the network connection was lost") ||
        normalizedMessage.includes("internet connection appears to be offline") ||
        normalizedMessage.includes("aborted") ||
        normalizedMessage.includes("timeout"));
};
exports.isTransientSupabaseErrorMessage = isTransientSupabaseErrorMessage;
const normalizeSupabaseErrorMessage = (message) => {
    if (message.includes(SCHEMA_CACHE_ERROR) ||
        (message.includes("schema cache") && message.includes("public.games"))) {
        return "Supabase kennt die Tabelle public.games noch nicht. Fuehre die Datei supabase/schema.sql im SQL Editor des richtigen Supabase-Projekts aus und warte danach kurz, bis der Schema-Cache aktualisiert ist.";
    }
    if (message.includes("schema cache") && message.includes("public.events")) {
        return "Supabase kennt die Tabelle public.events noch nicht. Fuehre die Datei supabase/schema.sql im SQL Editor des richtigen Supabase-Projekts aus und warte danach kurz, bis der Schema-Cache aktualisiert ist.";
    }
    return message;
};
exports.normalizeSupabaseErrorMessage = normalizeSupabaseErrorMessage;
