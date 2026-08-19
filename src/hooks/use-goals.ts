import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getGoals,
  getGoal,
  createGoal,
  updateGoal,
  archiveGoal,
  createKeyResult,
  getKeyResultsForGoal,
  getGoalsForEntities,
} from "@/services/goals";
import { createProject } from "@/services/projects";
import { createTask } from "@/services/tasks";
import { linkKRToEntity } from "@/services/links";

export function useGoals() {
  return useQuery({
    queryKey: ["goals"],
    queryFn: getGoals,
  });
}

export function useGoal(id: string) {
  return useQuery({
    queryKey: ["goals", id],
    queryFn: () => getGoal(id),
    enabled: !!id,
  });
}

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createGoal,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["goal-progress"] });
      qc.invalidateQueries({ queryKey: ["area-progress"] });
    },
  });
}

export function useUpdateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateGoal>[1] }) =>
      updateGoal(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["goal-progress"] });
      qc.invalidateQueries({ queryKey: ["area-progress"] });
    },
  });
}

export function useArchiveGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: archiveGoal,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export function useKeyResults(goalId: string | null) {
  return useQuery({
    queryKey: ["key-results", goalId],
    queryFn: () => getKeyResultsForGoal(goalId!),
    enabled: !!goalId,
  });
}

export function useCreateKeyResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, data }: { goalId: string; data: any }) =>
      createKeyResult(goalId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["goal-progress"] });
      qc.invalidateQueries({ queryKey: ["area-progress"] });
      qc.invalidateQueries({ queryKey: ["key-results"] });
    },
  });
}

export function usePushKRToProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ krId, title, area }: { krId: string; title: string; area: string }) => {
      const project = await createProject({ name: title, status: "idea", area } as any);
      await linkKRToEntity(krId, "project", project.id);
      return project;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["goal-progress"] });
      qc.invalidateQueries({ queryKey: ["area-progress"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["links"] });
      qc.invalidateQueries({ queryKey: ["key-results"] });
    },
  });
}

export function usePushKRToTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ krId, title, area }: { krId: string; title: string; area: string }) => {
      const task = await createTask({ title, status: "inbox", area } as any);
      await linkKRToEntity(krId, "task", task.id);
      return task;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["goal-progress"] });
      qc.invalidateQueries({ queryKey: ["area-progress"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["links"] });
      qc.invalidateQueries({ queryKey: ["key-results"] });
    },
  });
}

export function useGoalsForEntities(entityType: "project" | "task", entityIds: string[]) {
  return useQuery({
    queryKey: ["entity-goals", entityType, entityIds],
    queryFn: () => getGoalsForEntities(entityType, entityIds),
    enabled: entityIds.length > 0,
  });
}
