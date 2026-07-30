// POST /api/hotmart-webhook
//
// Punto de entrada para el Webhook de Hotmart (Herramientas > Webhook, en el
// panel de tu producto). Activa o desactiva la licencia del comprador en la
// tabla `profiles` de Supabase automáticamente.
//
// IMPORTANTE ANTES DE ACTIVAR ESTO EN PRODUCCIÓN:
// El nombre exacto de los campos que envía Hotmart (event, hottok, buyer.email,
// purchase.transaction, etc.) puede variar según la versión de webhook que
// actives en tu panel. Antes de usarlo con compras reales:
//   1. Activa el webhook en modo prueba desde Hotmart y revisa el payload real
//      que llega (puedes loguearlo temporalmente con console.log(req.body)
//      y leerlo en Vercel > tu proyecto > Logs).
//   2. Ajusta los nombres de campo de este archivo si difieren de los que
//      documenta Hotmart en https://developers.hotmart.com en ese momento.
//
// Este archivo ya implementa la lógica de negocio (activar/desactivar,
// vincular con usuarios que compran antes o después de registrarse), solo
// puede necesitar un ajuste de nombres de campo según la versión del webhook.

const { createClient } = require('@supabase/supabase-js');

const EVENTOS_ACTIVACION = ['PURCHASE_APPROVED', 'PURCHASE_COMPLETE'];
const EVENTOS_DESACTIVACION = [
  'PURCHASE_REFUNDED',
  'PURCHASE_CHARGEBACK',
  'PURCHASE_CANCELED',
  'PURCHASE_CANCELLED',
  'PURCHASE_EXPIRED',
  'PURCHASE_PROTEST',
];

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno de Vercel.');
  }
  // El cliente admin usa la service_role key: bypassa RLS. Nunca se expone al navegador.
  return createClient(url, serviceRoleKey);
}

function extraerDatos(body) {
  // Estructura típica del webhook de Hotmart. Ajusta si tu payload real difiere.
  const evento = body.event || body.evento || '';
  const email = body?.data?.buyer?.email || body?.email || '';
  const nombre = body?.data?.buyer?.name || body?.nome || '';
  const transaccion = body?.data?.purchase?.transaction || body?.data?.transaction || body?.transaction || '';
  return { evento, email, nombre, transaccion };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  // Verificación del token (Hottok) configurado en el panel de Hotmart.
  // Hotmart puede enviarlo dentro del body como "hottok" o como query param,
  // según la versión de webhook. Se aceptan ambas formas.
  const tokenEsperado = process.env.HOTMART_WEBHOOK_SECRET;
  const tokenRecibido = req.body?.hottok || req.query?.token;
  if (!tokenEsperado) {
    res.status(500).json({ error: 'Falta configurar HOTMART_WEBHOOK_SECRET en Vercel.' });
    return;
  }
  // DEBUG TEMPORAL: no expone los valores completos, solo longitud y últimos
  // caracteres, para poder comparar en los Logs de Vercel sin filtrar el secreto.
  console.log('DEBUG token', {
    esperado_len: tokenEsperado.length,
    esperado_final: tokenEsperado.slice(-4),
    recibido_len: tokenRecibido ? tokenRecibido.length : 0,
    recibido_final: tokenRecibido ? tokenRecibido.slice(-4) : null,
    llego_en: req.body?.hottok ? 'body' : (req.query?.token ? 'query' : 'ninguno'),
  });
  if (tokenRecibido !== tokenEsperado) {
    res.status(401).json({ error: 'Token de verificación inválido.' });
    return;
  }

  const { evento, email, transaccion } = extraerDatos(req.body || {});
  if (!email) {
    res.status(400).json({ error: 'El payload no incluyó un correo de comprador.' });
    return;
  }

  let supabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    res.status(500).json({ error: err.message });
    return;
  }

  const emailNormalizado = String(email).trim().toLowerCase();

  try {
    if (EVENTOS_ACTIVACION.includes(evento)) {
      await activarLicencia(supabaseAdmin, emailNormalizado, transaccion);
      res.status(200).json({ ok: true, accion: 'activada', email: emailNormalizado });
      return;
    }

    if (EVENTOS_DESACTIVACION.includes(evento)) {
      await desactivarLicencia(supabaseAdmin, emailNormalizado);
      res.status(200).json({ ok: true, accion: 'desactivada', email: emailNormalizado });
      return;
    }

    // Evento no manejado (por ejemplo, un evento informativo). Se responde 200
    // para que Hotmart no reintente indefinidamente un evento que no nos interesa.
    res.status(200).json({ ok: true, accion: 'ignorado', evento });
  } catch (err) {
    console.error('Error procesando webhook de Hotmart:', err);
    res.status(500).json({ error: 'Error interno al procesar el webhook.' });
  }
};

async function activarLicencia(supabaseAdmin, email, transaccion) {
  const ahora = new Date().toISOString();

  // Caso 1: el comprador ya tiene cuenta (profiles.email coincide) -> activar directo.
  const { data: actualizados, error: errUpdate } = await supabaseAdmin
    .from('profiles')
    .update({ licencia_activa: true, fecha_compra: ahora, transaccion_hotmart: transaccion })
    .eq('email', email)
    .select('id');

  if (errUpdate) throw errUpdate;

  if (actualizados && actualizados.length > 0) return;

  // Caso 2: todavía no tiene cuenta -> guardar en licencias_pendientes.
  // Cuando la persona se registre con este mismo correo, un trigger en la
  // base de
