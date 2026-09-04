import { supabase } from "./supabaseClient.js";

/**
 * Estrae lo slug di un progetto aztec-preview da un link cliente
 * (es. "https://.../index.html?k=xxxxxxxx") oppure lo restituisce invariato
 * se è già lo slug grezzo incollato dall'utente.
 */
export function extractAztecSlug(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    const fromQuery = url.searchParams.get("k");
    if (fromQuery) return fromQuery;
  } catch {
    // non è un URL valido: probabilmente è già lo slug grezzo, si usa così com'è
  }
  return value;
}

/**
 * Legge un progetto aztec-preview dato lo slug, tramite la funzione pubblica `slot_get`
 * (SECURITY DEFINER, concessa al ruolo anon): stesso progetto Supabase di slot-spine-web-ai,
 * nessuna credenziale aggiuntiva, sola lettura.
 */
export async function fetchAztecProject(slug) {
  const { data, error } = await supabase.rpc("slot_get", { p_slug: slug });
  if (error) throw error;
  if (!data || !data.name) throw new Error("Progetto non trovato: controlla il link/slug.");
  return data;
}

/** Estrae dal progetto l'elenco dei simboli già ritagliati: [{ key, name, url }]. */
export function extractAztecSymbols(project) {
  const syms = project?.cfg?.syms || {};
  const names = project?.cfg?.names || {};
  return Object.entries(syms).map(([key, url]) => ({
    key,
    name: names[key] || key,
    url
  }));
}
