// Coordinates normalized to image dimensions; anatomical left/right (not viewer).
export const REQUIRED_POINTS = [0, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
export function validatePose(points) {
  if (!Array.isArray(points) || points.length !== 33) throw new Error('pose_shape');
  for (const i of REQUIRED_POINTS) {
    const p = points[i];
    if (!p || ![p.x, p.y, p.visibility].every(Number.isFinite) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || p.visibility < 0.5 || p.visibility > 1) throw new Error('pose_point');
  }
  const d = (a,b) => Math.hypot(points[a].x-points[b].x,points[a].y-points[b].y);
  if (d(11,12)<0.035 || d(23,24)<0.015 || d(11,23)<0.05 || d(12,24)<0.05) throw new Error('pose_collapsed');
  for (const [a,b] of [[11,13],[13,15],[12,14],[14,16]]) if(d(a,b)<0.01 || d(a,b)>0.7) throw new Error('pose_limb');
  return points;
}
export function validateRecovery(data) {
  validatePose(data?.landmarks);
  if (!Number.isFinite(data.confidence) || data.confidence < 0.7 || data.confidence > 1) throw new Error('pose_confidence');
  if (!Array.isArray(data.heldObjects) || data.heldObjects.length>4) throw new Error('pose_objects');
  for (const o of data.heldObjects) {
    if (typeof o.label!=='string' || o.label.length>100 || !Array.isArray(o.hands) || !o.hands.length || new Set(o.hands).size!==o.hands.length || o.hands.some(h=>!['left','right'].includes(h))) throw new Error('pose_grip');
  }
  return data;
}
export async function resolvePose({ detect, recover, width, height }) {
  let points;
  try { points=validatePose((await detect())?.landmarks?.[0]); } catch { /* Recover once, server bounds its own retries. */ }
  let source='mediapipe', heldObjects=[];
  if (!points) {
    const result=validateRecovery(await recover());
    points=result.landmarks; heldObjects=result.heldObjects; source='vision';
  }
  return { source, heldObjects, landmarks:points.map(p=>({x:p.x*width,y:p.y*height,visibility:p.visibility??0})) };
}
