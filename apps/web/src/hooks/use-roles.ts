import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  rolesApi,
  Role,
  RoleAssignment,
  AssignRoleRequest,
  CreateRoleInput,
  UpdateRoleInput,
} from "@/lib/api";
import { toast } from "sonner";

// Query keys
export const rolesKeys = {
  all: ["roles"] as const,
  lists: () => [...rolesKeys.all, "list"] as const,
  list: (realm?: string) => [...rolesKeys.lists(), { realm }] as const,
  details: () => [...rolesKeys.all, "detail"] as const,
  detail: (id: string) => [...rolesKeys.details(), id] as const,
  userRoles: (userId: string) => [...rolesKeys.all, "user", userId] as const,
  myRoles: () => [...rolesKeys.all, "my-roles"] as const,
};

// Get all roles
export function useRoles(realm?: string) {
  return useQuery({
    queryKey: rolesKeys.list(realm),
    queryFn: async () => {
      const response = await rolesApi.getAllRoles(realm);
      return response.data.data;
    },
    staleTime: 60 * 60 * 1000, // 1 hour
  });
}

// Get role by ID
export function useRole(id: string) {
  return useQuery({
    queryKey: rolesKeys.detail(id),
    queryFn: async () => {
      const response = await rolesApi.getRoleById(id);
      return response.data.data;
    },
    enabled: !!id,
    staleTime: 60 * 60 * 1000, // 1 hour
  });
}

// Create Role
export function useCreateRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateRoleInput) => rolesApi.createRole(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rolesKeys.lists() });
      toast.success("Role created successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create role");
    },
  });
}

// Update Role
export function useUpdateRole(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateRoleInput) => rolesApi.updateRole(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rolesKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: rolesKeys.lists() });
      toast.success("Role updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update role");
    },
  });
}

// Get current user's roles
export function useMyRoles() {
  return useQuery({
    queryKey: rolesKeys.myRoles(),
    queryFn: async () => {
      const response = await rolesApi.getMyRoles();
      return response.data.data;
    },
    staleTime: 60 * 60 * 1000, // 1 hour
  });
}

// Get roles for a specific user
export function useUserRoles(userId: string) {
  return useQuery({
    queryKey: rolesKeys.userRoles(userId),
    queryFn: async () => {
      const response = await rolesApi.getUserRoles(userId);
      return response.data.data;
    },
    enabled: !!userId,
    staleTime: 60 * 60 * 1000, // 1 hour
  });
}

// Assign role to user
export function useAssignRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: AssignRoleRequest) => rolesApi.assignRole(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: rolesKeys.userRoles(variables.userId),
      });
      toast.success("Role assigned successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to assign role");
    },
  });
}

// Set primary role
export function useSetPrimaryRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      userId,
      roleAssignmentId,
    }: {
      userId: string;
      roleAssignmentId: string;
    }) => rolesApi.setPrimaryRole(userId, roleAssignmentId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: rolesKeys.userRoles(variables.userId),
      });
      toast.success("Primary role updated");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to set primary role");
    },
  });
}

// Remove role assignment
export function useRemoveRoleAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (assignmentId: string) =>
      rolesApi.removeRoleAssignment(assignmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rolesKeys.all });
      toast.success("Role removed successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to remove role");
    },
  });
}

// Switch current user's active role
export function useSwitchRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (roleAssignmentId: string) =>
      rolesApi.switchRole(roleAssignmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rolesKeys.myRoles() });
      // Note: auth store handles page reload after switch
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to switch role");
    },
  });
}

// Role realm display names. Keys mirror the `Realm` enum in schema.prisma — all
// eight values are listed so a new realm renders its own name instead of falling
// through to a raw code.
export const realmDisplayNames: Record<string, string> = {
  GLOBAL: "Global",
  YAYASAN: "Yayasan",
  TK_QURAN: "TK Qur'an",
  SD_IT: "SD IT",
  SMP_IT: "SMP IT",
  SMA_QURAN: "SMA Qur'an",
  PESANTREN: "Pesantren",
  UNIT_USAHA: "Sarana & Unit Usaha",
};

// Role realm colors
export const realmColors: Record<string, string> = {
  GLOBAL: "bg-purple-500 hover:bg-purple-600",
  YAYASAN: "bg-amber-500 hover:bg-amber-600",
  TK_QURAN: "bg-pink-500 hover:bg-pink-600",
  SD_IT: "bg-green-500 hover:bg-green-600",
  SMP_IT: "bg-blue-500 hover:bg-blue-600",
  SMA_QURAN: "bg-emerald-500 hover:bg-emerald-600",
  PESANTREN: "bg-orange-500 hover:bg-orange-600",
  UNIT_USAHA: "bg-teal-500 hover:bg-teal-600",
};

const UNKNOWN_REALM_COLOR = "bg-slate-500 hover:bg-slate-600";

/** Bucket key for a role assignment whose realm is missing from the payload. */
export const UNKNOWN_REALM = "UNKNOWN";

/**
 * Human label for a role realm, tolerating a missing/unknown value.
 *
 * The realm arrives from the API's `/auth/me` payload, but it also reaches the
 * UI through whatever a previous session persisted to localStorage, so it can
 * legitimately be absent (a session written before the field existed). Callers
 * used to do `realm.replace("_", " ")` directly, which threw a TypeError inside
 * the sidebar for *every* user on the page — the app rendered a blank screen
 * rather than a page. Fall back instead of throwing.
 */
export function realmLabel(realm: string | undefined | null): string {
  if (!realm) return "Tidak diketahui";
  return realmDisplayNames[realm] || realm.replace(/_/g, " ");
}

/** Colour class for a realm badge, tolerating a missing/unknown value. */
export function realmColorClass(realm: string | undefined | null): string {
  if (!realm) return UNKNOWN_REALM_COLOR;
  return realmColors[realm] || UNKNOWN_REALM_COLOR;
}

// Group roles by realm
export function groupRolesByRealm(roles: Role[]): Record<string, Role[]> {
  return roles.reduce(
    (acc, role) => {
      const realm = role.realm;
      if (!acc[realm]) acc[realm] = [];
      acc[realm].push(role);
      return acc;
    },
    {} as Record<string, Role[]>,
  );
}
