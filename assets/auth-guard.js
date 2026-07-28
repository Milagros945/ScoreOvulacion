/**
 * Guardián de acceso para app.html.
 *
 * No modifica el diseño ni la lógica de ScoreOvulación: solo decide si el overlay
 * de carga ("authLoadingOverlay", agregado en app.html) se oculta o si el
 * navegador es redirigido a login.html o bloqueado.html.
 *
 * Flujo:
 *  1. Sin sesión válida            -> redirige a login.html
 *  2. Sesión válida, sin perfil o
 *     licencia_activa distinto de true -> redirige a bloqueado.html
 *  3. Sesión válida y licencia activa  -> oculta el overlay y muestra la app
 */
(function () {
  function hideOverlay() {
    var overlay = document.getElementById('authLoadingOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  function goTo(path) {
    window.location.replace(path);
  }

  function addLogoutButton(supabase) {
    var brand = document.querySelector('.topbar .brand');
    if (!brand || document.getElementById('logoutBtn')) return;
    var btn = document.createElement('button');
    btn.id = 'logoutBtn';
    btn.textContent = 'Cerrar sesión';
    btn.style.cssText =
      'margin-left:auto;background:transparent;border:1.5px solid rgba(28,22,32,.16);' +
      'color:var(--ink-soft);font-family:Manrope,sans-serif;font-weight:700;font-size:11.5px;' +
      'border-radius:100px;padding:7px 14px;cursor:pointer;';
    btn.onclick = function () {
      supabase.auth.signOut().then(function () { goTo('login.html'); });
    };
    // el topbar usa justify-content:space-between con .brand y .qprogress;
    // insertamos el botón entre ambos sin tocar el CSS existente.
    brand.parentElement.insertBefore(btn, brand.nextSibling.nextSibling || null);
  }

  async function run() {
    try {
      var supabase = await window.getSupabaseClient();

      var { data: sessionData } = await supabase.auth.getSession();
      var session = sessionData && sessionData.session;
      if (!session) { goTo('login.html'); return; }

      var { data: profile, error } = await supabase
        .from('profiles')
        .select('licencia_activa, nombre')
        .eq('id', session.user.id)
        .maybeSingle();

      if (error) {
        console.error('Error al leer el perfil:', error);
        goTo('bloqueado.html');
        return;
      }

      if (!profile || profile.licencia_activa !== true) {
        goTo('bloqueado.html');
        return;
      }

      addLogoutButton(supabase);
      hideOverlay();

      // Revalida si Supabase cierra la sesión en otra pestaña o expira el token.
      supabase.auth.onAuthStateChange(function (event) {
        if (event === 'SIGNED_OUT') goTo('login.html');
      });
    } catch (err) {
      console.error('Error de autenticación:', err);
      var overlay = document.getElementById('authLoadingOverlay');
      if (overlay) {
        overlay.innerHTML =
          '<div style="max-width:320px;text-align:center;padding:0 24px;">' +
          '<p style="font-family:Manrope,sans-serif;color:var(--ink-soft);font-size:14px;">' +
          'No se pudo verificar tu acceso. Intenta recargar la página. Si el problema continúa, ' +
          'escribe a soporte.</p></div>';
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
