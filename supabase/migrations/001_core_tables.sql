-- Migration 001: Core tables, links, triggers, RLS
-- Life OS schema as specified in LIFE-OS-PLAN.md §3.1 amended by §3.5 and §4.3

-- =============================================================================
-- ENUMS
-- =============================================================================

create type life_area as enum (
  'money', 'health', 'growth', 'work', 'relationships', 'play', 'environment'
);

create type project_status as enum ('idea', 'active', 'paused', 'done');

create type task_status as enum (
  'inbox', 'next_action', 'in_progress', 'waiting_for', 'blocked', 'someday', 'done'
);

create type goal_kind as enum ('goal', 'key_result');

create type goal_status as enum (
  'not_started', 'in_progress', 'on_track', 'at_risk', 'done'
);

create type goal_horizon as enum ('annual', 'q1', 'q2', 'q3', 'q4');

create type habit_polarity as enum ('build', 'break');

create type habit_metric_type as enum ('boolean', 'count', 'duration', 'value');

create type activity_type as enum (
  'gym', 'yoga', 'kitesurf', 'run', 'walk', 'other'
);

create type interaction_kind as enum ('call', 'meeting', 'message', 'note');

create type interaction_source as enum ('manual', 'transcriber', 'agent');

create type note_kind as enum (
  'morning_pages', 'note', 'meeting', 'journal', 'napkin'
);

create type list_kind as enum (
  'travel', 'movies', 'tv', 'books', 'games', 'shopping', 'custom'
);

create type list_item_status as enum ('open', 'done');

create type link_relation as enum (
  'related', 'blocks', 'mentions', 'contributes_to', 'attended', 'about'
);

create type event_category as enum (
  'work', 'fun', 'life_admin', 'birthday', 'health', 'travel', 'other'
);

create type event_category_source as enum ('gcal_color', 'rule', 'llm', 'manual');

create type link_creator as enum ('user', 'agent', 'pipeline');

create type priority_level as enum ('high', 'medium', 'low');

create type location_kind as enum ('gym', 'home', 'outdoor', 'travel', 'other');

-- =============================================================================
-- HELPER: updated_at trigger function
-- =============================================================================

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- =============================================================================
-- TABLES
-- =============================================================================

-- projects (§3.1 + §3.5 amendments)
create table projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  name        text not null,
  description text,
  status      project_status not null default 'idea',
  priority    priority_level,
  area        life_area not null,
  target_date date,
  color       text,
  sort_order  integer,
  -- §3.5 additions
  current_status text,    -- one-liner "what changed recently"
  next_steps     text,
  notes          text,
  outcome        text,    -- what does done look like
  success_check  text,    -- how do we know it worked
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);

comment on column projects.current_status is 'One-liner: what changed recently';
comment on column projects.outcome is 'What does done look like (OVER1 contract field)';
comment on column projects.success_check is 'How do we know it worked (OVER1 contract field)';
comment on column projects.color is 'Hex accent colour for UI (kanban cards, timeline bars)';
comment on column projects.sort_order is 'Manual drag-and-drop ordering in list views';

-- tasks (§3.1 + §3.5: area added, estimate_hours removed, inheritance defaults)
create table tasks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  project_id      uuid references projects(id),
  parent_task_id  uuid references tasks(id),
  title           text not null,
  notes           text,
  status          task_status not null default 'inbox',
  area            life_area,
  priority        priority_level,
  deadline        date,
  completed_at    timestamptz,
  sort_order      integer,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

comment on table tasks is 'Actionable items. area/priority/deadline default from parent project on creation but are editable per task.';
comment on column tasks.area is 'Defaults from project area on creation; editable per task; standalone tasks set directly';

-- goals
create table goals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  title           text not null,
  kind            goal_kind not null default 'goal',
  parent_goal_id  uuid references goals(id),
  area            life_area not null,
  horizon         goal_horizon,
  status          goal_status not null default 'not_started',
  target_value    numeric,
  current_value   numeric,
  unit            text,
  progress_mode   text not null default 'manual',
  due_date        date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

