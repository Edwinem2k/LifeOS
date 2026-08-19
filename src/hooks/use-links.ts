import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getLinksFor, linkKRToEntity, unlinkKR as unlinkKRService } from "@/services/links";

export function useLinks(entityType: string, entityId: string) {
  return useQuery({
    queryKey: ["links", entityType, entityId],
    queryFn: () => getLinksFor(entityType, entityId),
    enabled: !!entityId,
  });
}

export function useLinkKR() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ krId, dstType, dstId }: { krId: string; dstType: "project" | "task" | "habit"; dstId: string }) =>
      linkKRToEntity(krId, dstType, dstId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["goal-progress"] });
      qc.invalidateQueries({ queryKey: ["area-progress"] });
      qc.invalidateQueries({ queryKey: ["links"] });
      qc.invalidateQueries({ queryKey: ["key-results"] });
    },
  });
}

export function useUnlinkKR() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => unlinkKRService(linkId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["goal-progress"] });
      qc.invalidateQueries({ queryKey: ["area-progress"] });
      qc.invalidateQueries({ queryKey: ["links"] });
      qc.invalidateQueries({ queryKey: ["key-results"] });
    },
  });
}
