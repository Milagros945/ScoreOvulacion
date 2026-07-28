# ScoreOvulación — De app estática a SaaS

Este documento explica qué se agregó sobre la app original, cómo desplegarlo
en Vercel + Supabase, y cómo conectar la activación automática de licencias
desde Hotmart.

**El diseño visual no se tocó.** `app.html` es tu archivo original con el
`<style>` movido a `assets/styles.css` (mismo CSS, mismo resultado) y un
overlay de carga agregado encima, para poder validar la sesión antes de
mostrar la app. La lógica interna de la app (cuestionario, score, bonos,
plan de 90 días) no se modificó ni una línea.

---

## 1. Qué se agregó

| Archivo | Qué hace |
|---|---|
| `index.html` | Puerta de entrada del sitio. No muestra contenido: revisa la sesión y redirige a `login.html`, `bloqueado.html` o `app.html`. |
| `login.html` | Pantalla de inicio de sesión y registro (correo + contraseña) con Supabase Auth. |
| `bloqueado.html` | Se muestra si el usuario está autenticado pero `licencia_activa` no es `true`. |
| `app.html` | Tu app original, con el overlay de verificación de acceso agregado. |
| `assets/styles.css` | El CSS original, extraído tal cual para reutilizarlo en las 4 páginas. |
| `assets/supabase-client.js` | Crea el cliente de Supabase en el navegador, leyendo la configuración desde `/api/config`. |
| `assets/auth-guard.js` | Se ejecuta dentro de `app.html`: exige sesión + licencia activa, y agrega el botón "Cerrar sesión" al topbar existente. |
| `api/config.js` | Función serverless de Vercel: expone la URL y clave pública de Supabase al navegador. |
| `api/hotmart-webhook.js` | Función serverless que recibe el webhook de Hotmart y activa/desactiva licencias en Supabase. |
| `sql/schema.sql` | Crea las tablas `profiles` y `licencias_pendientes`, y el trigger que las conecta. |
| `package.json` | Declara la dependencia `@supabase/supabase-js` que usa `api/hotmart-webhook.js`. |

---

## 2. Cómo funciona el acceso, paso a paso

1. Alguien compra en Hotmart. Hotmart llama a `api/hotmart-webhook.js`.
2. Si ya existe una cuenta con ese correo en `profiles`, se activa al instante
   (`licencia_activa = true`).
3. Si todavía no existe cuenta, la compra queda guardada en
   `licencias_pendientes`, esperando a que la persona se registre.
4. La persona entra a `login.html` y crea su cuenta con el **mismo correo**
   de la compra.
5. Un trigger en Supabase (`handle_new_user`, en `sql/schema.sql`) se dispara
   automáticamente al crear la cuenta: revisa `licencias_pendientes` y, si
   encuentra el correo, activa la licencia en el mismo paso.
6. Al entrar a `app.html`, `auth-guard.js` verifica la sesión y el estado de
   `licencia_activa` antes de mostrar cualquier contenido. Si no está activa,
   redirige a `bloqueado.html`.

---

## 3. Configurar Supabase (una sola vez)

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. Ve a **SQL Editor** → pega el contenido completo de `sql/schema.sql` → **Run**.
3. Ve a **Project Settings → API** y copia:
   - **Project URL** → será `SUPABASE_URL`
   - **anon public key** → será `SUPABASE_ANON_KEY`
   - **service_role key** → será `SUPABASE_SERVICE_ROLE_KEY` (⚠️ secreta, nunca la pongas en el frontend)
4. Ve a **Authentication → Providers → Email** y confirma que el inicio de
   sesión por correo y contraseña esté habilitado (viene así por defecto).
5. Decide si quieres exigir confirmación por correo antes del primer login
   (**Authentication → Settings → "Confirm email"**). Se recomienda dejarlo
   activado en producción.

---

## 4. Variables de entorno en Vercel

Ve a tu proyecto en Vercel → **Settings → Environment Variables** y agrega:

| Variable | Valor | ¿Dónde se usa? |
|---|---|---|
| `SUPABASE_URL` | Project URL de Supabase | `api/config.js` y `api/hotmart-webhook.js` |
| `SUPABASE_ANON_KEY` | anon public key de Supabase | `api/config.js` (se expone al navegador, es pública por diseño) |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key de Supabase | `api/hotmart-webhook.js` únicamente (nunca llega al navegador) |
| `HOTMART_HOTTOK` | Un token que tú inventes (letras y números) | `api/hotmart-webhook.js`, para verificar que la llamada viene de Hotmart |

Después de agregarlas, vuelve a desplegar el proyecto (Vercel no recarga las
variables de entorno en un deploy ya existente).

---

## 5. Conectar el webhook de Hotmart

1. En Hotmart: **Herramientas → Webhook** (dentro de tu producto).
2. URL del webhook: `https://TU-DOMINIO.vercel.app/api/hotmart-webhook`
3. Token/Hottok: usa el mismo valor que pusiste en `HOTMART_HOTTOK` en Vercel.
4. Activa al menos los eventos: compra aprobada, reembolso, chargeback y
   cancelación.

**Antes de conectar compras reales**, prueba en modo sandbox/test de Hotmart
y revisa en Vercel (**tu proyecto → Logs**) que el payload que llega tenga los
campos que espera `api/hotmart-webhook.js` (`event`, `data.buyer.email`,
`data.purchase.transaction`, `hottok`). Hotmart ha tenido más de una versión
de su webhook; si algún nombre de campo no coincide con lo que ves en los
logs, ajústalo directamente en `extraerDatos()` dentro de ese archivo.

---

## 6. Probar sin esperar una compra real

Para darle acceso a alguien manualmente (por ejemplo, a ti mismo/a mientras
pruebas), en Supabase → **Table Editor → profiles**, o por SQL:

```sql
update public.profiles set licencia_activa = true where email = 'tu-correo@ejemplo.com';
```

Si la persona todavía no se registró, actívala vía `licencias_pendientes`:

```sql
insert into public.licencias_pendientes (email, transaccion_hotmart, fecha_compra)
values ('correo@ejemplo.com', 'PRUEBA-MANUAL', now());
```

En cuanto esa persona cree su cuenta con ese correo, quedará activada
automáticamente.

---

## 7. Estructura final del proyecto

```
/
├─ index.html
├─ login.html
├─ bloqueado.html
├─ app.html
├─ package.json
├─ assets/
│  ├─ styles.css
│  ├─ supabase-client.js
│  └─ auth-guard.js
├─ api/
│  ├─ config.js
│  └─ hotmart-webhook.js
└─ sql/
   └─ schema.sql
```

Sube esta estructura tal cual a tu repositorio de GitHub conectado a Vercel;
no requiere ningún framework (Next.js, React, etc.), Vercel detecta y sirve
los archivos estáticos y las funciones de `api/` automáticamente.

---

## 8. Seguridad: qué NO cambiar

- Nunca pongas `SUPABASE_SERVICE_ROLE_KEY` en ningún archivo dentro de
  `assets/` ni en ningún HTML: esa clave puede saltarse toda la seguridad
  de la base de datos.
- No agregues políticas de RLS que permitan a un usuario autenticado
  actualizar su propio `licencia_activa`: eso permitiría que cualquiera
  se autoactive la licencia sin pagar. Solo el webhook (con la
  service_role key) y el trigger deben poder cambiar ese campo.