comment on column goals.progress_mode is 'manual | from_tasks | from_activity | from_habit';

-- habits
create table habits (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  name         text not null,
  polarity     habit_polarity not null default 'build',
  schedule     jsonb not null default '{"type":"daily"}',
  metric_type  habit_metric_type not null default 'boolean',
  target_value numeric,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz
);

comment on column habits.schedule is 'e.g. {"type":"daily"}, {"type":"per_week","count":3}, {"type":"daily","days":[1,3,5]}';

-- habit_logs
create table habit_logs (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null,
  habit_id  uuid not null references habits(id),
  logged_at timestamptz not null default now(),
  value     numeric default 1,
  note      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- locations (§4.3 trainer foundation)
create table locations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  name       text not null,
  kind       location_kind not null default 'gym',
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- equipment (§4.3)
create table equipment (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  location_id uuid not null references locations(id),
  name        text not null,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);

-- exercises (§4.3 canonical catalogue)
create table exercises (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null,
  name               text not null,
  muscle_groups      text[] not null default '{}',
  required_equipment text[] not null default '{}',  -- empty = bodyweight
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  archived_at        timestamptz
);

comment on column exercises.required_equipment is 'Empty array = bodyweight; matched against equipment.name at a location';

-- activity_logs
create table activity_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  activity_type activity_type not null,
  occurred_at   timestamptz not null,
  duration_min  integer,
  location_id   uuid references locations(id),
  details       jsonb,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz
);

-- workout_sets (§4.3: exercise FK into exercises)
create table workout_sets (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  activity_log_id uuid not null references activity_logs(id),
  exercise_id     uuid references exercises(id),
  exercise        text not null,  -- denormalised name for readability
  set_number      integer not null,
  reps            integer,
  weight_kg       numeric,
  rpe             numeric,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

comment on column workout_sets.exercise is 'Denormalised exercise name; exercise_id is the canonical FK';

-- contacts
create table contacts (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null,
  full_name              text not null,
  nickname               text,
  relationship           text,
  company                text,
  location               text,
  emails                 jsonb default '[]',
  phones                 jsonb default '[]',
  birthday               date,
  how_met                text,
  last_interaction_at    timestamptz,
  follow_up_interval_days integer,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  archived_at            timestamptz
);

-- interactions
create table interactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  contact_id  uuid not null references contacts(id),
  kind        interaction_kind not null,
  occurred_at timestamptz not null,
  summary     text not null,
  source      interaction_source not null default 'manual',
  raw_ref     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);

-- trigger: update contacts.last_interaction_at
create or replace function update_contact_last_interaction()
returns trigger as $$
begin
  update contacts
  set last_interaction_at = (
    select max(occurred_at)
    from interactions
    where contact_id = new.contact_id
      and archived_at is null
  )
  where id = new.contact_id;
  return new;
end;
$$ language plpgsql;

create trigger trg_interactions_update_contact
  after insert or update on interactions
  for each row execute function update_contact_last_interaction();

-- notes
create table notes (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null,
  title     text,
  body      text not null,
  kind      note_kind not null default 'note',
  note_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- lists (§3.5: item_schema added)
create table lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  name        text not null,
  description text,
  notes       text,
  kind        list_kind not null default 'custom',
  icon        text,
  item_schema jsonb default '[]',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);

comment on column lists.item_schema is 'Array of custom field defs: [{"key":"author","label":"Author","type":"text"}, ...]';

-- list_items
create table list_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  list_id    uuid not null references lists(id),
  title      text not null,
  status     list_item_status not null default 'open',
  metadata   jsonb default '{}',
  sort_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- key_info (§3.5)
