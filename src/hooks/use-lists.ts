import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getLists, getList, createList, updateList, archiveList,
  getListItems, createListItem, updateListItem, deleteListItem,
  type List, type ListItem,
} from "@/services/lists";
import type { ItemFieldDef } from "@/lib/list-schema";

export function useLists(opts?: { includeArchived?: boolean }) {
  return useQuery({ queryKey: ["lists", opts], queryFn: () => getLists(opts) });
}

export function useList(id: string) {
  return useQuery({ queryKey: ["lists", id], queryFn: () => getList(id), enabled: !!id });
}

export function useListItems(listId: string) {
  return useQuery({
    queryKey: ["list-items", listId],
    queryFn: () => getListItems(listId),
    enabled: !!listId,
  });
}

export function useCreateList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createList,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lists"] }),
  });
}

export function useUpdateList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<List> }) => updateList(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lists"] }),
  });
}

export function useArchiveList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: archiveList,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lists"] }),
  });
}

export function useCreateListItem(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ title, schema, metadata }: {
      title: string; schema: ItemFieldDef[]; metadata?: Record<string, unknown>;
    }) => createListItem(listId, title, schema, metadata),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["list-items", listId] });
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}

export function useUpdateListItem(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data, schema }: {
      id: string; data: Partial<ListItem>; schema: ItemFieldDef[];
    }) => updateListItem(id, data, schema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["list-items", listId] });
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}

export function useDeleteListItem(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteListItem,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["list-items", listId] });
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}
