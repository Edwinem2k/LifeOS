-- Migration 002: Computed views
-- project_progress, goal_progress, habit_stats (EWMA), weekly_review,
-- exercises_available (§4.3), today_agenda (§5.5)

-- =============================================================================
-- project_progress (§3.3)
-- Per project: total tasks, done tasks, % complete, blocked count, overdue count
-- =============================================================================

create or replace view project_progress as
select
  p.id as project_id,
  p.user_id,
  p.name,
  p.status as project_status,
  p.area,
  count(t.id)::int as total_tasks,
  count(t.id) filter (where t.status = 'done')::int as done_tasks,
  case
    when count(t.id) = 0 then 0
    else round(100.0 * count(t.id) filter (where t.status = 'done') / count(t.id), 1)
  end as pct_complete,
  count(t.id) filter (where t.status = 'blocked')::int as blocked_count,
  count(t.id) filter (
    where t.deadline < current_date
      and t.status not in ('done', 'someday')
  )::int as overdue_count
from projects p
left join tasks t
  on t.project_id = p.id
  and t.archived_at is null
where p.archived_at is null
group by p.id, p.user_id, p.name, p.status, p.area;

-- =============================================================================
-- goal_progress (§3.3)
-- Per goal: current_value/target_value, child goal rollup, linked task completion %
-- =============================================================================

create or replace view goal_progress as
with linked_task_stats as (
  -- tasks linked to goals via the links table (relation = 'contributes_to')
  select
    l.dst_id as goal_id,
    count(t.id)::int as linked_tasks,
    count(t.id) filter (where t.status = 'done')::int as linked_tasks_done
  from links l
  join tasks t on t.id = l.src_id and l.src_type = 'task'
  where l.dst_type = 'goal'
    and l.relation = 'contributes_to'
    and t.archived_at is null
  group by l.dst_id
),
child_goal_stats as (
  select
    g.parent_goal_id as goal_id,
    count(g.id)::int as child_count,
    count(g.id) filter (where g.status = 'done')::int as children_done,
    case
      when count(g.id) = 0 then null
      else round(avg(
        case when g.target_value > 0
          then least(100.0 * coalesce(g.current_value, 0) / g.target_value, 100)
          else case when g.status = 'done' then 100 else 0 end
        end
      ), 1)
    end as avg_child_progress
  from goals g
  where g.parent_goal_id is not null
    and g.archived_at is null
  group by g.parent_goal_id
)
select
  g.id as goal_id,
  g.user_id,
  g.title,
  g.kind,
  g.area,
  g.horizon,
  g.status as goal_status,
  g.target_value,
  g.current_value,
  g.unit,
  g.progress_mode,
  -- direct progress %
  case
    when g.target_value > 0
      then round(least(100.0 * coalesce(g.current_value, 0) / g.target_value, 100), 1)
    else null
  end as direct_pct,
  -- linked task progress
  coalesce(lt.linked_tasks, 0) as linked_tasks,
  coalesce(lt.linked_tasks_done, 0) as linked_tasks_done,
  case
    when coalesce(lt.linked_tasks, 0) > 0
      then round(100.0 * lt.linked_tasks_done / lt.linked_tasks, 1)
    else null
  end as linked_tasks_pct,
  -- child goal rollup
  coalesce(cg.child_count, 0) as child_goals,
  coalesce(cg.children_done, 0) as child_goals_done,
  cg.avg_child_progress
from goals g
left join linked_task_stats lt on lt.goal_id = g.id
left join child_goal_stats cg on cg.goal_id = g.id
where g.archived_at is null;

-- =============================================================================
-- habit_stats (§3.3)
-- Per habit: current streak, longest streak, 30/90-day rate, EWMA strength score
-- EWMA: exponentially weighted moving average of daily completions
-- Alpha = 2/(span+1), span=30 days (matches Loop Habit Tracker model)
-- =============================================================================

