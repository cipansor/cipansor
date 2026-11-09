"use client";
import { useState, useMemo } from "react";
import { safeFormat } from "@/lib/date";
import { useRouter } from "next/navigation";
import { type ColumnDef } from "@/components/shared";
import { MainLayout } from "@/components/layout";
import {
  PageHeader,
  DataTable,
  SearchInput,
  ConfirmDialog,
} from "@/components/shared";
import {
  useUsers,
  useDeleteUser,
  useUnits,
  useRequirePasswordChange,
} from "@/hooks";
import { realmDisplayNames, realmColors } from "@/hooks/use-roles";
import { User, UserRole, authApi } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  MoreHorizontal,
  Eye,
  Pencil,
  Trash2,
  Shield,
  Building2,
  ShieldAlert,
  KeyRound,
  LockKeyhole,
} from "lucide-react";
import { TwoFactorVerify } from "@/components/auth/TwoFactorVerify";

import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/api-error";

// Realm filter options
const realmOptions = [
  { value: "ALL", label: "All Realms" },
  { value: "GLOBAL", label: "Global" },
  { value: "YAYASAN", label: "Yayasan" },
  { value: "TK_QURAN", label: "TK Qur'an" },
  { value: "SD_IT", label: "SD IT" },
  { value: "SMP_IT", label: "SMP IT" },
  { value: "SMA_QURAN", label: "SMA Qur'an" },
  { value: "PESANTREN", label: "Pesantren" },
];

// Role badge colors
const roleBadgeColors: Record<string, string> = {
  GLOBAL: "bg-purple-100 text-purple-800 border-purple-200",
  YAYASAN: "bg-amber-100 text-amber-800 border-amber-200",
  TK_QURAN: "bg-pink-100 text-pink-800 border-pink-200",
  SD_IT: "bg-green-100 text-green-800 border-green-200",
  SMP_IT: "bg-blue-100 text-blue-800 border-blue-200",
  SMA_QURAN: "bg-emerald-100 text-emerald-800 border-emerald-200",
  PESANTREN: "bg-orange-100 text-orange-800 border-orange-200",
};

