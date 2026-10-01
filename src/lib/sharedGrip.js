// Conservative fallback, not IK: retain setup grip, disable independent arm/object animation.
export function preserveSharedGrip(parts, objects) {
  if(!objects.some(o=>o.hands.includes('left')&&o.hands.includes('right')))return parts;
  return parts.map(p=>p.role==='arm'||p.partKey.startsWith('oggetto')?{...p,animationType:'static',speed:1}:p);
}
