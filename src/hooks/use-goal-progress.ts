import { useQuery } from "@tanstack/react-query";
import { getGoalProgress } from "@/services/views";

export function useGoalProgress() {
  return useQuery({
    queryKey: ["goal-progress"],
    queryFn: getGoalProgress,
  });
}
