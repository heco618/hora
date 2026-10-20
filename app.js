(()=>{'use strict';
const $=id=>document.getElementById(id),cv=$('canvas'),ctx=cv.getContext('2d'),work=$('workspace');
let entries=[],index=0,photo=null,photoURL=null,processedURL=null,processedPhoto=null,previewBrush=false,cache=new Map(),W=0,H=0,mask=document.createElement('canvas'),mc=mask.getContext('2d'),strokes=[],redo=[],drawing=null,overlay=document.createElement('canvas'),oc=overlay.getContext('2d'),brush=30,pixel=16,tool='brush',scale=1,tx=0,ty=0,tip=null,gesture=null,loading=false,db=null,project=null,projects=[],comparing=false,offsetDistance=50,offsetDirection='up',frontier=0,markerColor='#a9ef59',markerOpacity=.32;
const fingers=new Map(),clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const dbOpen=()=>new Promise((res,rej)=>{let r=indexedDB.open('mosaic-batch-v2',1);r.onupgradeneeded=()=>{r.result.createObjectStore('images')};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
const put=(key,val)=>new Promise((res,rej)=>{const t=db.transaction('images','readwrite');t.objectStore('images').put(val,key);t.oncomplete=res;t.onerror=()=>rej(t.error)});
const get=key=>new Promise((res,rej)=>{const t=db.transaction('images','readonly'),r=t.objectStore('images').get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
const saveSession=()=>project?put(project.id+':session',{index,frontier,updatedAt:Date.now()}):Promise.resolve();
const saveDraft=()=>entries[index]?put(entries[index].id+':draft',strokes):Promise.resolve();
const del=key=>new Promise((res,rej)=>{const t=db.transaction('images','readwrite');t.objectStore('images').delete(key);t.oncomplete=res;t.onerror=()=>rej(t.error)});
const setBusy=(v,s='処理中…')=>{loading=v;$('busy').textContent=s;$('busy').hidden=!v;update()};
const id=()=>String(Date.now())+'-'+Math.random().toString(36).slice(2);
function update(){
 const total=entries.length,ex=entries.filter(e=>e.status==='excluded').length;
 const processed=Math.min(frontier,total),loc=total?index+1:0;
 $('counter').textContent=`進捗 ${processed} / ${total}枚`;
 $('excludedCount').textContent=`除外 ${ex}枚`;
 $('progress').style.width=(total?100*processed/total:0)+'%';
 $('locationProgress').style.left=(total?100*(Math.max(0,loc-0.5))/total:0)+'%';
 $('progressTrack').setAttribute('aria-valuemax',String(Math.max(1,total)));$('progressTrack').setAttribute('aria-valuenow',String(Math.max(1,loc)));$('progressTrack').setAttribute('aria-valuetext',total?`${loc} / ${total}枚目`:'画像なし');
 const e=entries[index];$('currentLabel').replaceChildren();
 if(e){const filename=document.createElement('span');filename.textContent=`${index+1} / ${total}枚目 ・ ${e.name} `;const badge=document.createElement('span');badge.className='status '+e.status;badge.textContent=({pending:'未処理',mosaic:'モザイク済み',plain:'加工なし',excluded:'除外'})[e.status];$('currentLabel').append(filename,badge)}
 else $('currentLabel').textContent='写真を追加してください';
 for(const name of ['apply','next','exclude','previous','fit','resetImage','brush','eraser','clear','undo','redo'])$(name).disabled=loading||!e||(name==='previous'&&index===0)||(name==='undo'&&!strokes.length)||(name==='redo'&&!redo.length);
 $('apply').textContent=index===entries.length-1?'モザイクして完了':'モザイクして次へ →';
 $('next').textContent=index===entries.length-1?'完了・出力へ':'次へ →';
 $('resetImage').disabled=loading||!e||e.status!=='mosaic';
}
function size(){let r=work.getBoundingClientRect(),d=window.devicePixelRatio||1;cv.width=Math.round(r.width*d);cv.height=Math.round(r.height*d);render()}window.addEventListener('resize',size);
function fit(){if(!photo)return;const r=work.getBoundingClientRect();scale=Math.min(r.width/W,r.height/H)*.96;tx=(r.width-W*scale)/2;ty=(r.height-H*scale)/2;render()}
const pos=e=>{let r=cv.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}},imgPos=p=>({x:(p.x-tx)/scale,y:(p.y-ty)/scale});
function resetMask(){let factor=Math.min(1,1400/Math.max(W,H));mask.width=Math.max(1,Math.round(W*factor));mask.height=Math.max(1,Math.round(H*factor));mc=mask.getContext('2d');overlay.width=mask.width;overlay.height=mask.height;oc=overlay.getContext('2d');strokes=[];redo=[];tip=null}
function drawStroke(s){let k=mask.width/W;mc.save();mc.globalCompositeOperation=s.erase?'destination-out':'source-over';mc.strokeStyle='#fff';mc.fillStyle='#fff';mc.lineCap='round';mc.lineJoin='round';mc.lineWidth=s.width*k;mc.beginPath();const p=s.points;mc.moveTo(p[0].x*k,p[0].y*k);for(let i=1;i<p.length;i++)mc.lineTo(p[i].x*k,p[i].y*k);if(p.length===1)mc.lineTo(p[0].x*k+.001,p[0].y*k);mc.stroke();
if(!s.erase&&s.close&&p.length>2){mc.beginPath();mc.moveTo(p[0].x*k,p[0].y*k);for(let i=1;i<p.length;i++)mc.lineTo(p[i].x*k,p[i].y*k);mc.closePath();mc.fill()}mc.restore()}
function redrawMask(){mc.clearRect(0,0,mask.width,mask.height);for(const s of strokes)drawStroke(s);if(drawing)drawStroke(drawing);oc.clearRect(0,0,overlay.width,overlay.height);oc.drawImage(mask,0,0);oc.globalCompositeOperation='source-in';oc.fillStyle=markerColor;oc.fillRect(0,0,overlay.width,overlay.height);oc.globalCompositeOperation='source-over';render();update()}
function closed(s){if(s.erase||s.points.length<8)return false;const p=s.points,a=p[0],b=p[p.length-1],dist=Math.hypot(a.x-b.x,a.y-b.y);let len=0;for(let i=1;i<p.length;i++)len+=Math.hypot(p[i].x-p[i-1].x,p[i].y-p[i-1].y);return dist<Math.max(s.width*1.4,22/scale)&&len>Math.max(s.width*5,100/scale)}
function render(){const d=window.devicePixelRatio||1,cw=cv.width/d,ch=cv.height/d;ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,cw,ch);if(!photo)return;ctx.save();ctx.translate(tx,ty);ctx.scale(scale,scale);ctx.drawImage(comparing?photo:(processedPhoto||photo),0,0,W,H);if(mask.width){ctx.globalAlpha=markerOpacity; // tint selected pixels using source-in on small overlay
ctx.drawImage(overlay,0,0,W,H)}ctx.restore();
if(tip||previewBrush){const center=tip||{x:cw/2,y:ch/2};ctx.beginPath();ctx.arc(center.x,center.y,Math.max(2,brush*scale/2),0,Math.PI*2);ctx.strokeStyle='#ffffff';ctx.lineWidth=2;ctx.stroke();ctx.beginPath();ctx.arc(center.x,center.y,2,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill()}}
function shifted(p){const vectors={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0],'up-right':[Math.SQRT1_2,-Math.SQRT1_2],'up-left':[-Math.SQRT1_2,-Math.SQRT1_2],'down-right':[Math.SQRT1_2,Math.SQRT1_2],'down-left':[-Math.SQRT1_2,Math.SQRT1_2],none:[0,0]};const v=vectors[offsetDirection]||vectors.up;return{x:p.x+v[0]*offsetDistance,y:p.y+v[1]*offsetDistance}}
function down(e){if(!photo||loading)return;e.preventDefault();cv.setPointerCapture(e.pointerId);fingers.set(e.pointerId,pos(e));if(fingers.size===2){if(drawing){drawing=null;redrawMask()}tip=null;let p=[...fingers.values()],mid={x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2};gesture={dist:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),scale,tx,ty,mid};render();return}if(fingers.size!==1)return;let p=pos(e);tip=shifted(p);let q=imgPos(tip);drawing={erase:tool==='eraser',width:brush,points:[q]};redrawMask()}
function move(e){if(!fingers.has(e.pointerId))return;e.preventDefault();fingers.set(e.pointerId,pos(e));if(fingers.size>=2){if(!gesture)return;let p=[...fingers.values()],mid={x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2},dist=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);let ns=clamp(gesture.scale*dist/Math.max(1,gesture.dist),.02,20);tx=mid.x-(gesture.mid.x-gesture.tx)*ns/gesture.scale;ty=mid.y-(gesture.mid.y-gesture.ty)*ns/gesture.scale;scale=ns;render();return}if(!drawing)return;let p=pos(e);tip=shifted(p);drawing.points.push(imgPos(tip));redrawMask()}
function up(e){if(!fingers.has(e.pointerId))return;e.preventDefault();fingers.delete(e.pointerId);if(drawing&&fingers.size===0){drawing.close=closed(drawing);strokes.push(drawing);drawing=null;redo=[];redrawMask();saveDraft().catch(console.error)}if(fingers.size<2)gesture=null;if(!fingers.size){tip=null;render()}}
for(const [ev,fn] of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up]])cv.addEventListener(ev,fn);
function loadBlob(blob){return new Promise((res,rej)=>{const url=URL.createObjectURL(blob),im=new Image();im.onload=()=>res({im,url});im.onerror=()=>{URL.revokeObjectURL(url);rej(new Error('画像の読み込みに失敗'))};im.src=url})}
async function prefetch(){if(!project)return;for(let i=index+1;i<=Math.min(entries.length-1,index+2);i++){const e=entries[i];if(cache.has(e.id))continue;try{const blob=await get(e.id+':original');if(!blob)continue;let obj=await loadBlob(blob);cache.set(e.id,obj)}catch{}if(cache.size>3)break}}
async function show(i){if(i<0||i>=entries.length)return;const departing=entries[index];if(departing&&i!==index){await del(departing.id+':draft');strokes=[];redo=[];drawing=null}setBusy(true,'画像を読み込み中…');index=i;const e=entries[index];try{await saveSession();let obj=cache.get(e.id);if(obj)cache.delete(e.id);else{let blob=await get(e.id+':original');obj=await loadBlob(blob)}if(photoURL)URL.revokeObjectURL(photoURL);if(processedURL)URL.revokeObjectURL(processedURL);processedURL=null;processedPhoto=null;photo=obj.im;photoURL=obj.url;W=photo.naturalWidth;H=photo.naturalHeight;resetMask();comparing=false;/* Selection is temporary; never restore a draft. */if(e.status==='mosaic'){const output=await get(e.id+':output');if(output){const processed=await loadBlob(output);processedPhoto=processed.im;processedURL=processed.url}}fit();$('hint').style.display='none';$('hint').style.pointerEvents='none';for(const [key,item] of cache){if(!entries.slice(index+1,index+3).some(e=>e.id===key)){URL.revokeObjectURL(item.url);cache.delete(key)}}}catch(err){alert(err.message)}finally{setBusy(false);render();prefetch()}}
async function start(files){
 if(!project){alert('プロジェクトを開いてから写真を追加してください');return}
 if(loading){alert('処理中です。完了後に写真を追加してください');return}
 const selected=[...files].filter(f=>/image\/(png|jpeg)/.test(f.type)).sort((a,b)=>a.name.localeCompare(b.name,'ja',{numeric:true,sensitivity:'base'}));
 if(!selected.length){alert('PNGまたはJPEGを選択してください');return}
 const firstLoad=entries.length===0,oldIndex=index;
 setBusy(true,'画像を追加中…');
 try{
   for(let j=0;j<selected.length;j++){
     const f=selected[j],key=id();
     await put(key+':original',f);
     entries.push({id:key,name:f.name,type:f.type,status:'pending'});
     if(j%10===0)$('busy').textContent=`追加中 ${j+1}/${selected.length}`;
   }
   // Preserve existing image order and processed frontier; new files are appended.
   await put(project.id+':manifest',entries);
   if(firstLoad){index=0;frontier=0}
   else index=oldIndex;
   await saveSession();
   setBusy(false);
   if(firstLoad)await show(0);else update();
 }catch(err){setBusy(false);alert('画像の追加に失敗: '+err.message)}
}
async function outputBlob(mosaic){
 if(!mosaic)return get(entries[index].id+':original');
 const base=processedPhoto||photo;
 const c=document.createElement('canvas');c.width=W;c.height=H;
 const x=c.getContext('2d',{willReadFrequently:false});x.drawImage(base,0,0,W,H);
 const small=document.createElement('canvas');
 small.width=Math.max(1,Math.ceil(W/pixel));small.height=Math.max(1,Math.ceil(H/pixel));
 small.getContext('2d').drawImage(base,0,0,small.width,small.height);
 const layer=document.createElement('canvas');layer.width=W;layer.height=H;
 const l=layer.getContext('2d');l.imageSmoothingEnabled=false;
 l.drawImage(small,0,0,small.width,small.height,0,0,W,H);
 l.globalCompositeOperation='destination-in';l.drawImage(mask,0,0,W,H);
 x.drawImage(layer,0,0);
 const type=entries[index].type;
 return new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error('画像の変換に失敗')),type,type==='image/jpeg'?.96:undefined));
}
async function advance(){let n=index+1;if(n<entries.length)await show(n);else{setBusy(false);openResults()}}
async function commit(kind){if(!photo||loading)return;if(kind==='mosaic'&&!strokes.length){alert('先にペンで範囲を選択してください');return}setBusy(true,kind==='mosaic'?'モザイク処理・保存中…':'保存中…');try{const e=entries[index],blob=await outputBlob(kind==='mosaic');await put(e.id+':output',blob);e.status=kind;await del(e.id+':draft');await put(project.id+':manifest',entries);frontier=Math.max(frontier,index+1);await saveSession();
 // Clear the selection immediately and display the saved result before showing export.
 strokes=[];redo=[];drawing=null;resetMask();
 if(kind==='mosaic'){const saved=await get(e.id+':output');if(!saved)throw new Error('加工結果が保存されていません');const preview=await loadBlob(saved);if(processedURL)URL.revokeObjectURL(processedURL);processedURL=preview.url;processedPhoto=preview.im}
 render();await advance()}catch(err){alert('保存に失敗しました: '+err.message)}finally{setBusy(false)}}
