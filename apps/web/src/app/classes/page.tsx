"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { type ColumnDef } from "@/components/shared";
import { MainLayout } from "@/components/layout";
import {
  PageHeader,
  DataTable,
  SearchInput,
  ConfirmDialog,
} from "@/components/shared";
import { useClasses, useDeleteClass } from "@/hooks/use-classes";
import { Class } from "@cipansor/shared";
import { useUnits } from "@/hooks/use-units";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoreHorizontal, Eye, Pencil, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth";
import { getEffectiveRole } from "@/lib/rbac";

export default function ClassesPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [gradeFilter, setGradeFilter] = useState<string>("ALL");
  const [unitFilter, setUnitFilter] = useState<string>("ALL");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: units } = useUnits();
  const { data, isLoading } = useClasses({
    page,
    limit: pageSize,
    search: search || undefined,
    grade: gradeFilter !== "ALL" ? Number(gradeFilter) : undefined,
    unitId:
      unitFilter !== "ALL"
        ? unitFilter
        : getEffectiveRole(user) !== "SUPER_ADMIN"
          ? user?.unitId
          : undefined,
  });

  const deleteMutation = useDeleteClass();

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMutation.mutateAsync(deleteId);
      toast.success("Class deleted successfully");
      setDeleteId(null);
    } catch {
      toast.error("Failed to delete class");
    }
  };

  const columns: ColumnDef<Class>[] = [
    {
      accessorKey: "name",
      header: "Class Name",
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.name}</p>
          <p className="text-xs text-muted-foreground">
            Grade {row.original.grade}
          </p>
        </div>
      ),
    },
    {
      accessorKey: "grade",
      header: "Grade",
      cell: ({ row }) => (
        <Badge variant="outline">Grade {row.original.grade}</Badge>
      ),
    },
    {
      accessorKey: "academicYear",
      header: "Academic Year",
      cell: ({ row }) => (
        <div>
          <span className="text-sm">
            {row.original.academicYear?.name || "-"}
          </span>
          {row.original.academicYear?.isActive && (
            <Badge
              className="ml-2 bg-green-100 text-green-800"
              variant="outline"
            >
              Active
            </Badge>
          )}
        </div>
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
      accessorKey: "homeroomTeacher",
      header: "Homeroom Teacher",
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.homeroomTeacher?.user.name || "-"}
        </span>
      ),
    },
    {
      accessorKey: "studentCount",
      header: "Students",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">{row.original.studentCount || 0}</span>
        </div>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              // Keep the row's onRowClick (detail navigation) from also
              // firing when opening this menu.
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => router.push(`/classes/${row.original.id}`)}
            >
              <Eye className="mr-2 h-4 w-4" />
              View
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => router.push(`/classes/${row.original.id}/edit`)}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setDeleteId(row.original.id)}
              className="text-red-600"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <MainLayout
      allowedRoles={["SUPER_ADMIN", "UNIT_ADMIN", "TEACHER", "STUDENT"]}
    >
      <div className="space-y-6">
        <PageHeader
          title="Classes"
          description="Manage classes and enrollments"
          action={
            ["SUPER_ADMIN", "UNIT_ADMIN"].includes(getEffectiveRole(user) || "")
              ? { label: "Add Class", href: "/classes/new" }
              : undefined
          }
        />

        {/* Filters */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="w-full md:w-80">
            <SearchInput
              placeholder="Search by class name..."
              value={search}
              onChange={setSearch}
            />
          </div>
          <Select value={gradeFilter} onValueChange={setGradeFilter}>
            <SelectTrigger className="w-full md:w-36">
              <SelectValue placeholder="All Grades" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Grades</SelectItem>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((grade) => (
                <SelectItem key={grade} value={String(grade)}>
                  Grade {grade}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {getEffectiveRole(user) === "SUPER_ADMIN" && (
            <Select value={unitFilter} onValueChange={setUnitFilter}>
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
          data={data?.data || []}
          isLoading={isLoading}
          onRowClick={(row) => router.push(`/classes/${row.id}`)}
          pagination={{
            page,
            totalPages: data?.meta?.totalPages || 1,
            pageSize,
            total: data?.meta?.total || 0,
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
          title="Delete Class"
          description="Are you sure you want to delete this class? All enrollments will also be removed."
          confirmLabel="Delete"
          onConfirm={handleDelete}
          isLoading={deleteMutation.isPending}
          variant="destructive"
        />
      </div>
    </MainLayout>
  );
}
