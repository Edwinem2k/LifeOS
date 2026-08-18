import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getProjects,
  getProject,
  createProject,
  updateProject,
  archiveProject,
  reorderProjects,
} from "@/services/projects";

export function useProjects(filters?: { status?: string; area?: string }) {
  return useQuery({
    queryKey: ["projects", filters],
    queryFn: () => getProjects(filters),
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ["projects", id],
    queryFn: () => getProject(id),
    enabled: !!id,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateProject>[1] }) =>
      updateProject(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project-progress"] });
    },
  });
}

export function useArchiveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: archiveProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useReorderProjects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: reorderProjects,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}
