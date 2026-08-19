-- 003_goals_redesign.sql
-- Replaces goal_progress view with KR-based progress calculation
-- Adds area_progress view for progress strip

drop view if exists goal_progress;

create or replace view goal_progress as
with kr_stats as (
  select
    g.parent_goal_id as goal_id,
    count(g.id)::int as kr_count,
    count(g.id) filter (where g.status = 'done')::int as kr_done_count,
    case
      when count(g.id) = 0 then null
      else round(100.0 * count(g.id) filter (where g.status = 'done') / count(g.id), 1)
    end as kr_pct
  from goals g
  where g.kind = 'key_result'
    and g.parent_goal_id is not null
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
  case
    when g.target_value > 0
      then round(least(100.0 * coalesce(g.current_value, 0) / g.target_value, 100), 1)
    else null
  end as direct_pct,
  coalesce(kr.kr_count, 0) as kr_count,
  coalesce(kr.kr_done_count, 0) as kr_done_count,
  kr.kr_pct,
  case
    when coalesce(kr.kr_count, 0) > 0 then kr.kr_pct
    else case
      when g.target_value > 0
        then round(least(100.0 * coalesce(g.current_value, 0) / g.target_value, 100), 1)
      else case when g.status = 'done' then 100.0 else 0.0 end
    end
  end as effective_pct
from goals g
left join kr_stats kr on kr.goal_id = g.id
where g.kind = 'goal'
  and g.archived_at is null;

create or replace view area_progress as
select
  gp.user_id,
  gp.area,
  gp.horizon,
  count(gp.goal_id)::int as goal_count,
  round(avg(coalesce(gp.effective_pct, 0)), 1) as avg_pct
from goal_progress gp
group by gp.user_id, gp.area, gp.horizon;
