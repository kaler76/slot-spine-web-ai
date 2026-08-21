import { supabase } from "./supabaseClient.js";

const BACKGROUNDS_TABLE = "spine_backgrounds";
const LAYERS_TABLE = "spine_background_layers";
const EXPORTS_TABLE = "spine_background_exports";
const STORAGE_BUCKET = "spine-backgrounds";

export async function listBackgroundsWithLayers() {
  const { data: backgrounds, error: bgErr } = await supabase
    .from(BACKGROUNDS_TABLE)
    .select("id, name, created_at")
    .order("created_at", { ascending: false });
  if (bgErr) throw bgErr;

  const { data: layers, error: layersErr } = await supabase
    .from(LAYERS_TABLE)
    .select("id, background_id, layer_key, image_url, z_index, animation_type, width, height");
  if (layersErr) throw layersErr;

  return backgrounds.map((b) => ({
    ...b,
    layers: layers.filter((l) => l.background_id === b.id).sort((a, b2) => a.z_index - b2.z_index)
  }));
}

export async function getBackgroundWithDetails(backgroundId) {
  const { data: background, error: bgErr } = await supabase
    .from(BACKGROUNDS_TABLE)
    .select("id, name, created_at, canvas_width, canvas_height")
    .eq("id", backgroundId)
    .single();
  if (bgErr) throw bgErr;

  const { data: layers, error: layersErr } = await supabase
    .from(LAYERS_TABLE)
    .select("*")
    .eq("background_id", backgroundId)
    .order("z_index", { ascending: true });
  if (layersErr) throw layersErr;

  const { data: exportRow } = await supabase
    .from(EXPORTS_TABLE)
    .select("*")
    .eq("background_id", backgroundId)
    .maybeSingle();

  return { ...background, layers, export: exportRow || null };
}

/** Aggiorna la risoluzione canvas del background (a cui tutti i layer si adattano). */
export async function updateBackgroundCanvas(backgroundId, { canvasWidth, canvasHeight }) {
  const { data, error } = await supabase
    .from(BACKGROUNDS_TABLE)
    .update({ canvas_width: canvasWidth, canvas_height: canvasHeight })
    .eq("id", backgroundId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createBackground(name) {
  const { data, error } = await supabase.from(BACKGROUNDS_TABLE).insert({ name }).select().single();
  if (error) throw error;
  return data;
}

export async function saveBackgroundLayer({
  backgroundId,
  layerKey,
  imageBlob,
  width,
  height,
  zIndex,
  animationType,
  speed
}) {
  const path = `${backgroundId}/${layerKey}.png`;

  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, imageBlob, { contentType: "image/png", upsert: true });
  if (uploadErr) throw uploadErr;

  const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);

  const { data, error } = await supabase
    .from(LAYERS_TABLE)
    .upsert(
      {
        background_id: backgroundId,
        layer_key: layerKey,
        image_path: path,
        image_url: publicUrlData.publicUrl,
        width,
        height,
        z_index: zIndex,
        animation_type: animationType,
        speed
      },
      { onConflict: "background_id,layer_key" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Aggiorna solo i metadati di un layer già salvato (dimensioni/z-index/animazione/velocità), senza ricaricare l'immagine. */
export async function updateBackgroundLayerMetadata(layerId, { width, height, zIndex, animationType, speed }) {
  const { data, error } = await supabase
    .from(LAYERS_TABLE)
    .update({ width, height, z_index: zIndex, animation_type: animationType, speed })
    .eq("id", layerId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteBackgroundLayer(layerId) {
  const { error } = await supabase.from(LAYERS_TABLE).delete().eq("id", layerId);
  if (error) throw error;
}

export async function saveBackgroundExport({ backgroundId, skeletonJson, atlasText }) {
  const { data, error } = await supabase
    .from(EXPORTS_TABLE)
    .upsert(
      { background_id: backgroundId, skeleton_json: skeletonJson, atlas_text: atlasText },
      { onConflict: "background_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteBackground(backgroundId) {
  const { error } = await supabase.from(BACKGROUNDS_TABLE).delete().eq("id", backgroundId);
  if (error) throw error;
}
