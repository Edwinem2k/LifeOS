import { useQuery } from "@tanstack/react-query";
import { getLinksFor } from "@/services/links";

export function useLinks(entityType: string, entityId: string) {
  return useQuery({
    queryKey: ["links", entityType, entityId],
    queryFn: () => getLinksFor(entityType, entityId),
    enabled: !!entityId,
  });
}
