import { useQuery } from "@tanstack/react-query";
import { getAreaProgress } from "@/services/views";

export function useAreaProgress() {
  return useQuery({
    queryKey: ["area-progress"],
    queryFn: getAreaProgress,
  });
}