create or replace view habit_stats as
with daily_completions as (
  -- one row per day a habit was logged
  select
    h.id as habit_id,
    h.user_id,
    (hl.logged_at at time zone 'UTC')::date as log_date,
    count(*) as logs_on_day
  from habits h
  join habit_logs hl on hl.habit_id = h.id and hl.archived_at is null
  where h.archived_at is null
  group by h.id, h.user_id, (hl.logged_at at time zone 'UTC')::date
),
date_series as (
  -- last 90 days
  select generate_series(
    current_date - interval '89 days',
    current_date,
    interval '1 day'
  )::date as d
),
habit_daily as (
  select
    h.id as habit_id,
    h.user_id,
    h.name,
    h.polarity,
    h.schedule,
    h.metric_type,
    h.active,
    ds.d as day,
    case when dc.logs_on_day > 0 then 1 else 0 end as completed
  from habits h
  cross join date_series ds
  left join daily_completions dc
    on dc.habit_id = h.id and dc.log_date = ds.d
  where h.archived_at is null
),
streaks as (
  select
    habit_id,
    user_id,
    -- current streak: consecutive days ending today (or yesterday for non-daily)
    -- For build habits: streak of completions
    -- For break habits: streak of non-completions (days without logging)
    (
      select count(*)
      from (
        select day, completed,
          row_number() over (order by day desc)
          - row_number() over (partition by completed order by day desc) as grp
        from habit_daily hd2
        where hd2.habit_id = habit_daily.habit_id
      ) sub
      where grp = (
        select
          row_number() over (order by day desc)
          - row_number() over (partition by completed order by day desc)
        from habit_daily hd3
        where hd3.habit_id = habit_daily.habit_id
          and hd3.day = current_date
        limit 1
      )
      and case
        when (select polarity from habits where id = habit_daily.habit_id) = 'build'
          then completed = 1
        else completed = 0
      end
    ) as current_streak
  from habit_daily
  where day = current_date
  group by habit_id, user_id
),
ewma_calc as (
  -- EWMA with alpha = 2/(30+1) ~ 0.0645
  select
    habit_id,
    user_id,
    -- We compute EWMA iteratively via a window function approximation
    -- Using the recursive formula: S_t = alpha * x_t + (1 - alpha) * S_{t-1}
    -- Approximated as exponential decay weighted average over 90 days
    round(
      sum(
        completed * power(1.0 - (2.0/31.0), (current_date - day))
      ) / nullif(
        sum(power(1.0 - (2.0/31.0), (current_date - day))),
        0
      ) * 100
    , 1) as strength_score
  from habit_daily
  group by habit_id, user_id
)
select
  hd.habit_id,
  hd.user_id,
  hd.name,
  hd.polarity,
  hd.active,
  -- 30-day completion rate
  round(
    100.0 * sum(hd.completed) filter (where hd.day > current_date - 30)
    / 30.0
  , 1) as rate_30d,
  -- 90-day completion rate
  round(
    100.0 * sum(hd.completed) / 90.0
  , 1) as rate_90d,
  -- current streak (simplified: consecutive days from today backwards)
  (
    select count(*)::int
    from (
      select day,
        day - (row_number() over (order by day desc))::int * interval '1 day' as grp
      from habit_daily hd2
      where hd2.habit_id = hd.habit_id
        and case
          when hd.polarity = 'build' then hd2.completed = 1
          else hd2.completed = 0
        end
        and hd2.day <= current_date
    ) sub
    where grp = (
      select day - interval '1 day' * 0
      from habit_daily hd3
      where hd3.habit_id = hd.habit_id
        and hd3.day = current_date
        and case
          when hd.polarity = 'build' then hd3.completed = 1
          else hd3.completed = 0
        end
      limit 1
    )
  ) as current_streak,
  -- longest streak in 90 days
  (
    select coalesce(max(streak_len), 0)::int
    from (
      select count(*) as streak_len
      from (
        select day,
          day - (row_number() over (order by day))::int * interval '1 day' as grp
        from habit_daily hd2
        where hd2.habit_id = hd.habit_id
          and case
            when hd.polarity = 'build' then hd2.completed = 1
            else hd2.completed = 0
          end
      ) sub
      group by grp
    ) streaks
  ) as longest_streak,
  -- EWMA strength score
  coalesce(ew.strength_score, 0) as strength_score
from habit_daily hd
left join ewma_calc ew on ew.habit_id = hd.habit_id and ew.user_id = hd.user_id
group by hd.habit_id, hd.user_id, hd.name, hd.polarity, hd.active,
         ew.strength_score;

-- =============================================================================
-- weekly_review (§3.3)
-- Per week: tasks completed, habits %, activities logged, interactions, notes
-- =============================================================================

