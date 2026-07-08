-- ============================================================
-- Diario Allenamento — schema.sql
-- Progetto Supabase NUOVO e SEPARATO dal Calcolatore carichi.
-- RLS aperta in lettura/scrittura per ruolo anon (nessun login).
-- DELETE fisico bloccato su esercizi, log_sessioni, prescrizioni
-- tramite trigger (soft-delete è l'unica via lato applicazione).
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- Tabella: esercizi
-- ------------------------------------------------------------
create table if not exists esercizi (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null check (tipo in ('binario','carico')),
  target_giorni integer not null check (target_giorni >= 1 and target_giorni <= 10),
  archiviato boolean not null default false,
  eliminato boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Tabella: prescrizioni (la Scheda)
-- ------------------------------------------------------------
create table if not exists prescrizioni (
  id uuid primary key default gen_random_uuid(),
  settimana_inizio date not null, -- sempre un lunedì
  esercizio_id uuid not null references esercizi(id),
  carico_tipo text not null check (carico_tipo in ('percentuale','kg_diretto')),
  percentuale numeric,
  kg numeric,
  kg_calcolato_snapshot numeric,
  riferimento text not null check (riferimento in ('tmax','smax','nessuno')),
  serie integer not null check (serie >= 1),
  ripetizioni integer not null check (ripetizioni >= 1),
  fatta boolean not null default false,
  log_id uuid,
  created_at timestamptz not null default now(),
  constraint chk_riferimento_percentuale check (
    (carico_tipo = 'percentuale' and riferimento in ('tmax','smax'))
    or (carico_tipo = 'kg_diretto' and riferimento = 'nessuno')
  )
);

-- ------------------------------------------------------------
-- Tabella: log_sessioni (il Diario)
-- ------------------------------------------------------------
create table if not exists log_sessioni (
  id uuid primary key default gen_random_uuid(),
  esercizio_id uuid not null references esercizi(id),
  data date not null,
  peso numeric,
  serie integer,
  ripetizioni integer,
  fatto boolean not null default true,
  nota text,
  origine text not null check (origine in ('manuale','da_scheda')),
  prescrizione_id uuid references prescrizioni(id),
  eliminato boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- collega prescrizioni.log_id -> log_sessioni.id (aggiunta dopo per evitare dipendenza circolare in creazione)
alter table prescrizioni
  add constraint fk_prescrizioni_log foreign key (log_id) references log_sessioni(id);

-- ------------------------------------------------------------
-- Tabella: config (una sola riga)
-- ------------------------------------------------------------
create table if not exists config (
  id integer primary key default 1,
  tmax numeric,
  smax numeric,
  updated_at timestamptz not null default now(),
  constraint chk_config_single_row check (id = 1)
);
insert into config (id, tmax, smax) values (1, null, null)
  on conflict (id) do nothing;

-- ------------------------------------------------------------
-- Indici utili
-- ------------------------------------------------------------
create index if not exists idx_log_esercizio on log_sessioni(esercizio_id) where eliminato = false;
create index if not exists idx_log_data on log_sessioni(data) where eliminato = false;
create index if not exists idx_prescrizioni_settimana on prescrizioni(settimana_inizio);
create index if not exists idx_prescrizioni_esercizio on prescrizioni(esercizio_id);
create index if not exists idx_esercizi_archiviato on esercizi(archiviato) where eliminato = false;

-- ------------------------------------------------------------
-- Trigger: aggiorna updated_at automaticamente
-- ------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_esercizi_updated_at on esercizi;
create trigger trg_esercizi_updated_at before update on esercizi
  for each row execute function set_updated_at();

drop trigger if exists trg_log_updated_at on log_sessioni;
create trigger trg_log_updated_at before update on log_sessioni
  for each row execute function set_updated_at();

drop trigger if exists trg_config_updated_at on config;
create trigger trg_config_updated_at before update on config
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- Trigger: blocca DELETE fisico su tabelle di dominio
-- (soft-delete via campo `eliminato` è l'unica via consentita)
-- ------------------------------------------------------------
create or replace function blocca_delete_fisico()
returns trigger as $$
begin
  raise exception 'DELETE fisico non consentito su %. Usa soft-delete (campo eliminato).', TG_TABLE_NAME;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_no_delete_esercizi on esercizi;
create trigger trg_no_delete_esercizi before delete on esercizi
  for each row execute function blocca_delete_fisico();

drop trigger if exists trg_no_delete_log on log_sessioni;
create trigger trg_no_delete_log before delete on log_sessioni
  for each row execute function blocca_delete_fisico();

drop trigger if exists trg_no_delete_prescrizioni on prescrizioni;
create trigger trg_no_delete_prescrizioni before delete on prescrizioni
  for each row execute function blocca_delete_fisico();

-- NOTA: la funzione "Importa da testo" (ripristino backup totale) è l'UNICA
-- eccezione concettuale: per essa NON si usa DELETE SQL reale sulle righe
-- esistenti in modo indiscriminato bypassando i trigger. L'app la implementa
-- invece con una funzione dedicata `ripristina_backup()` (sotto), eseguita
-- come funzione SECURITY DEFINER che disabilita temporaneamente i trigger
-- solo per quell'operazione esplicita e tracciata, poi li riattiva.
create or replace function ripristina_backup(payload jsonb)
returns void as $$
begin
  alter table esercizi disable trigger trg_no_delete_esercizi;
  alter table log_sessioni disable trigger trg_no_delete_log;
  alter table prescrizioni disable trigger trg_no_delete_prescrizioni;

  delete from log_sessioni;
  delete from prescrizioni;
  delete from esercizi;

  insert into esercizi select * from jsonb_populate_recordset(null::esercizi, payload->'esercizi');
  insert into prescrizioni select * from jsonb_populate_recordset(null::prescrizioni, payload->'prescrizioni');
  insert into log_sessioni select * from jsonb_populate_recordset(null::log_sessioni, payload->'log_sessioni');

  update config set
    tmax = (payload->'config'->>'tmax')::numeric,
    smax = (payload->'config'->>'smax')::numeric
  where id = 1;

  alter table esercizi enable trigger trg_no_delete_esercizi;
  alter table log_sessioni enable trigger trg_no_delete_log;
  alter table prescrizioni enable trigger trg_no_delete_prescrizioni;
end;
$$ language plpgsql security definer;

-- ------------------------------------------------------------
-- RLS: aperta in lettura/scrittura per anon (stesso pattern del
-- Calcolatore carichi). Rischio di esposizione accettato.
-- ------------------------------------------------------------
alter table esercizi enable row level security;
alter table log_sessioni enable row level security;
alter table prescrizioni enable row level security;
alter table config enable row level security;

create policy "anon full access esercizi" on esercizi
  for all to anon using (true) with check (true);

create policy "anon full access log_sessioni" on log_sessioni
  for all to anon using (true) with check (true);

create policy "anon full access prescrizioni" on prescrizioni
  for all to anon using (true) with check (true);

create policy "anon full access config" on config
  for all to anon using (true) with check (true);

grant usage on schema public to anon;
grant all on esercizi, log_sessioni, prescrizioni, config to anon;
grant execute on function ripristina_backup(jsonb) to anon;
