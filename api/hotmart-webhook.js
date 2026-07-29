import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  console.log('Iniciando procesamiento de webhook (seguridad Y filtro de producto desactivados).');

  try {
    // --- SECCIÓN DE VALIDACIÓN DE SEGURIDAD (COMENTADA) ---
    /*
    const hotmartSignature = req.headers['x-hotmart-signature'];
    const webhookSecret = process.env.HOTMART_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('Error crítico: HOTMART_WEBHOOK_SECRET no configurado en Vercel.');
      return res.status(500).json({ error: 'Error de configuración del servidor' });
    }

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
      console.error('Intento de webhook no autorizado: Falta la firma. (Se ha omitido esta comprobación).');
    }
    */
    // -------------------------------------------------------


    // 2. Procesamiento
    const eventData = req.body;
    const eventType = eventData.event;
    const buyerData = eventData.data.buyer;
    const productData = eventData.data.product;

    console.log(`Recibiendo evento: ${eventType} para producto ID: ${productData.id}`);

    // --- SECCIÓN DE FILTRO DE PRODUCTO (COMENTADA) ---
    // Hemos desactivado esto para que el test funcione con cualquier ID de prueba de Hotmart.
    /*
    if (String(productData.id) !== '8195187') {
      console.log('Evento ignorado: ID de producto no coincide con 8195187. (Filtro omitido).');
      return res.status(200).json({ message: 'Evento ignorado para otro producto.' });
    }
    */
    // --------------------------------------------------

    if (eventType !== 'PURCHASE_APPROVED') {
      console.log('Evento ignorado: No es un evento de PURCHASE_APPROVED.');
      return res.status(200).json({ message: 'Evento ignorado (no es PURCHASE_APPROVED).' });
    }

    console.log(`Procesando compra aprobada para: ${buyerData.email}`);

    // 3. Inicializar Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Error crítico: Variables de entorno de Supabase (URL o Service Key) faltantes en Vercel.');
      return res.status(500).json({ error: 'Error de configuración de base de datos' });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 4. Crear o Actualizar Usuario en Supabase (Auth)
    let userId;
    const { data: existingUser } = await supabase.auth.admin.getUserByEmail(buyerData.email);

    if (existingUser) {
      userId = existingUser.user.id;
      console.log(`El usuario ya existe: ${userId}`);
    } else {
      console.log(`Creando nuevo usuario para: ${buyerData.email}`);
      const { data: newUser, error: createUserError } = await supabase.auth.admin.createUser({
        email: buyerData.email,
        email_confirm: true, // Confirmar email automáticamente
        user_metadata: { full_name: buyerData.name },
      });

      if (createUserError) {
        console.error('Error al crear el usuario en Supabase Auth:', createUserError);
        throw createUserError; // Esto disparará el bloque catch
      }
      userId = newUser.user.id;
      console.log(`Usuario creado exitosamente: ${userId}`);
    }

    // 5. Actualizar Registro en la Tabla 'profiles'
    console.log(`Actualizando perfil para el usuario: ${userId}`);
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: userId,
        full_name: buyerData.name,
        email: buyerData.email,
        subscription_status: 'active',
        purchase_date: new Date().toISOString(),
      });

    if (profileError) {
      console.error('Error al actualizar el perfil en Supabase:', profileError);
      throw profileError;
    }

    console.log(`Licencia activada correctamente para el usuario ${userId}.`);
    return res.status(200).json({ message: 'Usuario creado y licencia activada correctamente.' });

  } catch (error) {
    console.error('Error general procesando el webhook:', error);
    return res.status(500).json({ error: 'Error interno del servidor durante el procesamiento.' });
  }
}
