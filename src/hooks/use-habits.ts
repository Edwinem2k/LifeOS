import { useMutation, useQueryClient } from "@tanstack/react-query";
import { logHabit, unlogHabit } from "@/services/habits";

export function useLogHabit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: logHabit,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

export function useUnlogHabit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ habitId, date }: { habitId: string; date?: string }) =>
      unlogHabit(habitId, date),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}
