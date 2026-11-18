/* MORAL read-only CAD display. No third-party services or geometry edits. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const canvas=byId('cad-canvas'), box=byId('cad-stage'), status=byId('cad-status');
  const names={unit:'היחידה','crate-a':'ארגז A','crate-b':'ארגז B'};
  let gl, program, solidVAO, edgeVAO, buffers=[], texture, meta, active='', token=0, controller;
  let yaw=0, pitch=.6, zoom=1, pan=[0,0], ready=false, frame=0, fitScale=1, radius=1;
  let showCovers=true, showEdges=true, pointers=new Map(), contextLost=false, selected=-1, pickTarget=null;
  const panel=byId('cad-selection'), picker=byId('cad-part-list');
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const norm=a=>{const n=Math.hypot(...a);return a.map(x=>x/n);};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
  const VS=`#version 300 es
  layout(location=0) in vec3 position;layout(location=1) in vec3 normal;layout(location=2) in float part;
  uniform sampler2D palette;uniform vec3 quantum,right,up,camera;uniform vec2 pan;uniform float sx,sy,sz;uniform bool edges;
  out vec3 N;flat out vec4 tint;flat out int partId;
  void main(){vec3 p=position*quantum;gl_Position=vec4((dot(p,right)+pan.x)*sx,(dot(p,up)+pan.y)*sy,-dot(p,camera)*sz,1.);if(edges)gl_Position.z-=.000008;N=normal;partId=int(part);tint=texelFetch(palette,ivec2(int(part),0),0);}`;
  const FS=`#version 300 es
  precision highp float;precision highp int;in vec3 N;flat in vec4 tint;flat in int partId;uniform vec3 camera;uniform bool edges,picking;uniform int selected;out vec4 outColor;
  void main(){if(tint.a<.5)discard;if(picking){int id=partId+1;outColor=vec4(float(id%256)/255.,float(id/256)/255.,0.,1.);return;}if(edges){outColor=vec4(.12,.17,.18,1.);return;}vec3 n=normalize(N);if(!gl_FrontFacing)n=-n;float key=max(dot(n,normalize(vec3(-.4,-.6,1.))),0.);float fill=max(dot(n,normalize(vec3(.8,.4,.6))),0.);float light=.62+.25*key+.13*fill;vec3 base=partId==selected?mix(tint.rgb,vec3(1.,.55,.12),.7):tint.rgb;outColor=vec4(base*light,1.);}`;
  function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('Shader compile');return s;}
  function init(){
    if(gl&&!contextLost)return;
    gl=canvas.getContext('webgl2',{antialias:true,alpha:false,powerPreference:'low-power',preserveDrawingBuffer:false});
    if(!gl)throw Error('NO_WEBGL');
    program=gl.createProgram();const v=shader(gl.VERTEX_SHADER,VS),f=shader(gl.FRAGMENT_SHADER,FS);gl.attachShader(program,v);gl.attachShader(program,f);gl.linkProgram(program);gl.deleteShader(v);gl.deleteShader(f);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Shader link');
    gl.useProgram(program);contextLost=false;pickTarget=null;
  }
  function release(){for(const b of buffers)gl.deleteBuffer(b);buffers=[];if(solidVAO)gl.deleteVertexArray(solidVAO);if(edgeVAO)gl.deleteVertexArray(edgeVAO);if(texture)gl.deleteTexture(texture);solidVAO=edgeVAO=texture=null;ready=false;}
  function buffer(target,data){const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(target,b);gl.bufferData(target,data,gl.STATIC_DRAW);return b;}
  function install(data){
    release();gl.useProgram(program);
    solidVAO=gl.createVertexArray();gl.bindVertexArray(solidVAO);
    buffer(gl.ARRAY_BUFFER,new Uint8Array(data,meta.sections[0].offset,meta.sections[0].bytes));
    for(const [loc,count,offset] of [[0,3,0],[1,3,6],[2,1,12]]){gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,count,gl.SHORT,false,14,offset);}
    buffer(gl.ELEMENT_ARRAY_BUFFER,new Uint8Array(data,meta.sections[1].offset,meta.sections[1].bytes));
    edgeVAO=gl.createVertexArray();gl.bindVertexArray(edgeVAO);
    buffer(gl.ARRAY_BUFFER,new Uint8Array(data,meta.sections[2].offset,meta.sections[2].bytes));
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.SHORT,false,8,0);gl.disableVertexAttribArray(1);gl.vertexAttrib3f(1,0,0,1);gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,1,gl.SHORT,false,8,6);
    texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    updatePalette();ready=true;reset();
  }
  function updatePalette(){if(!meta||!texture)return;const a=new Float32Array(1024*4),hide=new Set(showCovers?[]:meta.cover_ids);for(const id of meta.part_ids)a.set([...meta.colors[id],hide.has(id)?0:1],id*4);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,1024,1,0,gl.RGBA,gl.FLOAT,a);}
  function axes(){const camera=[Math.cos(pitch)*Math.cos(yaw),Math.cos(pitch)*Math.sin(yaw),Math.sin(pitch)],right=norm(cross([0,0,1],camera));return {camera,right,up:cross(camera,right)};}
  function fit(){if(!meta)return;const {right,up}=axes(),d=meta.hi_mm.map((v,i)=>(v-meta.lo_mm[i])/2);const w=2*d.reduce((s,v,i)=>s+Math.abs(right[i])*v,0),h=2*d.reduce((s,v,i)=>s+Math.abs(up[i])*v,0);fitScale=Math.min(canvas.width/(w*1.15),canvas.height/(h*1.15));radius=Math.hypot(...d);}
  function reset(){if(!meta)return;const c=norm(meta.camera);yaw=Math.atan2(c[1],c[0]);pitch=Math.asin(c[2]);zoom=1;pan=[0,0];fit();drawSoon();}
  function resize(){const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;const d=Math.min(window.devicePixelRatio||1,1.5);const w=Math.round(r.width*d),h=Math.round(r.height*d);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;fit();drawSoon();}}
  function drawSoon(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;draw();});}
  function draw(picking=false){
    if(!ready||contextLost||byId('viewer').hidden)return;
    const a=axes();gl.useProgram(program);gl.viewport(0,0,canvas.width,canvas.height);gl.uniform1i(gl.getUniformLocation(program,'picking'),picking?1:0);gl.uniform1i(gl.getUniformLocation(program,'selected'),selected);gl.clearColor(...(picking?[0,0,0,0]:[.962,.961,.946,1]));gl.enable(gl.DEPTH_TEST);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    for(const [k,v] of Object.entries(a))gl.uniform3fv(gl.getUniformLocation(program,k),v);
    gl.uniform3fv(gl.getUniformLocation(program,'quantum'),meta.step_mm);gl.uniform2fv(gl.getUniformLocation(program,'pan'),pan);
    gl.uniform1f(gl.getUniformLocation(program,'sx'),2*fitScale*zoom/canvas.width);gl.uniform1f(gl.getUniformLocation(program,'sy'),2*fitScale*zoom/canvas.height);gl.uniform1f(gl.getUniformLocation(program,'sz'),1/Math.max(radius*2,1));
    gl.uniform1i(gl.getUniformLocation(program,'edges'),0);gl.bindVertexArray(solidVAO);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1,1);gl.drawElements(gl.TRIANGLES,meta.indices,gl.UNSIGNED_INT,0);gl.disable(gl.POLYGON_OFFSET_FILL);
    if(showEdges&&!picking){gl.uniform1i(gl.getUniformLocation(program,'edges'),1);gl.bindVertexArray(edgeVAO);gl.drawArrays(gl.LINES,0,meta.edge_vertices);}
    const error=gl.getError();canvas.dataset.renderError=String(error);canvas.dataset.scene=active;canvas.dataset.zoom=zoom.toFixed(3);canvas.dataset.yaw=yaw.toFixed(3);canvas.dataset.pitch=pitch.toFixed(3);canvas.dataset.covers=String(showCovers);canvas.dataset.ready='true';
  }
  async function fetchData(url,signal){
    const r=await fetch(url,{signal});if(!r.ok)throw Error('Download '+r.status);
    const total=Number(r.headers.get('Content-Length'))||meta.download_bytes,reader=r.body.getReader(),chunks=[];let received=0;
    while(true){const {value,done}=await reader.read();if(done)break;chunks.push(value);received+=value.length;status.textContent='טוען את '+names[active]+'… '+Math.min(100,Math.round(received/total*100))+'%';}
    return new Blob(chunks).stream().pipeThrough(new DecompressionStream('gzip'));
  }
  async function activate(key='unit'){
    if(!names[key])key='unit';
    if(active===key&&ready){resize();drawSoon();return;}
    const mine=++token;if(controller)controller.abort();controller=new AbortController();active=key;ready=false;selected=-1;panel.hidden=true;canvas.dataset.ready='false';pointers.clear();
    byId('cad-title').textContent=names[key];byId('cad-cover-control').hidden=key==='unit';
    document.querySelectorAll('[data-scene]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scene===key)));
    byId('cad-loading').hidden=false;byId('cad-error').hidden=true;status.textContent='טוען את '+names[key]+'…';
    try{
      init();resize();if(!window.DecompressionStream)throw Error('NO_GZIP');
      const embedded=window.LB_3D_BUNDLES?.[key];
      let data;
      if(embedded){meta=embedded.meta;const binary=Uint8Array.from(atob(embedded.data),x=>x.charCodeAt(0));data=await new Response(new Blob([binary]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();}
      else {const r=await fetch('models/'+key+'.json?v=24',{signal:controller.signal});if(!r.ok)throw Error('Metadata '+r.status);meta=await r.json();data=await new Response(await fetchData('models/'+meta.file,controller.signal)).arrayBuffer();}
      if(mine!==token)return;
      selected=-1;panel.hidden=true;picker.replaceChildren(new Option('בחירת חלק לפי מספר…',''));for(const part of [...meta.parts].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})||a.index-b.index)){picker.add(new Option(part.name+' · '+part.parent+' · #'+(part.index+1),String(part.index)));}
      install(data);byId('cad-loading').hidden=true;status.textContent='התצוגה מוכנה';canvas.setAttribute('aria-label','תצוגת תלת־ממד של '+names[key]+'. גרירה לסיבוב, שתי אצבעות להגדלה ולהזזה.');
    }catch(e){if(mine!==token||e.name==='AbortError')return;ready=false;byId('cad-loading').hidden=true;byId('cad-error').hidden=false;status.textContent=e.message==='NO_WEBGL'?'תצוגת התלת־ממד אינה זמינה בדפדפן הזה. אפשר להשתמש במבטי התמונה.':e.message==='NO_GZIP'?'נדרש דפדפן מעודכן לצפייה בתלת־ממד.':'הטעינה לא הושלמה. אפשר לנסות שוב.';canvas.dataset.renderError=e.message;}
  }
  function zoomBy(f){if(!ready)return;zoom=clamp(zoom*f,.45,12);drawSoon();}
  function movePan(dx,dy){const d=canvas.width/canvas.getBoundingClientRect().width;pan[0]+=dx*d/(fitScale*zoom);pan[1]-=dy*d/(fitScale*zoom);}
  function selectPart(id){
    const part=meta.parts.find(p=>p.index===id);selected=part?id:-1;panel.hidden=!part;picker.value=part?String(id):'';
    if(part){byId('cad-part-name').textContent=part.name;byId('cad-part-parent').textContent=part.parent;byId('cad-part-note').textContent=part.note||'';const link=byId('cad-part-guide');link.hidden=!part.guide_page;link.href='#guide/'+part.guide_page;link.textContent=part.stage==='פריקה'?'להוראות הפריקה ←':'לשלב '+part.stage+' בחוברת ←';const u=byId('cad-part-unpack');u.hidden=!part.unpack_page||part.unpack_page===part.guide_page;u.href='#guide/'+part.unpack_page;const extra=byId('cad-part-related');extra.hidden=!part.related_page;extra.href='#guide/'+part.related_page;extra.textContent=part.related_label||'';canvas.dataset.selectedPart=part.name;canvas.dataset.selectedIndex=String(id);}
    else{delete canvas.dataset.selectedPart;delete canvas.dataset.selectedIndex;}drawSoon();
  }
  function pick(x,y){
    if(!ready)return;const w=canvas.width,h=canvas.height;
    if(!pickTarget||pickTarget.w!==w||pickTarget.h!==h){
      if(pickTarget){gl.deleteFramebuffer(pickTarget.fb);gl.deleteTexture(pickTarget.tex);gl.deleteRenderbuffer(pickTarget.depth);}
      const fb=gl.createFramebuffer(),tex=gl.createTexture(),depth=gl.createRenderbuffer();gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,w,h);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Pick framebuffer');pickTarget={fb,tex,depth,w,h};
    }
    gl.bindTexture(gl.TEXTURE_2D,texture);gl.bindFramebuffer(gl.FRAMEBUFFER,pickTarget.fb);gl.disable(gl.DITHER);draw(true);const r=canvas.getBoundingClientRect(),px=clamp(Math.floor((x-r.left)*w/r.width),0,w-1),py=clamp(h-1-Math.floor((y-r.top)*h/r.height),0,h-1),v=new Uint8Array(4);gl.readPixels(px,py,1,1,gl.RGBA,gl.UNSIGNED_BYTE,v);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.enable(gl.DITHER);selectPart(v[0]+v[1]*256-1);draw();
  }
  for(const link of panel.querySelectorAll('a'))link.addEventListener('click',async e=>{e.preventDefault();const target=link.getAttribute('href');if(document.fullscreenElement)await document.exitFullscreen();box.classList.remove('cad-expanded');location.hash=target;});
  picker.onchange=()=>selectPart(Number(picker.value||-1));byId('cad-clear-selection').onclick=()=>selectPart(-1);
  canvas.addEventListener('pointerdown',e=>{if(!ready)return;canvas.focus({preventScroll:true});pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,x0:e.clientX,y0:e.clientY,button:e.button,moved:false,multi:pointers.size>0});if(pointers.size>1)for(const p of pointers.values())p.multi=true;canvas.setPointerCapture(e.pointerId);e.preventDefault();});
  canvas.addEventListener('pointermove',e=>{if(!ready||!pointers.has(e.pointerId))return;const old=pointers.get(e.pointerId),before=[...pointers.values()],moved=old.moved||Math.hypot(e.clientX-old.x0,e.clientY-old.y0)>5;pointers.set(e.pointerId,{...old,x:e.clientX,y:e.clientY,moved});const after=[...pointers.values()];if(after.length===1&&moved){if(old.button===2||e.shiftKey)movePan(e.clientX-old.x,e.clientY-old.y);else{yaw-=(e.clientX-old.x)*.008;pitch=clamp(pitch+(e.clientY-old.y)*.008,-1.54,1.54);}}else if(after.length===2){const dist=a=>Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),a=dist(before),b=dist(after);if(a>1)zoom=clamp(zoom*b/a,.45,12);movePan((after[0].x+after[1].x-before[0].x-before[1].x)/2,(after[0].y+after[1].y-before[0].y-before[1].y)/2);}e.preventDefault();drawSoon();});
  canvas.addEventListener('pointerup',e=>{const p=pointers.get(e.pointerId);pointers.delete(e.pointerId);if(p&&!p.moved&&!p.multi&&p.button===0)pick(e.clientX,e.clientY);});
  for(const n of ['pointercancel','lostpointercapture'])canvas.addEventListener(n,e=>pointers.delete(e.pointerId));
  canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('wheel',e=>{if(!ready)return;e.preventDefault();zoomBy(Math.exp(-e.deltaY*.0015));},{passive:false});
  canvas.addEventListener('dblclick',reset);canvas.addEventListener('keydown',e=>{if(!ready)return;const k=e.key;if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Home'].includes(k))return;e.preventDefault();if(k==='Home')reset();else if(k==='+'||k==='=')zoomBy(1.25);else if(k==='-')zoomBy(.8);else{yaw+=k==='ArrowLeft'?.12:k==='ArrowRight'?-.12:0;pitch=clamp(pitch+(k==='ArrowUp'?.12:k==='ArrowDown'?-.12:0),-1.54,1.54);drawSoon();}});
  byId('cad-in').onclick=()=>zoomBy(1.25);byId('cad-out').onclick=()=>zoomBy(.8);byId('cad-reset').onclick=reset;
  byId('cad-covers').onchange=e=>{showCovers=e.target.checked;updatePalette();drawSoon();};byId('cad-edges').onchange=e=>{showEdges=e.target.checked;drawSoon();};
  byId('cad-retry').onclick=()=>activate(active);
  byId('cad-fullscreen').onclick=async()=>{if(document.fullscreenElement){await document.exitFullscreen();}else if(box.requestFullscreen){try{await box.requestFullscreen();}catch{box.classList.toggle('cad-expanded');}}else box.classList.toggle('cad-expanded');byId('cad-fullscreen').textContent=document.fullscreenElement||box.classList.contains('cad-expanded')?'יציאה ממסך מלא':'מסך מלא';resize();};
  document.addEventListener('fullscreenchange',()=>{byId('cad-fullscreen').textContent=document.fullscreenElement?'יציאה ממסך מלא':'מסך מלא';resize();});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();contextLost=true;ready=false;status.textContent='התצוגה הושהתה. טען מחדש כדי להמשיך.';byId('cad-error').hidden=false;});
  canvas.addEventListener('webglcontextrestored',()=>{gl=null;contextLost=false;activate(active);});
  new ResizeObserver(resize).observe(canvas);
  window.LB3D={activate};
})();
