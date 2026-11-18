const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let current=0, zoom=100, all=false;
const select=$('#page-select'), reader=$('#reader');
PAGES.forEach((p,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`${p.label} · ${p.title}`;select.append(o)});
function showTab(tab,scroll=true){if(!['home','crates','model','viewer','guide'].includes(tab))tab='home';$$('.panel').forEach(x=>x.hidden=x.id!==tab);$$('.tabs button').forEach(b=>{if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});if(tab==='guide'&&!reader.children.length)renderPages();if(scroll)window.scrollTo({top:0});}
function route(){const [tab,label]=location.hash.slice(1).split('/');if(tab==='guide'&&label){const n=label.startsWith('page-')?PAGES.findIndex(p=>p.label===label.slice(5)):PAGES.findIndex(p=>p.legacyLabel===label);if(n>=0){current=n;all=false;renderPages()}}showTab(tab||'home');if(tab==='viewer')window.LB3D.activate(label||'unit');}
function navigate(hash){if(location.hash==='#'+hash)route();else location.hash=hash;}
$$('[data-tab]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.tab)));
$$('[data-page]').forEach(b=>b.addEventListener('click',()=>{location.hash='guide/page-'+b.dataset.page;route()}));
function setSize(){reader.querySelectorAll('.page-image').forEach(im=>im.style.width=zoom+'%');$('#zoom-status').textContent=zoom+'%';$('#zoom-out').disabled=zoom<=100;$('#zoom-in').disabled=zoom>=400;}
function renderPages(){reader.replaceChildren();const list=all?PAGES:[PAGES[current]];list.forEach((p,i)=>{const im=document.createElement('img');im.src=p.src;im.alt=`עמוד ${p.label} — ${p.title}`;im.className='page-image';im.width=1123;im.height=794;if(all&&i>1)im.loading='lazy';reader.append(im)});select.value=current;$('#page-status').textContent=all?`כל ${PAGES.length} העמודים — לפי סדר החוברת`:`עמוד ${PAGES[current].label} מתוך ${PAGES.length} · ${PAGES[current].title}`;$('#all-pages').textContent=all?'עמוד יחיד':'כל העמודים';$('#all-pages').setAttribute('aria-pressed',String(all));$('#previous').disabled=current===0;$('#next').disabled=current===PAGES.length-1;$$('[data-step]').forEach(b=>b.disabled=(b.dataset.step==='-1'&&current===0)||(b.dataset.step==='1'&&current===PAGES.length-1));setSize();reader.scrollTop=0;reader.scrollLeft=0;}
function step(n){current=Math.max(0,Math.min(PAGES.length-1,current+n));all=false;renderPages();history.replaceState(null,'','#guide/page-'+PAGES[current].label)}
select.addEventListener('change',()=>{current=Number(select.value);all=false;renderPages();history.replaceState(null,'','#guide/page-'+PAGES[current].label)});
$('#previous').onclick=()=>step(-1);$('#next').onclick=()=>step(1);$$('[data-step]').forEach(b=>b.onclick=()=>step(Number(b.dataset.step)));
$('#zoom-in').onclick=()=>{zoom=Math.min(400,zoom+50);setSize()};$('#zoom-out').onclick=()=>{zoom=Math.max(100,zoom-50);setSize()};$('#fit').onclick=()=>{zoom=100;setSize()};$('#all-pages').onclick=()=>{all=!all;renderPages()};
$$('[data-image]').forEach(b=>b.onclick=()=>{$('#large-image').src=b.dataset.image;$('#large-image').alt=b.dataset.caption;$('#image-caption').textContent=b.dataset.caption;$('#image-dialog').showModal()});$('#close-image').onclick=()=>$('#image-dialog').close();
$$('[data-scene]').forEach(b=>b.addEventListener('click',()=>navigate('viewer/'+b.dataset.scene)));
window.addEventListener('hashchange',route);route();
