// --- Status definitions ---

export const TASK_STATUSES = [
  { value: "inbox", label: "Inbox", color: "var(--color-status-inbox)" },
  { value: "next_action", label: "Next Action", color: "var(--color-status-next-action)" },
  { value: "in_progress", label: "In Progress", color: "var(--color-status-in-progress)" },
  { value: "waiting_for", label: "Waiting For", color: "var(--color-status-waiting-for)" },
  { value: "blocked", label: "Blocked", color: "var(--color-status-blocked)" },
  { value: "someday", label: "Someday", color: "var(--color-status-someday)" },
  { value: "done", label: "Done", color: "var(--color-status-done)" },
] as const;

export const PROJECT_STATUSES = [
  { value: "idea", label: "Idea", color: "var(--color-status-inbox)" },
  { value: "active", label: "Active", color: "var(--color-accent-info)" },
  { value: "paused", label: "Paused", color: "var(--color-accent-warning)" },
  { value: "done", label: "Done", color: "var(--color-status-done)" },
] as const;

export const GOAL_STATUSES = [
  { value: "not_started", label: "Not Started", color: "var(--color-status-inbox)" },
  { value: "in_progress", label: "In Progress", color: "var(--color-status-in-progress)" },
  { value: "at_risk", label: "At Risk", color: "var(--color-accent-danger)" },
  { value: "done", label: "Done", color: "var(--color-status-done)" },
] as const;

export const HORIZONS = [
  { value: "annual", label: "Annual" },
  { value: "q1", label: "Q1" },
  { value: "q2", label: "Q2" },
  { value: "q3", label: "Q3" },
  { value: "q4", label: "Q4" },
] as const;

export const PRIORITIES = [
  { value: "high", label: "High", color: "var(--color-accent-danger)" },
  { value: "medium", label: "Medium", color: "var(--color-accent-info)" },
  { value: "low", label: "Low", color: "var(--color-text-muted)" },
] as const;

export const LIFE_AREAS = [
  { value: "money", label: "Money", color: "var(--color-area-money)" },
  { value: "health", label: "Health", color: "var(--color-area-health)" },
  { value: "growth", label: "Growth", color: "var(--color-area-growth)" },
  { value: "work", label: "Work", color: "var(--color-area-work)" },
  { value: "relationships", label: "Relationships", color: "var(--color-area-relationships)" },
  { value: "play", label: "Play", color: "var(--color-area-play)" },
  { value: "environment", label: "Environment", color: "var(--color-area-environment)" },
] as const;

// --- Kanban column mapping ---
// 7 task statuses -> 4 kanban columns. Someday is excluded from kanban.

export const KANBAN_COLUMNS = [
  { id: "todo", label: "To Do", statuses: ["inbox", "next_action"], defaultWriteStatus: "next_action" },
  { id: "in_progress", label: "In Progress", statuses: ["in_progress", "waiting_for"], defaultWriteStatus: "in_progress" },
  { id: "blocked", label: "Blocked", statuses: ["blocked"], defaultWriteStatus: "blocked" },
  { id: "done", label: "Done", statuses: ["done"], defaultWriteStatus: "done" },
] as const;

// --- Helper functions ---

const STATUS_MAP = Object.fromEntries([
  ...TASK_STATUSES.map((s) => [`task:${s.value}`, s]),
  ...PROJECT_STATUSES.map((s) => [`project:${s.value}`, s]),
  ...GOAL_STATUSES.map((s) => [`goal:${s.value}`, s]),
]);

const AREA_MAP = Object.fromEntries(LIFE_AREAS.map((a) => [a.value, a]));
const PRIORITY_MAP = Object.fromEntries(PRIORITIES.map((p) => [p.value, p]));

export function getStatusColor(status: string, type?: "task" | "project" | "goal"): string {
  if (type) return STATUS_MAP[`${type}:${status}`]?.color ?? "var(--color-text-muted)";
  return STATUS_MAP[`task:${status}`]?.color
    ?? STATUS_MAP[`project:${status}`]?.color
    ?? STATUS_MAP[`goal:${status}`]?.color
    ?? "var(--color-text-muted)";
}

export function getStatusLabel(status: string, type: "task" | "project" | "goal" = "task"): string {
  return STATUS_MAP[`${type}:${status}`]?.label ?? status;
}

export function getAreaColor(area: string): string {
  return AREA_MAP[area]?.color ?? "var(--color-text-muted)";
}

export function getAreaLabel(area: string): string {
  return AREA_MAP[area]?.label ?? area;
}

export function getPriorityColor(priority: string): string {
  return PRIORITY_MAP[priority]?.color ?? "var(--color-text-muted)";
}

export function getPriorityLabel(priority: string): string {
  return PRIORITY_MAP[priority]?.label ?? priority;
}

export function formatLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getPillColor(value: string, type: "status" | "area" | "priority"): string {
  if (type === "area") return getAreaColor(value);
  if (type === "priority") return getPriorityColor(value);
  return getStatusColor(value);
}
