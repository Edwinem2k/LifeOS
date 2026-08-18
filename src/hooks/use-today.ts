import { useQuery } from "@tanstack/react-query";
import { getTodayAgenda } from "@/services/views";

export function useToday() {
  return useQuery({
    queryKey: ["today"],
    queryFn: getTodayAgenda,
  });
}
