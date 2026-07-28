-- ============================================================
-- ScoreOvulación — Esquema de Supabase
-- Ejecuta este archivo completo en: Supabase > SQL Editor > New query
-- ============================================================

-- ------------------------------------------------------------
-- 1) Tabla profiles
--    Un registro por usuario autenticado (id = auth.users.id).
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  nombre             text,
  email              text unique not null,
  licencia_activa    boolean not null default false,
  fecha_compra       timestamptz,
  transaccion_hotmart text,
  creado_en          timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Cada usuario solo puede LEER su propia fila. No se otorga permiso de
-- escritura a usuarios autenticados: licencia_activa solo la cambia el
-- webhook (con la service_role key, que bypassa RLS) o el trigger de abajo.
create policy "profiles: cada usuario ve solo su propia fila"
  on public.profiles for select
  using (auth.uid() = id);


-- ------------------------------------------------------------
-- 2) Tabla licencias_pendientes
--    Guarda compras aprobadas en Hotmart de personas que todavía no
--    crearon su cuenta en la app. RLS queda activo y SIN políticas,
--    así que solo la service_role key (el webhook) puede tocarla.
-- ------------------------------------------------------------
create table if not exists public.licencias_pendientes (
  email               text primary key,
  transaccion_hotmart text,
  fecha_compra        timestamptz,
  creado_en           timestamptz not null default now()
);

alter table public.licencias_pendientes enable row level security;
-- (sin políticas: bloqueada para anon/authenticated a propósito)


-- ------------------------------------------------------------
-- 3) Trigger: al crear un usuario en auth.users, crear su fila en
--    profiles automáticamente y, si ya existía una compra pendiente
--    con ese correo, activarla en el mismo paso.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pendiente record;
begin
  select * into pendiente
    from public.licencias_pendientes
    where email = new.email
    limit 1;

  insert into public.profiles (id, nombre, email, licencia_activa, fecha_compra, transaccion_hotmart)
  values (
    new.id,
    new.raw_user_meta_data ->> 'nombre',
    new.email,
    coalesce(pendiente.email is not null, false),
    pendiente.fecha_compra,
    pendiente.transaccion_hotmart
  );

  if pendiente.email is not null then
    delete from public.licencias_pendientes where email = pendiente.email;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ------------------------------------------------------------
-- 4) Activación manual (útil para pruebas antes de conectar el
--    webhook de Hotmart). Reemplaza el correo y ejecuta:
-- ------------------------------------------------------------
-- update public.profiles set licencia_activa = true where email = 'correo@ejemplo.com';
