import { useMemo, useState } from "react";
import CropTool from "./CropTool.jsx";
import { buildRotationSequence } from "../lib/characterRotationSequence.js";
import { useCharacterRotationLoop } from "../hooks/useCharacterRotationLoop.js";
import { saveRotationFrame, deleteRotationFrame, updateCharacterRotationSpeed } from "../lib/charactersRepository.js";

const ANGLE_SLOTS = [
  { angle: 0, label: "Fronte (0°)" },
  { angle: 45, label: "3/4 (45°)" },
  { angle: 90, label: "Profilo (90°)" },
  { angle: 135, label: "3/4 retro (135°)" },
  { angle: 180, label: "Retro (180°)" }
];

/**
 * Editor per la tecnica dei "frame intermedi": un piccolo set di pose statiche
 * per il solo semicerchio 0°→180°, che a runtime vengono cicliche e specchiate
 * per ricostruire il giro completo a 360° (vedi characterRotationSequence.js).
 * A differenza delle parti animate (bone + track), qui ogni frame è un'unica
 * illustrazione piatta dell'intero personaggio: un fallback a flipbook per le
 * rotazioni rapide, esattamente come nei rig professionali quando il rig a bone
 * non basta o costerebbe troppo tempo.
 */
export default function CharacterRotationEditor({ characterId, rotationFrames, rotationSpeed, onChanged }) {
  const [activeAngle, setActiveAngle] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [speedInput, setSpeedInput] = useState(rotationSpeed ?? 1);

  const framesByAngle = useMemo(() => {
    const map = {};
    for (const f of rotationFrames) map[f.angle] = f;
    return map;
  }, [rotationFrames]);

  const sequence = useMemo(() => buildRotationSequence(rotationFrames), [rotationFrames]);
  const { index, pulseKey } = useCharacterRotationLoop({
    sequenceLength: sequence.length,
    speed: Number(rotationSpeed) || 1,
    playing: previewPlaying && sequence.length > 1
  });
  const currentFrame = sequence[index];

  function cancelActive() {
    setActiveAngle(null);
    setPendingFile(null);
  }

  async function saveFrame(angle, blob, w, h) {
    setPendingFile(null);
    setSaving(true);
    setStatus(`⏳ Salvataggio frame ${angle}°...`);
    try {
      await saveRotationFrame({ characterId, angle, imageBlob: blob, width: w, height: h });
      setStatus(`✅ Frame ${angle}° salvato.`);
      setActiveAngle(null);
      await onChanged?.();
    } catch (err) {
      setStatus(`❌ Errore salvataggio frame: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(frameId, angle) {
    if (!confirm(`Eliminare il frame a ${angle}°?`)) return;
    try {
      await deleteRotationFrame(frameId);
      setStatus(`✅ Frame ${angle}° eliminato.`);
      await onChanged?.();
    } catch (err) {
      setStatus(`❌ Errore eliminazione: ${err.message}`);
    }
  }

  async function handleSpeedBlur() {
    const v = Number(speedInput) || 1;
    try {
      await updateCharacterRotationSpeed(characterId, v);
    } catch (err) {
      setStatus(`❌ Errore aggiornamento velocità: ${err.message}`);
    }
  }

  return (
    <div className="rotation-editor">
      <div className="hint">
        Tecnica "frame intermedi": carica poche pose disegnate/generate per il solo lato 0°→180° (fronte, 3/4, profilo,
        3/4 retro, retro) — l'altro lato del giro viene ricostruito da solo specchiando questi stessi frame, come nei
        rig professionali per rotazioni rapide "a scatti". Bastano anche solo 2-3 pose per un effetto convincente; non
        serve disegnare l'intero giro.
      </div>

      <div className="rotation-slots-grid">
        {ANGLE_SLOTS.map(({ angle, label }) => {
          const frame = framesByAngle[angle];
          const isActive = activeAngle === angle;
          return (
            <div key={angle} className="rotation-slot">
              <div className="rotation-slot-label">{label}</div>
              {frame && !isActive && (
                <>
                  <img src={frame.image_url} alt={label} className="rotation-slot-thumb" />
                  <div className="btn-row">
                    <button type="button" className="btn secondary tiny" onClick={() => setActiveAngle(angle)}>
                      🔄
                    </button>
                    <button type="button" className="btn secondary tiny" onClick={() => handleDelete(frame.id, angle)}>
                      ✕
                    </button>
                  </div>
                </>
              )}
              {!frame && !isActive && (
                <button type="button" className="btn secondary tiny" onClick={() => setActiveAngle(angle)} disabled={saving}>
                  ➕ Carica
                </button>
              )}
              {isActive && !pendingFile && (
                <>
                  <input type="file" accept="image/png" onChange={(e) => setPendingFile(e.target.files[0])} />
                  <button type="button" className="btn secondary tiny" onClick={cancelActive}>
                    ✕ Annulla
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {activeAngle !== null && pendingFile && (
        <CropTool file={pendingFile} onDone={(blob, w, h) => saveFrame(activeAngle, blob, w, h)} />
      )}

      {sequence.length > 1 && (
        <>
          <label className="field-label">
            Velocità rotazione (1 = normale)
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={speedInput}
              onChange={(e) => setSpeedInput(e.target.value)}
              onBlur={handleSpeedBlur}
            />
          </label>

          <div className="rotation-preview-stage">
            <div className="rotation-preview-flip" style={{ transform: currentFrame.flip ? "scaleX(-1)" : undefined }}>
              <img key={pulseKey} src={currentFrame.image_url} alt="Anteprima rotazione" className="rotation-preview-img" />
            </div>
          </div>
          <button type="button" className="btn secondary tiny" onClick={() => setPreviewPlaying((p) => !p)}>
            {previewPlaying ? "⏸ Pausa rotazione" : "▶ Anteprima rotazione 360°"}
          </button>
        </>
      )}

      {status && <div className="status">{status}</div>}
    </div>
  );
}
