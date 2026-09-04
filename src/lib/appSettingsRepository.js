import { supabase } from "./supabaseClient.js";

const SETTINGS_TABLE = "spine_app_settings";
const LAST_AZTEC_PROJECT_KEY = "last_aztec_project";

/**
 * Ritorna l'ultimo progetto aztec-preview da cui sono stati importati simboli
 * (slug, nome, e i dati di sfondo/cornice/rulli letti da slot_get), oppure null
 * se non è mai stato importato nulla. Usato da "Rulli animati" per posizionare
 * la scena sullo sfondo reale del progetto invece di un box generico.
 */
export async function getLastAztecProject() {
  const { data, error } = await supabase.from(SETTINGS_TABLE).select("value").eq("id", LAST_AZTEC_PROJECT_KEY).maybeSingle();
  if (error) throw error;
  return data?.value || null;
}

/** Salva/sovrascrive l'ultimo progetto aztec-preview importato. */
export async function saveLastAztecProject(value) {
  const { error } = await supabase
    .from(SETTINGS_TABLE)
    .upsert({ id: LAST_AZTEC_PROJECT_KEY, value, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw error;
}
