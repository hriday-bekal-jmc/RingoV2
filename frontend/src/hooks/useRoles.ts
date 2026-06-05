import { useQuery } from '@tanstack/react-query';
import apiClient from '../services/apiClient';

export interface RoleEntry {
  code:       string;
  label_ja:   string;
  label_en:   string;
  sort_order: number;
  is_system:  boolean;
}

export function useRoles() {
  return useQuery<RoleEntry[]>({
    queryKey:  ['admin', 'roles'],
    queryFn:   async () => (await apiClient.get('/admin/roles')).data,
    staleTime: 5 * 60 * 1000,
    gcTime:    10 * 60 * 1000,
  });
}

export function useAssignableRoles() {
  const q = useRoles();
  return {
    ...q,
    data: q.data?.filter((r) => r.code !== 'ADMIN') ?? [],
  };
}
