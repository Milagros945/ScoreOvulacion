import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Esta función utiliza la nueva API de URL (new URL()) para evitar el error de obsolescencia.
// También verifica la firma del webhook de Hotmart para mayor seguridad.

export default async function handler(req, res) {
  // Solo permitimos peticiones POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    // 1. Validación de Seguridad: Verificar que la petición provenga de Hotmart
    const hotmartSignature = req.headers['x-hotmart-signature'];
    const webhookSecret = process.env.HOTMART_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('Error crítico: HOTMART_WEBHOOK_SECRET no configurado en Vercel.');
      return res.status(500).json({ error: 'Error de configuración del servidor' });
    }

    // Validar la firma (HMAC SHA256)
    if (hotmartSignature) {
      const calculatedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(JSON.stringify(req.body))
        .digest('hex');

      if (hotmartSignature !== calculatedSignature) {
        console.error('Intento de webhook no autorizado: Firma incorrecta.');
        return res.status(401).json({ error: 'Firma no válida' });
      }
    } else {
      console.error('Intento de webhook no autorizado: Falta la firma.');
      return res.status(401).json({ error: 'Firma no proporcionada' });
    }

    // 2. Procesamiento del Evento de Compra
    const eventData = req.body;
    const eventType = eventData.event;
    const buyerData = eventData.data.buyer;
    const productData = eventData.data.product;

    console.log(`Recibiendo evento de webhook: ${eventType} para el producto ID: ${productData.id}`);

    // Nos aseguramos de que sea el producto correcto (ScoreOvulación)
    // Reemplaza '8195187' con el ID de producto real de tu imagen si es diferente.
    if (String(productData.id) !== '8195187') {
      console.log('Evento ignorado: ID de producto no coincide.');
      return res.status(200).json({ message: 'Evento ignorado para otro producto.' });
    }

    // Solo procesamos si la compra fue aprobada
    if (eventType !== 'PURCHASE_APPROVED') {
      console.log('Evento ignorado: Tipo de evento no es compra aprobada.');
      return res.status(200).json({ message: 'Evento ignorado (no es PURCHASE_APPROVED).' });
    }

    console.log(`Procesando compra aprobada para: ${buyerData.email}`);

    // 3. Inicializar Cliente Supabase con Role Service Key
    // Necesitamos la Service Role Key para crear usuarios y perfiles.
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Error crítico: Variables de entorno de Supabase faltantes.');
      return res.status(500).json({ error: 'Error de configuración de base de datos' });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 4. Crear o Actualizar Usuario en Supabase (Auth)
    // Usamos la API de administración para crear el usuario y enviarle el correo de bienvenida.
    let userId;

    // Primero, intentamos ver si el usuario ya existe por email
    const { data: existingUser, error: getUserError } = await supabase
      .auth.admin.getUserByEmail(buyerData.email);

    if (existingUser) {
      userId = existingUser.user.id;
      console.log(`El usuario ya existe: ${userId}`);
    } else {
      // Si no existe, lo creamos. Supabase enviará el correo de bienvenida automáticamente.
      const { data: newUser, error: createUserError } = await supabase.auth.admin.createUser({
        email: buyerData.email,
        email_confirm: true, // Confirmamos el correo automáticamente
        user_metadata: {
          full_name: buyerData.name,
        },
        // Al crear el usuario sin contraseña, Supabase enviará un email de "establecer contraseña"
      });

      if (createUserError) {
        console.error('Error al crear el usuario en Supabase Auth:', createUserError);
        throw createUserError;
      }

      userId = newUser.user.id;
      console.log(`Usuario creado exitosamente: ${userId}`);
    }

    // 5. Actualizar o Crear Registro en la Tabla 'profiles' (Licencias)
    // Esto activa la licencia en tu base de datos.
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: userId, // Usamos el mismo ID de Auth para la tabla de perfiles
        full_name: buyerData.name,
        email: buyerData.email,
        subscription_status: 'active', // Activamos la licencia
        purchase_date: new Date().toISOString(),
        // Puedes añadir más campos de licencia según tu schema.sql
      });

    if (profileError) {
      console.error('Error al actualizar el perfil en Supabase:', profileError);
      throw profileError;
    }

    console.log(`Licencia activada para el usuario ${userId} en la base de datos.`);

    // 6. Responder a Hotmart
    return res.status(200).json({ message: 'Usuario creado y licencia activada correctamente.' });

  } catch (error) {
    console.error('Error general procesando el webhook:', error);
    // Devolvemos error 500 si algo falla
    return res.status(500).json({ error: 'Error interno del servidor al procesar el webhook.' });
  }
}
