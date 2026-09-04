import { supabase, SYMBOLS_TABLE, ANIMATIONS_TABLE, STORAGE_BUCKET } from "./supabaseClient.js";

/**
 * Ritorna tutti i simboli con, per ciascuno, un riepilogo di quali animazioni
 * (idle/win/land/spinBlur) sono già state generate e l'anteprima immagine.
 */
export async function listSymbolsWithAnimations() {
  const { data: symbols, error: symErr } = await supabase
    .from(SYMBOLS_TABLE)
    .select("id, name, created_at")
    .order("created_at", { ascending: false });
  if (symErr) throw symErr;

  const { data: animations, error: animErr } = await supabase
    .from(ANIMATIONS_TABLE)
    .select("id, symbol_id, animation_type, image_path, image_url, width, height, speed, created_at");
  if (animErr) throw animErr;

  return symbols.map((s) => {
    const anims = animations.filter((a) => a.symbol_id === s.id);
    return { ...s, animations: anims };
  });
}

/**
 * Come listSymbolsWithAnimations, ma include anche skeleton_json/atlas_text di ogni
 * animazione: serve alla vista Rulli, che deve poter riprodurre idle/land/win dei
 * simboli atterrati (le altre liste caricano solo l'anteprima immagine, più leggere).
 */
export async function listSymbolsForReels() {
  const { data: symbols, error: symErr } = await supabase
    .from(SYMBOLS_TABLE)
    .select("id, name, created_at")
    .order("created_at", { ascending: false });
  if (symErr) throw symErr;

  const { data: animations, error: animErr } = await supabase.from(ANIMATIONS_TABLE).select("*");
  if (animErr) throw animErr;

  return symbols.map((s) => {
    const anims = animations.filter((a) => a.symbol_id === s.id);
    return { ...s, animations: anims };
  });
}

/** Ritorna un singolo simbolo con tutte le sue animazioni (per la pagina dedicata). */
export async function getSymbolWithAnimations(symbolId) {
  const { data: symbol, error: symErr } = await supabase
    .from(SYMBOLS_TABLE)
    .select("id, name, created_at")
    .eq("id", symbolId)
    .single();
  if (symErr) throw symErr;

  const { data: animations, error: animErr } = await supabase
    .from(ANIMATIONS_TABLE)
    .select("*")
    .eq("symbol_id", symbolId);
  if (animErr) throw animErr;

  return { ...symbol, animations };
}

/** Crea un nuovo simbolo (record vuoto, senza animazioni). */
export async function createSymbol(name) {
  const { data, error } = await supabase
    .from(SYMBOLS_TABLE)
    .insert({ name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Salva (o sovrascrive) la variante di animazione di un simbolo:
 * carica il PNG nello storage e fa upsert della riga in spine_symbol_animations.
 */
export async function saveSymbolAnimation({
  symbolId,
  animationType,
  imageBlob,
  width,
  height,
  speed,
  skeletonJson,
  atlasText
}) {
  const path = `${symbolId}/${animationType}.png`;

  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, imageBlob, { contentType: "image/png", upsert: true });
  if (uploadErr) throw uploadErr;

  const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);

  const { data, error } = await supabase
    .from(ANIMATIONS_TABLE)
    .upsert(
      {
        symbol_id: symbolId,
        animation_type: animationType,
        image_path: path,
        image_url: publicUrlData.publicUrl,
        width,
        height,
        speed,
        skeleton_json: skeletonJson,
        atlas_text: atlasText
      },
      { onConflict: "symbol_id,animation_type" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteSymbol(symbolId) {
  const { error } = await supabase.from(SYMBOLS_TABLE).delete().eq("id", symbolId);
  if (error) throw error;
}

export async function deleteSymbolAnimation(animationId) {
  const { error } = await supabase.from(ANIMATIONS_TABLE).delete().eq("id", animationId);
  if (error) throw error;
}
