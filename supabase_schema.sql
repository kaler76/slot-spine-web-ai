-- Slot Spine Generator: schema Supabase
-- Da eseguire una volta nel SQL Editor del progetto Supabase (stesso progetto di Fantacrime, tabelle separate).

-- 1. Tabella simboli
create table if not exists spine_symbols (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now(),
  -- Immagine sorgente collegata da un import (es. da un progetto aztec-preview già
  -- ritagliato): solo un riferimento da riusare in SymbolPage, non genera animazioni.
  source_image_url text
);

-- 1b. Su un'installazione già esistente, aggiunge solo il nuovo campo (idempotente).
alter table spine_symbols add column if not exists source_image_url text;

-- 2. Tabella animazioni per simbolo (max 4 varianti: idle / win / land / spinBlur)
create table if not exists spine_symbol_animations (
  id uuid primary key default gen_random_uuid(),
  symbol_id uuid not null references spine_symbols(id) on delete cascade,
  animation_type text not null check (animation_type in ('idle', 'win', 'land', 'spinBlur')),
  width int not null,
  height int not null,
  speed numeric not null default 1,
  image_path text not null,
  image_url text not null,
  skeleton_json jsonb not null,
  atlas_text text not null,
  created_at timestamptz default now(),
  unique (symbol_id, animation_type)
);

-- 3. Storage bucket per i PNG dei simboli (pubblico in lettura, per semplicità di prototipo)
insert into storage.buckets (id, name, public)
values ('spine-symbols', 'spine-symbols', true)
on conflict (id) do nothing;

-- 4. Row Level Security
-- NOTA IMPORTANTE: queste policy permettono a chiunque abbia la anon key (cioè chiunque
-- visiti il sito) di leggere/scrivere. Va bene per un tool interno/prototipo senza login,
-- ma se in futuro esponi il sito pubblicamente conviene aggiungere autenticazione Supabase
-- e restringere le policy (es. solo utenti autenticati, o solo il proprietario del record).

alter table spine_symbols enable row level security;
alter table spine_symbol_animations enable row level security;

create policy "Chiunque può leggere i simboli"
  on spine_symbols for select
  using (true);

create policy "Chiunque può creare simboli"
  on spine_symbols for insert
  with check (true);

create policy "Chiunque può eliminare simboli"
  on spine_symbols for delete
  using (true);

create policy "Chiunque può leggere le animazioni"
  on spine_symbol_animations for select
  using (true);

create policy "Chiunque può inserire/aggiornare animazioni"
  on spine_symbol_animations for insert
  with check (true);

create policy "Chiunque può aggiornare animazioni (upsert)"
  on spine_symbol_animations for update
  using (true);

create policy "Chiunque può eliminare animazioni"
  on spine_symbol_animations for delete
  using (true);

-- 5. Policy storage bucket (upload/lettura pubblici, stesse considerazioni di cui sopra)
create policy "Lettura pubblica bucket spine-symbols"
  on storage.objects for select
  using (bucket_id = 'spine-symbols');

create policy "Upload pubblico bucket spine-symbols"
  on storage.objects for insert
  with check (bucket_id = 'spine-symbols');

create policy "Sovrascrittura pubblica bucket spine-symbols"
  on storage.objects for update
  using (bucket_id = 'spine-symbols');

-- ============================================================
-- CHARACTER: rigging multi-bone (body / head / armLeft / armRight)
-- ============================================================

-- 6. Tabella character
create table if not exists spine_characters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

-- 7. Parti del character (una riga per parte: body/head/armLeft/armRight),
--    con immagine, misure e offset rispetto al bone genitore.
create table if not exists spine_character_parts (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references spine_characters(id) on delete cascade,
  part_key text not null check (part_key in ('body', 'head', 'armLeft', 'armRight')),
  width int not null,
  height int not null,
  offset_x numeric not null default 0,
  offset_y numeric not null default 0,
  image_path text not null,
  image_url text not null,
  created_at timestamptz default now(),
  unique (character_id, part_key)
);

-- 8. Animazioni generate per il character (idle / win), skeleton multi-bone completo
create table if not exists spine_character_animations (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references spine_characters(id) on delete cascade,
  animation_type text not null check (animation_type in ('idle', 'win')),
  speed numeric not null default 1,
  skeleton_json jsonb not null,
  atlas_text text not null,
  created_at timestamptz default now(),
  unique (character_id, animation_type)
);

-- 9. Storage bucket dedicato ai character
insert into storage.buckets (id, name, public)
values ('spine-characters', 'spine-characters', true)
on conflict (id) do nothing;

alter table spine_characters enable row level security;
alter table spine_character_parts enable row level security;
alter table spine_character_animations enable row level security;

create policy "Chiunque può leggere i character"
  on spine_characters for select using (true);
create policy "Chiunque può creare character"
  on spine_characters for insert with check (true);
create policy "Chiunque può eliminare character"
  on spine_characters for delete using (true);

create policy "Chiunque può leggere le parti"
  on spine_character_parts for select using (true);
create policy "Chiunque può inserire/aggiornare parti"
  on spine_character_parts for insert with check (true);
create policy "Chiunque può aggiornare parti (upsert)"
  on spine_character_parts for update using (true);
create policy "Chiunque può eliminare parti"
  on spine_character_parts for delete using (true);

create policy "Chiunque può leggere le animazioni character"
  on spine_character_animations for select using (true);
create policy "Chiunque può inserire/aggiornare animazioni character"
  on spine_character_animations for insert with check (true);
create policy "Chiunque può aggiornare animazioni character (upsert)"
  on spine_character_animations for update using (true);
create policy "Chiunque può eliminare animazioni character"
  on spine_character_animations for delete using (true);

create policy "Lettura pubblica bucket spine-characters"
  on storage.objects for select
  using (bucket_id = 'spine-characters');
create policy "Upload pubblico bucket spine-characters"
  on storage.objects for insert
  with check (bucket_id = 'spine-characters');
create policy "Sovrascrittura pubblica bucket spine-characters"
  on storage.objects for update
  using (bucket_id = 'spine-characters');

-- ============================================================
-- IMPOSTAZIONI APP: ultimo progetto aztec-preview importato
-- (usato da "Rulli animati" per lo sfondo/cornice/coordinate rulli reali)
-- ============================================================

create table if not exists spine_app_settings (
  id text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table spine_app_settings enable row level security;

create policy "Chiunque può leggere le impostazioni"
  on spine_app_settings for select using (true);
create policy "Chiunque può scrivere le impostazioni"
  on spine_app_settings for insert with check (true);
create policy "Chiunque può aggiornare le impostazioni"
  on spine_app_settings for update using (true);
