import { supabase } from "./supabaseClient.js";

const CHARACTERS_TABLE = "spine_characters";
const PARTS_TABLE = "spine_character_parts";
const EXPORTS_TABLE = "spine_character_exports";
const STORAGE_BUCKET = "spine-characters";

export async function listCharactersWithParts() {
  const { data: characters, error: charErr } = await supabase
    .from(CHARACTERS_TABLE)
    .select("id, name, created_at")
    .order("created_at", { ascending: false });
  if (charErr) throw charErr;

  const { data: parts, error: partsErr } = await supabase
    .from(PARTS_TABLE)
    .select("id, character_id, part_key, image_url, z_index, animation_type");
  if (partsErr) throw partsErr;

  return characters.map((c) => ({
    ...c,
    parts: parts.filter((p) => p.character_id === c.id).sort((a, b) => a.z_index - b.z_index)
  }));
}

/**
 * Come listCharactersWithParts, ma include tutte le colonne di ogni parte (offset,
 * dimensioni, genitore, ancoraggio, velocità): serve alla vista Rulli, che deve poter
 * comporre e animare il character intero, non solo mostrarne una miniatura.
 */
export async function listCharactersForReels() {
  const { data: characters, error: charErr } = await supabase
    .from(CHARACTERS_TABLE)
    .select("id, name, created_at")
    .order("created_at", { ascending: false });
  if (charErr) throw charErr;

  const { data: parts, error: partsErr } = await supabase.from(PARTS_TABLE).select("*");
  if (partsErr) throw partsErr;

  return characters.map((c) => ({
    ...c,
    parts: parts.filter((p) => p.character_id === c.id).sort((a, b) => a.z_index - b.z_index)
  }));
}

export async function getCharacterWithDetails(characterId) {
  const { data: character, error: charErr } = await supabase
    .from(CHARACTERS_TABLE)
    .select("id, name, created_at")
    .eq("id", characterId)
    .single();
  if (charErr) throw charErr;

  const { data: parts, error: partsErr } = await supabase
    .from(PARTS_TABLE)
    .select("*")
    .eq("character_id", characterId)
    .order("z_index", { ascending: true });
  if (partsErr) throw partsErr;

  const { data: exportRow } = await supabase
    .from(EXPORTS_TABLE)
    .select("*")
    .eq("character_id", characterId)
    .maybeSingle();

  return { ...character, parts, export: exportRow || null };
}

export async function createCharacter(name) {
  const { data, error } = await supabase.from(CHARACTERS_TABLE).insert({ name }).select().single();
  if (error) throw error;
  return data;
}

/** Salva (o sovrascrive) una parte del character: carica il PNG e fa upsert della riga. */
export async function saveCharacterPart({
  characterId,
  partKey,
  parentKey,
  imageBlob,
  width,
  height,
  offsetX,
  offsetY,
  zIndex,
  animationType,
  speed,
  anchorX,
  anchorY
}) {
  const path = `${characterId}/${partKey}.png`;

  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, imageBlob, { contentType: "image/png", upsert: true });
  if (uploadErr) throw uploadErr;

  const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);

  const { data, error } = await supabase
    .from(PARTS_TABLE)
    .upsert(
      {
        character_id: characterId,
        part_key: partKey,
        parent_key: parentKey || "root",
        image_path: path,
        image_url: publicUrlData.publicUrl,
        width,
        height,
        offset_x: offsetX,
        offset_y: offsetY,
        z_index: zIndex ?? 0,
        animation_type: animationType || "static",
        speed: speed ?? 1,
        anchor_x: anchorX || "center",
        anchor_y: anchorY || "center"
      },
      { onConflict: "character_id,part_key" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Aggiorna solo i metadati di una parte già salvata, senza ricaricare l'immagine. */
export async function updateCharacterPartMetadata(
  partId,
  { width, height, offsetX, offsetY, zIndex, parentKey, animationType, speed, anchorX, anchorY }
) {
  const { data, error } = await supabase
    .from(PARTS_TABLE)
    .update({
      width,
      height,
      offset_x: offsetX,
      offset_y: offsetY,
      z_index: zIndex,
      parent_key: parentKey,
      animation_type: animationType,
      speed,
      anchor_x: anchorX,
      anchor_y: anchorY
    })
    .eq("id", partId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCharacterPart(partId) {
  const { error } = await supabase.from(PARTS_TABLE).delete().eq("id", partId);
  if (error) throw error;
}

export async function saveCharacterExport({ characterId, skeletonJson, atlasText }) {
  const { data, error } = await supabase
    .from(EXPORTS_TABLE)
    .upsert(
      { character_id: characterId, skeleton_json: skeletonJson, atlas_text: atlasText },
      { onConflict: "character_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCharacter(characterId) {
  const { error } = await supabase.from(CHARACTERS_TABLE).delete().eq("id", characterId);
  if (error) throw error;
}