create or replace view weekly_review as
select
  sub.user_id,
  sub.week_start,
  (select count(*)
   from tasks t
   where t.user_id = sub.user_id
     and t.completed_at >= sub.week_start
     and t.completed_at < sub.week_start + interval '7 days'
     and t.archived_at is null
  )::int as tasks_completed,
  (select case when count(distinct h.id) = 0 then null
    else round(100.0 *
      count(distinct (hl.habit_id, (hl.logged_at::date))) /
      (count(distinct h.id) * 7.0)
    , 1) end
   from habits h
   left join habit_logs hl
     on hl.habit_id = h.id
     and hl.logged_at >= sub.week_start
     and hl.logged_at < sub.week_start + interval '7 days'
     and hl.archived_at is null
   where h.user_id = sub.user_id
     and h.active = true
     and h.archived_at is null
  ) as habits_pct,
  (select count(*)
   from activity_logs al
   where al.user_id = sub.user_id
     and al.occurred_at >= sub.week_start
     and al.occurred_at < sub.week_start + interval '7 days'
     and al.archived_at is null
  )::int as activities_logged,
  (select count(*)
   from interactions i
   where i.user_id = sub.user_id
     and i.occurred_at >= sub.week_start
     and i.occurred_at < sub.week_start + interval '7 days'
     and i.archived_at is null
  )::int as interactions_had,
  (select count(*)
   from notes n
   where n.user_id = sub.user_id
     and n.created_at >= sub.week_start
     and n.created_at < sub.week_start + interval '7 days'
     and n.archived_at is null
  )::int as notes_written
from (
  select distinct
    user_id,
    date_trunc('week', d)::date as week_start
  from (
    select user_id, completed_at as d from tasks where completed_at is not null
    union
    select user_id, logged_at as d from habit_logs
    union
    select user_id, occurred_at as d from activity_logs
    union
    select user_id, occurred_at as d from interactions
    union
    select user_id, created_at as d from notes
  ) all_dates
) sub;

-- =============================================================================
-- exercises_available (§4.3)
-- Per location: exercises whose required_equipment is satisfied by that location
-- Bodyweight exercises (empty required_equipment) always qualify
-- =============================================================================

create or replace view exercises_available as
select
  l.id as location_id,
  l.user_id,
  l.name as location_name,
  e.id as exercise_id,
  e.name as exercise_name,
  e.muscle_groups,
  e.required_equipment
from locations l
cross join exercises e
where l.archived_at is null
  and e.archived_at is null
  and l.user_id = e.user_id
  and (
    -- bodyweight: no equipment needed
    e.required_equipment = '{}'
    or
    -- all required equipment available at this location
    not exists (
      select 1
      from unnest(e.required_equipment) as req(item)
      where not exists (
        select 1
        from equipment eq
        where eq.location_id = l.id
          and eq.archived_at is null
          and lower(eq.name) = lower(req.item)
      )
    )
  );

-- =============================================================================
-- today_agenda (§5.5)
-- Today's events + due/overdue tasks + scheduled habits + overdue follow-up contacts
-- Single view for the morning briefing
-- =============================================================================

create or replace view today_agenda as
-- Today's events
select
  user_id,
  'event' as item_type,
  id as item_id,
  title as item_title,
  starts_at as item_time,
  jsonb_build_object('ends_at', ends_at, 'category', category) as item_details
from events
where starts_at::date = current_date
  and archived_at is null

union all

-- Due or overdue tasks
select
  user_id,
  'task' as item_type,
  id as item_id,
  title as item_title,
  deadline::timestamptz as item_time,
  jsonb_build_object('status', status, 'priority', priority, 'project_id', project_id, 'overdue', deadline < current_date) as item_details
from tasks
where deadline <= current_date
  and status not in ('done', 'someday')
  and archived_at is null

union all

-- Active habits (all scheduled for today — app/agent filters by schedule)
select
  user_id,
  'habit' as item_type,
  h.id as item_id,
  h.name as item_title,
  null::timestamptz as item_time,
  jsonb_build_object(
    'polarity', h.polarity,
    'schedule', h.schedule,
    'logged_today', exists(
      select 1 from habit_logs hl
      where hl.habit_id = h.id
        and (hl.logged_at at time zone 'UTC')::date = current_date
        and hl.archived_at is null
    )
  ) as item_details
from habits h
where h.active = true
  and h.archived_at is null

union all

-- Contacts overdue for follow-up
select
  user_id,
  'follow_up' as item_type,
  id as item_id,
  full_name as item_title,
  last_interaction_at as item_time,
  jsonb_build_object(
    'follow_up_interval_days', follow_up_interval_days,
    'days_overdue', current_date - (last_interaction_at::date + follow_up_interval_days)
  ) as item_details
from contacts
where follow_up_interval_days is not null
  and archived_at is null
  and (
    last_interaction_at is null
    or last_interaction_at::date + follow_up_interval_days <= current_date
  );
