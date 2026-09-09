// PHOTO FEST Live Gallery v1
// Detecta fotos nuevas sin que el invitado tenga que recargar la página.
(function(){
  if(!location.pathname.endsWith('galeria.html')) return;
  let lastPaths=new Set(),ready=false,pending=0,checking=false;
  const style=document.createElement('style');
  style.textContent='.pf-live{position:fixed;left:50%;bottom:24px;transform:translate(-50%,25px);z-index:90;border:0;border-radius:999px;background:#111;color:#fff;padding:13px 18px;font:700 12px Arial,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.25);opacity:0;pointer-events:none;transition:.25s}.pf-live.show{opacity:1;pointer-events:auto;transform:translate(-50%,0)}';
  document.head.appendChild(style);
  const btn=document.createElement('button');btn.className='pf-live';document.body.appendChild(btn);
  function base(){return (window.PHOTOFEST_SUPABASE_URL||'').replace(/\/$/,'')}
  function key(){return window.PHOTOFEST_SUPABASE_PUBLISHABLE_KEY||window.PHOTOFEST_SUPABASE_KEY||''}
  async function json(path){const r=await fetch(base()+'/rest/v1/'+path,{headers:{apikey:key(),Authorization:'Bearer '+key()}});if(!r.ok)throw new Error('live');return r.json()}
  async function snapshot(){
    if(checking||document.hidden)return;checking=true;
    try{
      const slug=new URLSearchParams(location.search).get('evento');if(!slug)return;
      const es=await json('events?slug=eq.'+encodeURIComponent(slug)+'&status=eq.active&select=id&limit=1');if(!es.length)return;
      const rows=await json('photos?event_id=eq.'+encodeURIComponent(es[0].id)+'&select=storage_path&order=created_at.asc');
      const now=new Set(rows.map(x=>x.storage_path));
      if(!ready){lastPaths=now;ready=true;return}
      let added=0;now.forEach(p=>{if(!lastPaths.has(p))added++});
      if(added){pending+=added;lastPaths=now;btn.textContent='✨ '+pending+' foto'+(pending===1?' nueva':'s nuevas');btn.classList.add('show')}
    }catch(e){}finally{checking=false}
  }
  btn.onclick=()=>location.reload();
  setInterval(snapshot,5000);setTimeout(snapshot,1500);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)snapshot()});
})();