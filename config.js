window.PHOTOFEST_SUPABASE_URL = 'https://aetztyeflblracfhallo.supabase.co';
window.PHOTOFEST_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_1yO3DY7cIHJT_Xxjw8X14A_VJoyPhXH';
window.PHOTOFEST_SUPABASE_KEY = window.PHOTOFEST_SUPABASE_PUBLISHABLE_KEY;
window.PHOTOFEST_API_URL = window.PHOTOFEST_API_URL || '';

// PHOTO FEST Live Gallery
if (location.pathname.endsWith('/galeria.html') || location.pathname.endsWith('galeria.html')) {
  const live = document.createElement('script');
  live.src = 'live-gallery.js?v=1';
  live.defer = true;
  document.head.appendChild(live);
}

// PHOTO FEST admin enhancements
if (location.pathname.endsWith('/admin.html') || location.pathname.endsWith('admin.html')) {
  document.addEventListener('DOMContentLoaded', () => {
    const list = document.getElementById('eventsList');
    if (!list) return;
    const addManageButtons = () => {
      list.querySelectorAll('.event').forEach(card => {
        const actions = card.querySelector('.event-actions');
        if (!actions || actions.querySelector('.manage-event')) return;
        const gallery = actions.querySelector('a[href^="galeria.html?evento="]');
        if (!gallery) return;
        const slug = new URL(gallery.href, location.href).searchParams.get('evento');
        if (!slug) return;
        const manage = document.createElement('a');
        manage.className = 'btn manage-event';
        manage.href = 'evento-admin.html?evento=' + encodeURIComponent(slug);
        manage.textContent = 'Administrar';
        actions.insertBefore(manage, actions.firstChild);
      });
    };
    new MutationObserver(addManageButtons).observe(list, { childList: true, subtree: true });
    addManageButtons();
  });
}