async function resetImage(){if(!entries[index]||loading)return;if(!confirm('この画像のモザイク加工を取り消して元画像に戻しますか？'))return;setBusy(true,'元画像に戻しています…');try{const e=entries[index];await del(e.id+':output');await del(e.id+':draft');e.status='pending';await put(project.id+':manifest',entries);await show(index)}catch(err){alert(err.message)}finally{setBusy(false)}}
async function exclude(){if(!entries[index]||loading)return;setBusy(true);try{const e=entries[index];e.status='excluded';await del(e.id+':output');await del(e.id+':draft');await put(project.id+':manifest',entries);frontier=Math.max(frontier,index+1);await saveSession();await advance()}catch(err){alert(err.message)}finally{setBusy(false)}}
function openResults(){const done=entries.filter(e=>e.status!=='excluded').length,ex=entries.filter(e=>e.status==='excluded').length,pending=entries.filter(e=>e.status==='pending').length;$('summary').textContent=`読み込み ${entries.length}枚 / 出力対象 ${done}枚 / 除外 ${ex}枚 / 未処理 ${pending}枚`; 
$('resultList').replaceChildren();entries.forEach((e,i)=>{const div=document.createElement('div');div.className='item';const name=document.createElement('span');name.textContent=`${i+1}. ${e.name} — ${({pending:'未加工',plain:'未加工',mosaic:'モザイク済み',excluded:'除外'})[e.status]}`;const btn=document.createElement('button');btn.textContent=e.status==='excluded'?'除外を解除':'この画像へ';btn.onclick=async()=>{if(e.status==='excluded'){e.status='pending';await put(project.id+':manifest',entries);openResults();update()}else{$('resultsDialog').close();await show(i)}};div.append(name,btn);$('resultList').append(div)});$('resultsDialog').showModal()}
// Uncompressed ZIP: blob parts avoid loading all images simultaneously into a single ArrayBuffer.
const te=new TextEncoder(),u16=n=>new Uint8Array([n&255,(n>>>8)&255]),u32=n=>new Uint8Array([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]);
const table=(()=>{let t=[];for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[i]=c>>>0}return t})();
async function crc(blob){let c=0xffffffff;for(let start=0;start<blob.size;start+=1024*1024){let a=new Uint8Array(await blob.slice(start,start+1024*1024).arrayBuffer());for(let b of a)c=table[(c^b)&255]^(c>>>8)}return(c^0xffffffff)>>>0}
async function zip(items){let parts=[],central=[],offset=0;for(const item of items){const b=(item.status==='mosaic'?await get(item.id+':output'):null)||await get(item.id+':original');if(!b)throw Error('保存済みデータが見つかりません: '+item.name);const name=te.encode(item.name),check=await crc(b);const local=[u32(0x04034b50),u16(20),u16(0x800),u16(0),u16(0),u16(0),u32(check),u32(b.size),u32(b.size),u16(name.length),u16(0),name];parts.push(...local,b);const cent=[u32(0x02014b50),u16(20),u16(20),u16(0x800),u16(0),u16(0),u16(0),u32(check),u32(b.size),u32(b.size),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name];central.push(...cent);offset+=local.reduce((s,v)=>s+v.byteLength,0)+b.size}
let centralSize=central.reduce((s,v)=>s+v.byteLength,0);parts.push(...central,u32(0x06054b50),u16(0),u16(0),u16(items.length),u16(items.length),u32(centralSize),u32(offset),u16(0));return new Blob(parts,{type:'application/zip'})}
function download(blob,name){let url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
async function checkExport(list){
  let bytes=0,originalCount=0,mosaicCount=0;
  for(let i=0;i<list.length;i++){
    const e=list[i],original=await get(e.id+':original');
    if(!(original instanceof Blob)||!original.size)throw Error(`元画像がありません: ${e.name}`);
    let b=original;
    if(e.status==='mosaic'){
      b=await get(e.id+':output');
      if(!(b instanceof Blob)||!b.size)throw Error(`加工済み画像がありません: ${e.name}`);
      if(b.type!==e.type)throw Error(`保存形式が一致しません: ${e.name}`);
      mosaicCount++;
    }else originalCount++;
    if(!['image/png','image/jpeg'].includes(e.type))throw Error(`未対応形式: ${e.name}`);
    bytes+=b.size;
    if(i%10===0){$('busy').textContent=`保存状態を確認中 ${i+1}/${list.length}`;await new Promise(r=>setTimeout(r,0))}
  }
  return {bytes,originalCount,mosaicCount};
}
async function exportAll(){
 const list=entries.filter(e=>e.status!=='excluded');if(!list.length){alert('書き出せる画像がありません');return}
 const batch=Number($('zipBatch').value);localStorage.setItem('mosaic-zip-batch',String(batch));
 $('resultsDialog').close();setBusy(true,'保存状態を確認中…');
 try{
  const result=await checkExport(list);
  const groups=Math.ceil(list.length/batch);
  const mb=(result.bytes/1048576).toFixed(1);
  if(result.bytes>3.5*1024**3)throw Error('合計サイズが大きすぎます。分割数を150枚にしても失敗する場合は画像を分けて読み込んでください。');
  if(!confirm(`事前チェック完了\n出力 ${list.length}枚（加工 ${result.mosaicCount} / 元画像 ${result.originalCount}）\n合計 約${mb}MB\nZIP ${groups}個（${batch}枚単位）\n\n保存を開始しますか？`))return;
  const used=new Map();let finished=0;
  for(let i=0;i<list.length;i+=batch){
   let group=list.slice(i,i+batch).map(e=>{let n=e.name,count=used.get(n)||0;used.set(n,count+1);if(count){const dot=n.lastIndexOf('.');n=(dot>=0?n.slice(0,dot):n)+`_${count+1}`+(dot>=0?n.slice(dot):'')}return {...e,name:n}});
   $('busy').textContent=`ZIP ${Math.floor(i/batch)+1}/${groups} を作成中…`;
   let b=await zip(group);
   if(b.size>=0xffffffff)throw Error('ZIPが4GBに近づきました。150枚単位を試してください。');
   download(b,`${(project?.name||'mosaic').replace(/[\\/:*?"<>|]/g,'_')}_${String(Math.floor(i/batch)+1).padStart(2,'0')}.zip`);finished++;
   await new Promise(r=>setTimeout(r,900));
  }
  alert(`${finished}個のZIPのダウンロードを開始しました。iPhoneの「ファイル」で実際に保存されたことを確認してください。`);
 }catch(err){alert('書き出しを中断しました: '+err.message)}finally{setBusy(false)}
}
function updateOffset(){offsetDirection=$('offsetDirection').value;offsetDistance=+$('offsetDistance').value;$('offsetValue').textContent=offsetDistance+'px';$('offsetIndicator').textContent='ペン位置：'+({up:'上',down:'下',left:'左',right:'右','up-right':'右上','up-left':'左上','down-right':'右下','down-left':'左下',none:'直下'}[offsetDirection])+' '+(offsetDirection==='none'?0:offsetDistance)+'px';localStorage.setItem('mosaic-offset-direction',offsetDirection);localStorage.setItem('mosaic-offset-distance',offsetDistance)}
$('settings').onclick=()=>{previewBrush=true;render();$('settingsDialog').showModal()};$('closeSettings').onclick=()=>{$('settingsDialog').close()};$('settingsDialog').addEventListener('close',()=>{previewBrush=false;render()});const markerSettingsKey='mosaic-marker-settings-v1';
try{const saved=JSON.parse(localStorage.getItem(markerSettingsKey)||'{}');if(/^#[0-9a-fA-F]{6}$/.test(saved.color))markerColor=saved.color;if(Number.isFinite(saved.opacity))markerOpacity=clamp(saved.opacity,0,1)}catch{}
$('markerColor').value=markerColor;$('markerOpacity').value=String(Math.round(markerOpacity*100));$('markerOpacityValue').textContent=Math.round(markerOpacity*100)+'%';
function updateMarker(){markerColor=$('markerColor').value;markerOpacity=Number($('markerOpacity').value)/100;$('markerOpacityValue').textContent=Math.round(markerOpacity*100)+'%';try{localStorage.setItem(markerSettingsKey,JSON.stringify({color:markerColor,opacity:markerOpacity}))}catch{}redrawMask()}
$('markerColor').addEventListener('input',updateMarker);$('markerOpacity').addEventListener('input',updateMarker);
$('offsetDirection').onchange=updateOffset;$('offsetDistance').oninput=updateOffset;
$('files').onchange=async e=>{
 const input=e.currentTarget;
 // Snapshot File objects before clearing the input; FileList is live on Safari.
 const files=Array.from(input.files||[]);
 input.value='';
 if(!files.length)return;
 try{await start(files);await renderProjectList()}
 catch(err){console.error('Photo import failed',err);alert('写真の追加処理に失敗しました: '+err.message)}
};$('brush').onclick=()=>{tool='brush';$('brush').classList.add('active');$('eraser').classList.remove('active')};$('eraser').onclick=()=>{tool='eraser';$('eraser').classList.add('active');$('brush').classList.remove('active')};
$('brushSize').oninput=e=>{brush=+e.target.value;$('brushValue').textContent=brush+'px';previewBrush=true;localStorage.setItem('mosaic-brush',brush);render()};$('brushSize').addEventListener('change',()=>{previewBrush=false;render()});$('pixelSize').oninput=e=>{pixel=+e.target.value;$('pixelValue').textContent=pixel+'px';$('pixelIndicator').textContent='モザイク '+pixel+'px';localStorage.setItem('mosaic-pixel',pixel)};$('undo').onclick=()=>{if(strokes.length){redo.push(strokes.pop());redrawMask();saveDraft().catch(console.error)}};$('redo').onclick=()=>{if(redo.length){strokes.push(redo.pop());redrawMask();saveDraft().catch(console.error)}};$('clear').onclick=()=>{if(strokes.length){redo.push(...strokes.reverse());strokes=[];redrawMask();saveDraft().catch(console.error)}};$('fit').onclick=fit;$('previous').onclick=()=>show(index-1);$('apply').onclick=()=>commit('mosaic');$('next').onclick=async()=>{if(loading||!entries[index])return;const e=entries[index];if(e.status==='pending'){e.status='plain';await put(project.id+':manifest',entries)}await del(e.id+':draft');strokes=[];redo=[];drawing=null;frontier=Math.max(frontier,index+1);await saveSession();update();await advance()};$('resetImage').onclick=resetImage;$('exclude').onclick=exclude;$('results').onclick=openResults;$('closeResults').onclick=()=>$('resultsDialog').close();$('export').onclick=exportAll;

function showProjectHome(){
  project=null;entries=[];index=0;frontier=0;photo=null;processedPhoto=null;strokes=[];redo=[];
  if(photoURL)URL.revokeObjectURL(photoURL);photoURL=null;
  if(processedURL)URL.revokeObjectURL(processedURL);processedURL=null;
  for(const v of cache.values())URL.revokeObjectURL(v.url);cache.clear();
  $('projectTitle').textContent='ほら！！！';$('projectHome').hidden=false;
  $('hint').style.display='block';$('hint').textContent='写真を追加してください';update();render();
}
async function initializeProjects(){
  projects=await get('projects-v6')||[];
  // Preserve data created by v5 as a separate project without deleting or rewriting it.
  const legacy=await get('manifest');
  if(Array.isArray(legacy)&&legacy.length&&!projects.some(p=>p.id==='legacy-v5')){
    const p={id:'legacy-v5',name:'以前の作業（v5）',created:Date.now(),count:legacy.length};
    projects.unshift(p);await put(p.id+':manifest',legacy);
    const session=await get('session');if(session)await put(p.id+':session',session);
    await put('projects-v6',projects);
  }
}
// Use window-level pointer tracking: iOS Safari can lose pointer capture when a dragged card is reinserted.
let projectDrag=null;
// Cache original layout slots once. Animated transforms must never be used for hit testing.
function beginProjectDrag(event,card,pid,handle){
 if(event.pointerType==='mouse'&&event.button!==0)return;
 if(projectDrag)return;
 event.preventDefault();
 const cards=[...$('projectList').querySelectorAll('.project-card')];
 const rects=cards.map(c=>c.getBoundingClientRect());
 const startIndex=cards.indexOf(card),r=rects[startIndex];
 projectDrag={card,pid,pointerId:event.pointerId,startY:event.clientY,offset:event.clientY-r.top,
   startIndex,targetIndex:startIndex,moved:false,cards,
   slots:rects.map(x=>({top:x.top,height:x.height,mid:x.top+x.height/2}))};
 card.classList.add('project-dragging');
 document.body.classList.add('reordering-project');
 window.addEventListener('pointermove',moveProjectDrag,{passive:false,capture:true});
 window.addEventListener('pointerup',finishProjectDrag,true);
 window.addEventListener('pointercancel',cancelProjectDrag,true);
}
function moveProjectDrag(event){
 const d=projectDrag;if(!d||event.pointerId!==d.pointerId)return;
 event.preventDefault();
 const distance=event.clientY-d.startY;
 d.moved=d.moved||Math.abs(distance)>4;
 const center=d.slots[d.startIndex].mid+distance;
 let target=0;
 for(let i=0;i<d.slots.length;i++){
   if(i===d.startIndex)continue;
   if(center>d.slots[i].mid)target++;
 }
 if(target!==d.targetIndex){
   d.targetIndex=target;
   // Only update sibling transforms when the destination slot changes.
   for(let i=0;i<d.cards.length;i++){
     if(i===d.startIndex)continue;
     const shift=i>d.startIndex&&i<=target
       ?d.slots[i-1].top-d.slots[i].top
       :i<d.startIndex&&i>=target
       ?d.slots[i+1].top-d.slots[i].top:0;
     d.cards[i].style.transform=shift?`translate3d(0,${shift}px,0)`:'';
   }
 }
 d.card.style.transform=`translate3d(0,${distance}px,0)`;
}
async function finishProjectDrag(event){
 const d=projectDrag;if(!d||event.pointerId!==d.pointerId)return;
 const list=$('projectList');
 const oldCards=d.cards;
 const from=d.startIndex;
 const to=d.moved?Math.max(0,Math.min(oldCards.length-1,d.targetIndex)):from;
 removeProjectDragListeners();
 projectDrag=null;
 // Make the project array authoritative. Do not derive the saved order from animated DOM nodes.
 if(from!==to){
   const [moved]=projects.splice(from,1);
   projects.splice(to,0,moved);
 }
 const finalCards=projects.map(p=>oldCards.find(c=>c.dataset.projectId===p.id)).filter(Boolean);
 // The sibling cards have already slid into their destination slots while dragging.
 // Reorder the DOM and clear the temporary transforms with transitions disabled,
 // so releasing the finger does not replay the same animation a second time.
 for(const c of finalCards)c.style.transition='none';
 for(const c of finalCards)list.appendChild(c);
 d.card.classList.remove('project-dragging');
 document.body.classList.remove('reordering-project');
 for(const c of finalCards)c.style.transform='';
 // Restore stylesheet transitions only after the drop frame is painted.
 requestAnimationFrame(()=>requestAnimationFrame(()=>{
   for(const c of finalCards)c.style.removeProperty('transition');
 }));
 try{await put('projects-v6',projects)}catch(err){alert('並び順の保存に失敗しました: '+err.message)}
}
function cancelProjectDrag(event){
 // Mobile Safari may issue pointercancel rather than pointerup after a touch drag.
 // Treat that as a drop, not a rollback, once the card has actually moved.
 const d=projectDrag;if(!d||event.pointerId!==d.pointerId)return;
 if(d.moved){void finishProjectDrag(event);return}
 removeProjectDragListeners();
 for(const c of d.cards){c.style.transform='';c.style.transition=''}
 d.card.classList.remove('project-dragging');
 document.body.classList.remove('reordering-project');
 projectDrag=null;
}
function removeProjectDragListeners(){
 window.removeEventListener('pointermove',moveProjectDrag,true);
 window.removeEventListener('pointerup',finishProjectDrag,true);
 window.removeEventListener('pointercancel',cancelProjectDrag,true);
}
// Scrubbing only changes the displayed image. It never marks an image as processed.
let scrubPointer=null,scrubTarget=null,scrubRunning=false;
function scrubIndex(clientX){const r=$('progressTrack').getBoundingClientRect();return clamp(Math.floor((clientX-r.left)/Math.max(1,r.width)*entries.length),0,entries.length-1)}
async function flushScrub(){if(scrubRunning)return;scrubRunning=true;try{while(scrubTarget!==null){const n=scrubTarget;scrubTarget=null;if(n!==index)await show(n)}}finally{scrubRunning=false}}
function queueScrub(clientX){if(!entries.length||loading&&scrubPointer===null)return;scrubTarget=scrubIndex(clientX);void flushScrub()}
const track=$('progressTrack');
track.addEventListener('pointerdown',e=>{if(!entries.length||scrubPointer!==null)return;e.preventDefault();scrubPointer=e.pointerId;track.setPointerCapture(e.pointerId);queueScrub(e.clientX)});
track.addEventListener('pointermove',e=>{if(e.pointerId===scrubPointer){e.preventDefault();queueScrub(e.clientX)}});
for(const type of ['pointerup','pointercancel','lostpointercapture'])track.addEventListener(type,e=>{if(e.pointerId===scrubPointer){if(type==='pointerup')queueScrub(e.clientX);scrubPointer=null}});
track.addEventListener('keydown',e=>{if(!entries.length)return;const delta=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:e.key==='Home'?-Infinity:e.key==='End'?Infinity:0;if(!delta)return;e.preventDefault();const target=Number.isFinite(delta)?clamp(index+delta,0,entries.length-1):delta<0?0:entries.length-1;scrubTarget=target;void flushScrub()});
async function renderProjectList(){
  $('projectList').replaceChildren();
  for(const p of projects){
    const manifest=await get(p.id+':manifest')||[];
    const card=document.createElement('div');card.className='project-card';card.dataset.projectId=p.id;
    const head=document.createElement('div');head.className='project-card-head';
    const name=document.createElement('div');name.className='project-card-name';name.textContent=p.name;
    const order=document.createElement('button');order.type='button';order.className='project-order';order.setAttribute('aria-label',p.name+' をドラッグして並び替え');order.title='押したまま上下に移動して並び替え';
    order.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
    order.addEventListener('pointerdown',event=>beginProjectDrag(event,card,p.id,order));
    order.addEventListener('contextmenu',event=>event.preventDefault());
    head.append(order,name);
    const meta=document.createElement('div');meta.className='project-card-meta';
    const sess=await get(p.id+':session')||{};const progress=Math.min(manifest.length,Math.max(Number(sess.frontier)||0,manifest.filter(x=>x.status!=='pending').length));
    meta.textContent=`進捗 ${progress} / ${manifest.length}枚 ・ モザイク済み ${manifest.filter(x=>x.status==='mosaic').length}枚 ・ 除外 ${manifest.filter(x=>x.status==='excluded').length}枚`;
    const meter=document.createElement('div');meter.className='project-meter';const fill=document.createElement('div');fill.style.width=(manifest.length?100*progress/manifest.length:0)+'%';meter.append(fill);
    const actions=document.createElement('div');actions.className='project-card-actions';
    const open=document.createElement('button');open.textContent='開く';open.onclick=()=>openProject(p.id);
    const result=document.createElement('button');result.textContent='出力';result.onclick=async()=>{await openProject(p.id);openResults()};
    const rename=document.createElement('button');rename.textContent='名前変更';rename.onclick=async()=>{const n=prompt('プロジェクト名',p.name);if(!n?.trim())return;p.name=n.trim();await put('projects-v6',projects);await renderProjectList()};
    const remove=document.createElement('button');remove.textContent='削除';remove.className='project-delete';remove.onclick=()=>deleteProject(p.id);
    actions.append(open,result,rename,remove);card.append(head,meta,meter,actions);$('projectList').append(card);
  }
}
async function openProject(pid){
  const p=projects.find(p=>p.id===pid);if(!p)return;
  project=p;entries=(await get(p.id+':manifest')||[]).map(e=>({...e,status:e.status}));
  // Preserve saved project order when adding new images.
  $('projectTitle').textContent=p.name;$('projectHome').hidden=true;
  const session=await get(p.id+':session');index=clamp(Number(session?.index)||0,0,Math.max(0,entries.length-1));frontier=Math.max(0,Math.min(entries.length,Number(session?.frontier) || entries.filter(e=>e.status!=='pending').length));
  update();if(entries.length)await show(index);else{$('hint').style.display='block';$('hint').innerHTML='<button id="emptyPick" type="button">＋ 写真を追加</button>';$('hint').style.pointerEvents='auto';$('emptyPick').onclick=()=>$('files').click();size()}
}
async function deleteProject(pid,silent=false){
  const p=projects.find(p=>p.id===pid);if(!p)return;
  if(!silent&&!confirm(`「${p.name}」を削除しますか？\n画像・加工結果も端末内から削除され、復元できません。`))return;
  const list=await get(pid+':manifest')||[];
  for(const e of list)for(const suffix of [':original',':output',':draft'])await del(e.id+suffix);
  await del(pid+':manifest');await del(pid+':session');
  projects=projects.filter(p=>p.id!==pid);await put('projects-v6',projects);
  showProjectHome();await renderProjectList();
}
$('createProject').onclick=async()=>{
  const name=prompt('プロジェクト名','新しいプロジェクト');if(!name?.trim())return;
  const p={id:id(),name:name.trim(),created:Date.now()};
  projects.unshift(p);await put('projects-v6',projects);await put(p.id+':manifest',[]);
  await openProject(p.id);
};
$('addPhotos').onclick=()=>{if(project&&!loading)$('files').click()};$('homeButton').onclick=async()=>{if(loading)return;await renderProjectList();showProjectHome()};

const compare=$('compare');const showOriginal=e=>{if(!photo||loading)return;e.preventDefault();comparing=true;compare.classList.add('comparing');render()};const hideOriginal=e=>{if(e)e.preventDefault();comparing=false;compare.classList.remove('comparing');render()};compare.addEventListener('pointerdown',showOriginal);for(const event of ['pointerup','pointercancel','pointerleave'])compare.addEventListener(event,hideOriginal);window.addEventListener('blur',()=>hideOriginal());
(async()=>{brush=clamp(+(localStorage.getItem('mosaic-brush')||30),2,200);pixel=clamp(+(localStorage.getItem('mosaic-pixel')||16),2,100);$('brushSize').value=brush;$('brushValue').textContent=brush+'px';$('pixelSize').value=pixel;$('pixelValue').textContent=pixel+'px';$('pixelIndicator').textContent='モザイク '+pixel+'px';$('offsetDirection').value=localStorage.getItem('mosaic-offset-direction')||'up';$('offsetDistance').value=localStorage.getItem('mosaic-offset-distance')||50;updateOffset();$('zipBatch').value=localStorage.getItem('mosaic-zip-batch')==='150'?'150':'300';size();try{db=await dbOpen();await initializeProjects();await renderProjectList();showProjectHome()}catch(err){alert('端末内の保存領域を利用できません: '+err.message)}})();
})();
