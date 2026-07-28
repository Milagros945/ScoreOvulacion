/**
 * Cliente compartido de Supabase.
 *
 * La URL y la clave "anon" de Supabase son públicas por diseño (la seguridad real
 * la da Row Level Security en la base de datos), así que es seguro exponerlas en
 * el navegador. Aun así, en vez de escribirlas directamente en el código, se piden
 * en tiempo de ejecución a /api/config, una función serverless de Vercel que lee
 * las variables de entorno del proyecto. Esto permite usar los mismos archivos
 * estáticos en cualquier entorno (producción, preview, local) sin tocar el código.
 */
window.getSupabaseClient = (function () {
  let clientPromise = null;

  return function getSupabaseClient() {
    if (clientPromise) return clientPromise;

    clientPromise = fetch('/api/config')
      .then(function (res) {
        if (!res.ok) throw new Error('No se pudo cargar la configuración de Supabase (/api/config)');
        return res.json();
      })
      .then(function (cfg) {
        if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
          throw new Error(
            'Faltan las variables de entorno SUPABASE_URL o SUPABASE_ANON_KEY en Vercel. ' +
            'Revisa el archivo README_SAAS.md.'
          );
        }
        return window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      });

    return clientPromise;
  };
})();
