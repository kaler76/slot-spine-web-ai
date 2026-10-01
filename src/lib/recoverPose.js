import { supabase } from './supabaseClient.js';
export async function recoverPose(canvas) {
  // Bounded upload, aspect ratio unchanged. Pixel coordinates are recovered later.
  const scale=Math.min(1,1280/Math.max(canvas.width,canvas.height));
  const input=document.createElement('canvas');
  input.width=Math.round(canvas.width*scale); input.height=Math.round(canvas.height*scale);
  const ctx=input.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,input.width,input.height);
  ctx.drawImage(canvas,0,0,input.width,input.height);
  const {data,error}=await supabase.functions.invoke('recognize-character-pose',{
    body:{image:input.toDataURL('image/jpeg',0.9)},signal:AbortSignal.timeout(95000)
  });
  if(error || !data?.landmarks) throw new Error('Non siamo riusciti a preparare questo personaggio. Riprova tra poco.');
  return data;
}
