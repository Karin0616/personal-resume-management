create schema if not exists resume;
revoke all on schema resume from public;
create table resume.purposes (id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 200), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table resume.resumes (id uuid primary key default gen_random_uuid(), purpose_id uuid not null references resume.purposes on delete cascade, title text not null, company text, last_major int not null default 0, last_minor int not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index on resume.resumes(purpose_id);
create table resume.resume_versions (id uuid primary key default gen_random_uuid(), resume_id uuid not null references resume.resumes on delete cascade, major int not null check(major>=1), minor int not null check(minor>=0), label text, source_id uuid references resume.resume_versions on delete set null, source_snapshot jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(resume_id,major,minor));
create table resume.resume_documents (version_id uuid primary key references resume.resume_versions on delete cascade, schema_version text not null default '1.0', document jsonb not null, revision int not null default 0 check(revision>=0));
create table resume.resume_history (id bigint generated always as identity primary key, version_id uuid not null references resume.resume_versions on delete cascade, revision int not null, kind text not null, areas jsonb not null, created_at timestamptz not null default now());
create index on resume.resume_history(version_id,id desc);
create table resume.workspace_state (id boolean primary key default true check(id), version_id uuid references resume.resume_versions on delete set null, active_at timestamptz);
insert into resume.workspace_state(id) values(true);
create table resume.assets (id uuid primary key, path text not null unique, mime text not null, size int not null, created_at timestamptz not null default now());
create table resume.version_assets (version_id uuid references resume.resume_versions on delete cascade, asset_id uuid references resume.assets, primary key(version_id,asset_id));
create table resume.publications (version_id uuid primary key references resume.resume_versions on delete cascade, token text not null unique, snapshot jsonb not null, updated_at timestamptz not null default now());
create table resume.publication_assets (version_id uuid references resume.publications on delete cascade, asset_id uuid references resume.assets, primary key(version_id,asset_id));
create table resume.auth_devices (id uuid primary key default gen_random_uuid(), name text not null, public_key text not null unique, fingerprint text not null unique, created_at timestamptz not null default now(), revoked_at timestamptz);
create table resume.auth_challenges (id uuid primary key, nonce text not null, purpose text not null check(purpose in ('login','register')), payload text not null, binding_hash text not null, registration jsonb, device_id uuid references resume.auth_devices, created_at timestamptz not null default now(), expires_at timestamptz not null, approved_at timestamptz, consumed_at timestamptz);
create table resume.edit_sessions (token_hash text primary key, device_id uuid not null references resume.auth_devices, active_at timestamptz not null default now(), expires_at timestamptz not null, revoked_at timestamptz);
create index on resume.edit_sessions(device_id);
create table resume.rate_limits (key text primary key, window_start timestamptz not null, count int not null);
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='resume' loop
    execute format('alter table resume.%I enable row level security', t.tablename);
    execute format('revoke all on resume.%I from public', t.tablename);
  end loop;
end $$;
