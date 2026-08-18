import { useQuery } from "@tanstack/react-query";
import { getProjectProgress } from "@/services/views";

export function useProjectProgress() {
  return useQuery({
    queryKey: ["project-progress"],
    queryFn: getProjectProgress,
  });
}
