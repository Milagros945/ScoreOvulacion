// GET /api/config
// Expone al navegador la URL y la clave "anon" (pública) de Supabase, leídas
// desde las variables de entorno del proyecto en Vercel. La clave anon está
// diseñada para ser pública: la protección real la da Row Level Security (RLS)
// en la base de datos, configurada en sql/schema.sql.
//
// NUNCA agregues aquí la clave "service_role": esa es secreta y solo debe
// usarse en api/hotmart-webhook.js, del lado del servidor.

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(500).json({
      error: 'Faltan variables de entorno en Vercel: SUPABASE_URL y/o SUPABASE_ANON_KEY.'
    });
    return;
  }

  res.status(200).json({ supabaseUrl, supabaseAnonKey });
};
