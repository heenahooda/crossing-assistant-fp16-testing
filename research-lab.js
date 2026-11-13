/* Four-model FP16 evaluation panel. Model-only inspection; no safety announcements. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const models = {
    canonical_gt_fp16: {label:'Canonical GT FP16', file:'./models/canonical_gt_fp16.tflite'},
    canonical_pseudo_fp16: {label:'Canonical Pseudo FP16', file:'./models/canonical_pseudo_fp16.tflite'},
    normal_gt_fp16: {label:'Normal GT FP16', file:'./models/normal_gt_fp16.tflite'},
    normal_pseudo_fp16: {label:'Normal Pseudo FP16', file:'./models/normal_pseudo_fp16.tflite'}
  };
  let loaded = null, loadedId = '', selectedImage = null, latest = null;
  const status = msg => { if ($('evalStatus')) $('evalStatus').textContent = msg; };
  const fmt = n => Number(n).toFixed(2);
  function disposeOutput(out) {
    const list = out && typeof out.data === 'function' ? [out] : Array.isArray(out) ? out : Object.values(out || {});
    list.forEach(t => { if (t && typeof t.dispose === 'function') t.dispose(); });
  }
  function outputSummary(out) {
    const list = out && typeof out.data === 'function' ? [out] : Array.isArray(out) ? out : Object.values(out || {});
    return Promise.all(list.map(async (t,i) => ({index:i,shape:t.shape ? Array.from(t.shape) : [],dtype:t.dtype||'unknown',values:Array.from((await t.data()).slice(0,12))})));
  }
  async function loadSelected() {
    const id = $('evalModel').value, m = models[id];
    if (!window.tf || !window.tflite) { status('TFLite runtime did not load. Check internet access, then reload this page.'); return; }
    $('evalLoad').disabled = true; $('evalRun').disabled = true; status('Loading ' + m.label + '…');
    try {
      if (window.tflite.setWasmPath) window.tflite.setWasmPath('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-tflite@0.0.1-alpha.10/dist/');
      const response = await fetch(m.file);
      if (!response.ok) throw new Error('Model file request failed (' + response.status + ').');
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength < 1000000) throw new Error('Model file looks incomplete.');
      const model = await window.tflite.loadTFLiteModel(buffer);
      loaded = model; loadedId = id;
      const ins = (model.inputs||[]).map(x => `${x.name||'input'} [${Array.from(x.shape||[]).join('×')}] ${x.dtype||''}`).join('; ');
      const outs = (model.outputs||[]).map(x => `${x.name||'output'} [${Array.from(x.shape||[]).join('×')}] ${x.dtype||''}`).join('; ');
      $('evalModelInfo').textContent = `${m.label} · ${(buffer.byteLength/1048576).toFixed(2)} MB · Input: ${ins||'shape unavailable'} · Outputs: ${outs||'shape unavailable'}`;
      $('evalRun').disabled = !selectedImage;
      status('Model loaded successfully. Select an image, then run the test.');
    } catch (e) { loaded = null; loadedId=''; $('evalModelInfo').textContent='Model not loaded.'; status('Load failed: ' + (e.message||String(e))); }
    finally { $('evalLoad').disabled = false; }
  }
  function imageInput(img, spec) {
    const sh = spec.shape || [];
    let h,w,nchw=false;
    if (sh.length===4 && sh[3]===3) { h=sh[1]; w=sh[2]; }
    else if (sh.length===4 && sh[1]===3) { nchw=true; h=sh[2]; w=sh[3]; }
    else throw new Error('Unsupported model input shape: ['+sh.join(',')+']');
    if (!h || !w || h>2048 || w>2048) throw new Error('Invalid input dimensions.');
    const c=$('evalInputPreview'); c.width=w; c.height=h;
    const ctx=c.getContext('2d',{willReadFrequently:true}); ctx.drawImage(img,0,0,w,h);
    const rgba=ctx.getImageData(0,0,w,h).data, count=w*h, data=new Float32Array(count*3);
    for(let i=0;i<count;i++) for(let k=0;k<3;k++) data[nchw?k*count+i:i*3+k]=rgba[i*4+k]/255;
    return {data,shape:nchw?[1,3,h,w]:[1,h,w,3],h,w};
  }
  async function runImage() {
    if (!loaded || !selectedImage) return;
    const id=$('evalModel').value;
    if(id!==loadedId){status('The selected model differs from the loaded model. Load it first.');return;}
    $('evalRun').disabled=true; status('Running inference…');
    let input=null, output=null;
    try {
      const spec=loaded.inputs && loaded.inputs[0];
      if(!spec) throw new Error('Model input metadata is unavailable.');
      const prepared=imageInput(selectedImage,spec);
      input=tf.tensor(prepared.data,prepared.shape,'float32');
      // Warm-up is excluded from the reported timings.
      output=loaded.predict(input); await outputSummary(output); disposeOutput(output); output=null;
      const times=[]; let finalOut=null;
      for(let i=0;i<10;i++){
        const t0=performance.now(); const out=loaded.predict(input); await tf.nextFrame();
        times.push(performance.now()-t0);
        if(i===9) finalOut=out; else disposeOutput(out);
      }
      const summary=await outputSummary(finalOut); disposeOutput(finalOut);
      const sorted=[...times].sort((a,b)=>a-b), avg=times.reduce((a,b)=>a+b,0)/times.length, med=sorted[5];
      latest={model:models[id].label,modelId:id,image:selectedImage.name,inputShape:prepared.shape,normalization:'RGB / 255 (provisional; confirm model training preprocessing)',warmupRuns:1,measuredRuns:10,meanMs:avg,medianMs:med,estimatedModelOnlyFps:1000/avg,outputs:summary,createdAt:new Date().toISOString()};
      $('evalTiming').textContent=`Mean: ${fmt(avg)} ms · Median: ${fmt(med)} ms · Model-only estimate: ${fmt(1000/avg)} FPS (10 runs)`;
      $('evalPhoneSpeed').textContent=`${fmt(avg)} ms mean / ${fmt(1000/avg)} FPS (this device)`;
      $('evalOutput').textContent=JSON.stringify(summary,null,2);
      $('evalExport').disabled=false;
      status('Inference completed. Outputs are raw tensors, not interpreted detections.');
    } catch(e) { status('Inference failed: '+(e.message||String(e))); }
    finally { if(input) input.dispose(); $('evalRun').disabled=!loaded || !selectedImage; }
  }
  $('evalImage')?.addEventListener('change',e=>{
    const f=e.target.files && e.target.files[0]; if(!f)return;
    if(selectedImage && selectedImage.src) URL.revokeObjectURL(selectedImage.src);
    const img=new Image(); img.onload=()=>{selectedImage=img;selectedImage.name=f.name;selectedImage.src=URL.createObjectURL(f);$('evalPreview').src=selectedImage.src;$('evalPreview').hidden=false;$('evalRun').disabled=!loaded;status('Image ready. Load a model if you have not already.');};
    img.onerror=()=>status('Could not read this image.'); img.src=URL.createObjectURL(f);
  });
  $('evalLoad')?.addEventListener('click',loadSelected);
  $('evalRun')?.addEventListener('click',runImage);
  $('evalModel')?.addEventListener('change',()=>{loaded=null;loadedId='';$('evalRun').disabled=true;$('evalModelInfo').textContent='Load the selected model to inspect its tensor shapes.';$('evalTiming').textContent='Inference time: —';$('evalOutput').textContent='No inference run yet.';status('Model selection changed. Load this model before running inference.');});
  $('evalExport')?.addEventListener('click',()=>{if(!latest)return;const a=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify(latest,null,2)],{type:'application/json'}));a.href=url;a.download='crossing-model-test-'+latest.modelId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);});
  if($('evalStatus')) status('Ready. Runtime loads from CDN; internet is needed for first-time runtime download. Model files are stored in this app repository.');
})();
