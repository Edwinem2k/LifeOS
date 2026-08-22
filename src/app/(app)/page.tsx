"use client";

import { useToday } from "@/hooks/use-today";
import { useCompleteTask } from "@/hooks/use-tasks";
import { useLogHabit } from "@/hooks/use-habits";
import { StatusPill } from "@/components/app/StatusPill";
import { isRequiredOn } from "@/lib/habit-stats";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatDate(): string {
  return new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export default function TodayPage() {
  const { data: agenda, isLoading } = useToday();
  const completeTask = useCompleteTask();
  const logHabit = useLogHabit();

  const tasks = agenda?.filter((item: any) => item.item_type === "task") ?? [];
  const today = new Date();
  const habits =
    agenda
      ?.filter((item: any) => item.item_type === "habit")
      .filter((item: any) => isRequiredOn(item.item_details?.schedule, today)) ?? [];
  const events = agenda?.filter((item: any) => item.item_type === "event") ?? [];

  const tasksDue = tasks.length;
  const habitsRemaining = habits.filter(
    (h: any) => !h.item_details?.logged_today
  ).length;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-text-primary">
        {getGreeting()}, Axel
      </h1>
      <p className="text-text-secondary text-sm mt-1">
        {formatDate()} — {tasksDue} task{tasksDue !== 1 ? "s" : ""} due
        {habitsRemaining > 0 && `, ${habitsRemaining} habit${habitsRemaining !== 1 ? "s" : ""} to go`}
      </p>

      {isLoading ? (
        <div className="mt-8 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 bg-card rounded-sm animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {tasks.length > 0 && (
            <section>
              <h2 className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-3">
                Due Today
              </h2>
              <div className="space-y-1">
                {tasks.map((task: any) => (
                  <div
                    key={task.item_id}
                    className="flex items-center gap-3 py-2 px-3 rounded-sm hover:bg-card group"
                  >
                    <input
                      type="checkbox"
                      checked={task.item_details?.status === "done"}
                      onChange={() => completeTask.mutate(task.item_id)}
                      className="w-4 h-4 rounded border-2 border-border-default accent-accent-primary cursor-pointer"
                    />
                    <span className="text-sm text-text-primary flex-1">
                      {task.item_title}
                    </span>
                    {task.item_details?.project_name && (
                      <span className="text-xs bg-card text-text-secondary px-2 py-0.5 rounded-sm">
                        {task.item_details.project_name}
                      </span>
                    )}
                    {task.item_details?.overdue && (
                      <StatusPill value="overdue" type="status" />
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {habits.length > 0 && (
            <section>
              <h2 className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-3">
                Habits
              </h2>
              <div className="space-y-1">
                {habits.map((habit: any) => (
                  <div
                    key={habit.item_id}
                    className="flex items-center gap-3 py-2 px-3 rounded-sm hover:bg-card"
                  >
                    <button
                      onClick={() => logHabit.mutate({ habitId: habit.item_id })}
                      className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-semibold transition-colors ${
                        habit.item_details?.logged_today
                          ? "border-accent-success bg-accent-success text-white"
                          : "border-border-default text-text-muted hover:border-accent-success"
                      }`}
                    >
                      {habit.item_details?.logged_today ? "\u2713" : "\u2014"}
                    </button>
                    <span className="text-sm text-text-primary flex-1">
                      {habit.item_title}
                    </span>
                    {habit.item_details?.streak > 0 && (
                      <span className="text-xs text-accent-success font-medium">
                        {habit.item_details.streak}-day streak
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {events.length > 0 && (
            <section>
              <h2 className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-3">
                Events
              </h2>
              <div className="space-y-1">
                {events.map((event: any) => (
                  <div
                    key={event.item_id}
                    className="flex items-center gap-3 py-2 px-3 rounded-sm hover:bg-card"
                  >
                    <span className="text-xs text-text-secondary w-14">
                      {event.item_details?.time ?? "\u2014"}
                    </span>
                    <span className="text-sm text-text-primary flex-1">
                      {event.item_title}
                    </span>
                    {event.item_details?.category && (
                      <StatusPill value={event.item_details.category} type="status" />
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