// UserRoles display component
function UserRolesBadges({ userRoles }: { userRoles?: UserRole[] }) {
  if (!userRoles || userRoles.length === 0) {
    return <span className="text-muted-foreground text-sm">No roles</span>;
  }

  const primaryRole = userRoles.find((r) => r.isPrimary);
  const otherRoles = userRoles.filter((r) => !r.isPrimary);
  const displayedRoles = primaryRole
    ? [primaryRole, ...otherRoles.slice(0, 1)]
    : otherRoles.slice(0, 2);
  const remainingCount = userRoles.length - displayedRoles.length;

  return (
    <TooltipProvider>
      <div className="flex flex-wrap gap-1 items-center">
        {displayedRoles.map((ur) => (
          <Tooltip key={ur.id}>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs",
                  roleBadgeColors[ur.role.realm] || "bg-gray-100 text-gray-800",
                  ur.isPrimary && "ring-1 ring-offset-1 ring-primary",
                )}
              >
                {ur.role.name}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-xs">
                <p className="font-medium">{ur.role.name}</p>
                <p className="text-muted-foreground">
                  {realmDisplayNames[ur.role.realm] || ur.role.realm}
                </p>
                {ur.unit && (
                  <p className="flex items-center gap-1">
                    <Building2 className="h-3 w-3" />
                    {ur.unit.name}
                  </p>
                )}
                {ur.isPrimary && (
                  <p className="text-primary font-medium">Primary Role</p>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
        {remainingCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="secondary" className="text-xs">
                +{remainingCount}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-xs space-y-1">
                {userRoles.slice(displayedRoles.length).map((ur) => (
                  <p key={ur.id}>{ur.role.name}</p>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}

export default function UsersPage() {
  const router = useRouter();
  const { user: currentUser } = useAuthStore();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [realmFilter, setRealmFilter] = useState<string>("");
  const [unitFilter, setUnitFilter] = useState<string>("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [sendingResetFor, setSendingResetFor] = useState<string | null>(null);
  const [deactivate2FAUserId, setDeactivate2FAUserId] = useState<string | null>(
    null,
  );
  const [passwordChangeFor, setPasswordChangeFor] = useState<User | null>(null);

  // Get active role from current user
  const activeUserRole = useMemo(() => {
    const userRoles = currentUser?.userRoles as UserRole[] | undefined;
    return userRoles?.find((r) => r.isPrimary) || userRoles?.[0];
  }, [currentUser?.userRoles]);

  const isSuperAdmin = activeUserRole?.role.code === "SUPER_ADMIN";

  const { data: units } = useUnits();
  const { data, isLoading } = useUsers({
    page,
    limit: pageSize,
    search: search || undefined,
    unitId: unitFilter || (!isSuperAdmin ? currentUser?.unitId : undefined),
    // Filtered by the API across every page, not within the page shown.
    realm: realmFilter || undefined,
  });

  const deleteMutation = useDeleteUser();
  const requirePasswordChange = useRequirePasswordChange();

  /**
   * For a password that leaked or that someone else learned: the account
   * chooses a new one at its next sign-in. The admin never learns it.
   */
  const handleRequirePasswordChange = async () => {
    if (!passwordChangeFor) return;
    try {
      const result = await requirePasswordChange.mutateAsync(
        passwordChangeFor.id,
      );
      toast.success(result.message);
      setPasswordChangeFor(null);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  /**
   * E-mail this user a password reset link.
   *
   * This is the whole "lupa password" flow. There is deliberately no public
   * self-service form — a user who cannot sign in contacts an admin, who
   * identifies them and triggers this from here, and only the reset *link*
   * travels by e-mail. The admin never sees or sets the new password.
   */
  const handleSendPasswordReset = async (userId: string, name: string) => {
    setSendingResetFor(userId);
    try {
      const { data } = await authApi.sendPasswordReset({ userId });
      const result = data.data as { message: string; expiresInHours: number };
      toast.success(result.message, {
        description: `Tautan berlaku ${result.expiresInHours} jam. ${name} harus membukanya sebelum kedaluwarsa.`,
      });
    } catch {
      // The API's reason is already on screen: the shared client toasts it.
    } finally {
      setSendingResetFor(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMutation.mutateAsync(deleteId);
      toast.success("User deleted successfully");
      setDeleteId(null);
    } catch {
      toast.error("Failed to delete user");
    }
  };

  // Search and filters narrow the whole list, so they start again at page
  // one: kept on page 2, a search with three results showed an empty table
  // and "Page 2 of 1".
  const narrow =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };

  const columns: ColumnDef<User>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-medium">
            {row.original.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-medium">{row.original.name}</p>
            <p className="text-xs text-muted-foreground">
              {row.original.email}
            </p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "userRoles",
      header: "Roles",
      cell: ({ row }) => (
        <UserRolesBadges
          userRoles={row.original.userRoles as UserRole[] | undefined}
        />
      ),
    },
    {
      accessorKey: "unit",
      header: "Unit",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.unit?.name || "-"}</span>
      ),
    },
    {
      accessorKey: "isActive",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? "default" : "secondary"}>
          {row.original.isActive ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ row }) => (
        <span className="text-sm">
          {safeFormat(new Date(row.original.createdAt), "dd MMM yyyy")}
        </span>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const isSelf = row.original.id === currentUser?.id;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => router.push(`/users/${row.original.id}`)}
              >
                <Eye className="mr-2 h-4 w-4" />
                View
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => router.push(`/users/${row.original.id}/edit`)}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => router.push(`/users/${row.original.id}/roles`)}
              >
                <Shield className="mr-2 h-4 w-4" />
                Manage Roles
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={sendingResetFor === row.original.id}
                onClick={() =>
                  handleSendPasswordReset(row.original.id, row.original.name)
                }
              >
                <KeyRound className="mr-2 h-4 w-4" />
                {sendingResetFor === row.original.id
                  ? "Mengirim…"
                  : "Kirim tautan reset password"}
              </DropdownMenuItem>
              {!isSelf && (
                <DropdownMenuItem
                  onClick={() => setPasswordChangeFor(row.original)}
                >
                  <LockKeyhole className="mr-2 h-4 w-4" />
                  Wajibkan ganti kata sandi
                </DropdownMenuItem>
              )}
              {(row.original as any).isTwoFactorEnabled && (
                <DropdownMenuItem
                  onClick={() => setDeactivate2FAUserId(row.original.id)}
                  className="text-amber-600"
                >
                  <ShieldAlert className="mr-2 h-4 w-4" />
                  Matikan verifikasi dua langkah
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {!isSelf && (
                <DropdownMenuItem
                  onClick={() => setDeleteId(row.original.id)}
                  className="text-red-600"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <MainLayout allowedRoles={["SUPER_ADMIN", "UNIT_ADMIN"]}>
      <div className="space-y-6">
        <PageHeader
          title="Users & Roles"
          description="Manage system users and their role assignments"
          action={{
            label: "Add User",
            href: "/users/new",
          }}
        />

        {/* Filters */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="w-full md:w-80">
            <SearchInput
              placeholder="Search by name or email..."
              value={search}
              onChange={narrow(setSearch)}
            />
          </div>
          <Select
            value={realmFilter}
            onValueChange={(v) => narrow(setRealmFilter)(v === "ALL" ? "" : v)}
          >
            <SelectTrigger className="w-full md:w-44">
              <SelectValue placeholder="All Realms" />
            </SelectTrigger>
            <SelectContent>
              {realmOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isSuperAdmin && (
            <Select
              value={unitFilter}
              onValueChange={(v) => narrow(setUnitFilter)(v === "ALL" ? "" : v)}
            >
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="All Units" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Units</SelectItem>
                {units?.map((unit) => (
                  <SelectItem key={unit.id} value={unit.id}>
                    {unit.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Table */}
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          isLoading={isLoading}
          onRowClick={(row) => router.push(`/users/${row.id}`)}
          pagination={{
            page,
            totalPages: data?.meta?.pagination?.totalPages || 1,
            pageSize,
            total: data?.meta?.pagination?.total || 0,
            onPageChange: setPage,
            onPageSizeChange: (size) => {
              setPageSize(size);
              setPage(1);
            },
          }}
        />

        {/* Delete Confirmation */}
        <ConfirmDialog
          open={!!deleteId}
          onOpenChange={(open) => !open && setDeleteId(null)}
          title="Delete User"
          description="Are you sure you want to delete this user? This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleDelete}
          isLoading={deleteMutation.isPending}
          variant="destructive"
        />

        <ConfirmDialog
          open={!!passwordChangeFor}
          onOpenChange={(open) => !open && setPasswordChangeFor(null)}
          title="Wajibkan ganti kata sandi?"
          description={`Untuk kata sandi yang bocor atau diketahui orang lain. ${passwordChangeFor?.name ?? "Pengguna ini"} harus membuat kata sandi baru saat masuk berikutnya, dan sesinya yang sedang berjalan berakhir paling lama 15 menit lagi. Anda tidak akan mengetahui kata sandi barunya.`}
          confirmLabel="Wajibkan"
          cancelLabel="Batal"
          onConfirm={handleRequirePasswordChange}
          isLoading={requirePasswordChange.isPending}
        />

        {/* Deactivate 2FA Dialog */}
        <Dialog
          open={!!deactivate2FAUserId}
          onOpenChange={(open) => !open && setDeactivate2FAUserId(null)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Matikan Verifikasi Dua Langkah Pengguna</DialogTitle>
              <DialogDescription>
                Untuk pengguna yang kehilangan ponsel dan kode pemulihannya.
                Masukkan kode dari aplikasi autentikator <strong>Anda</strong>{" "}
                untuk mengonfirmasi. Pengguna itu lalu masuk dengan kata sandi
                saja — bila kurang dari 15 karakter, ia diminta membuat yang
                baru — dan bisa mengaktifkannya lagi di Profil.
              </DialogDescription>
            </DialogHeader>
            <TwoFactorVerify
              onVerify={async (token) => {
                try {
                  await authApi.disable2FA({
                    token,
                    userId: deactivate2FAUserId!,
                  });
                  toast.success("Verifikasi dua langkah pengguna dimatikan");
                  setDeactivate2FAUserId(null);
                  // Refresh data
                  window.location.reload();
                } catch {
                  // Error handled in store/interceptor or verify component props
                }
              }}
              submitLabel="Matikan"
            />
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