create table key_info (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null,
  label    text not null,
  value    text not null,
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

comment on table key_info is 'Non-secret reference data only. Anything granting access belongs in 1Password.';

-- documents
create table documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  drive_file_id text not null,
  title         text not null,
  mime_type     text,
  url           text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz
);

-- events (§3.5: category + category_source)
create table events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  gcal_event_id   text not null,
  title           text not null,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  calendar_id     text,
  category        event_category,
  category_source event_category_source,
  synced_at       timestamptz default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz
);

-- links (§3.2 universal linking)
create table links (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  src_type   text not null,
  src_id     uuid not null,
  dst_type   text not null,
  dst_id     uuid not null,
  relation   link_relation not null default 'related',
  suggested  boolean not null default false,
  created_by link_creator not null default 'user',
  created_at timestamptz not null default now(),
  unique (src_type, src_id, dst_type, dst_id, relation)
);

comment on table links is 'Universal linking: connects any entity to any other. The keystone of Life OS.';

-- dashboards (§3.4 — schema only, UI deferred to Phase 5)
create table dashboards (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null,
  name     text not null,
  layout   jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- agent_actions audit table (§7)
create table agent_actions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  actor      text not null,  -- 'claude_code', 'claude_desktop', 'hermes', 'pipeline'
  action     text not null,  -- 'insert', 'update', 'delete'
  table_name text not null,
  record_id  uuid,
  details    jsonb,
  created_at timestamptz not null default now()
);

comment on table agent_actions is 'Audit log: who changed what when. Invaluable for debugging agent writes.';

-- =============================================================================
-- UPDATED_AT TRIGGERS (all mutable tables)
-- =============================================================================

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'projects','tasks','goals','habits','habit_logs','locations','equipment',
    'exercises','activity_logs','workout_sets','contacts','interactions','notes',
    'lists','list_items','key_info','documents','events','links','dashboards'
  ]) loop
    execute format(
      'create trigger trg_%s_updated_at before update on %I for each row execute function set_updated_at()',
      t, t
    );
  end loop;
end;
$$;

-- =============================================================================
-- INDEXES (§7 performance)
-- =============================================================================

-- FK indexes
create index idx_tasks_project_id on tasks(project_id) where project_id is not null;
create index idx_tasks_parent_task_id on tasks(parent_task_id) where parent_task_id is not null;
create index idx_goals_parent_goal_id on goals(parent_goal_id) where parent_goal_id is not null;
create index idx_habit_logs_habit_id on habit_logs(habit_id);
create index idx_habit_logs_logged_at on habit_logs(logged_at);
create index idx_activity_logs_occurred_at on activity_logs(occurred_at);
create index idx_activity_logs_location_id on activity_logs(location_id) where location_id is not null;
create index idx_workout_sets_activity_log_id on workout_sets(activity_log_id);
create index idx_workout_sets_exercise_id on workout_sets(exercise_id) where exercise_id is not null;
create index idx_equipment_location_id on equipment(location_id);
create index idx_interactions_contact_id on interactions(contact_id);
create index idx_interactions_occurred_at on interactions(occurred_at);
create index idx_list_items_list_id on list_items(list_id);
create index idx_events_gcal_event_id on events(gcal_event_id);
create index idx_events_starts_at on events(starts_at);

-- Links indexes (§7: both directions)
create index idx_links_src on links(src_type, src_id);
create index idx_links_dst on links(dst_type, dst_id);

-- =============================================================================
-- ROW LEVEL SECURITY (§5.1, §7: user_id on every table)
-- =============================================================================

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'projects','tasks','goals','habits','habit_logs','locations','equipment',
    'exercises','activity_logs','workout_sets','contacts','interactions','notes',
    'lists','list_items','key_info','documents','events','links','dashboards',
    'agent_actions'
  ]) loop
    execute format('alter table %I enable row level security', t);
    -- Authenticated users see only their own rows
    execute format(
      'create policy %I on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_user_policy', t
    );
  end loop;
end;
$$;
