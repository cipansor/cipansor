"use client";
import { useParams, useRouter } from "next/navigation";
import { safeFormat } from "@/lib/date";
import { useState } from "react";
import { MainLayout } from "@/components/layout";
import { PageHeader, ConfirmDialog, DataTable } from "@/components/shared";
import {
  useClass,
  useClassEnrollments,
  useUnenrollStudent,
} from "@/hooks/use-classes";
import { ClassEnrollment } from "@cipansor/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type ColumnDef } from "@/components/shared";

import {
  ArrowLeft,
  Pencil,
  Users,
  Calendar,
  Building2,
  User,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

export default function ClassDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: classData, isLoading } = useClass(params.id as string);
  const { data: enrollments, isLoading: enrollmentsLoading } =
    useClassEnrollments(params.id as string);
  const unenrollMutation = useUnenrollStudent();
  const [unenrollId, setUnenrollId] = useState<string | null>(null);

  const handleUnenroll = async () => {
    if (!unenrollId) return;
    try {
      await unenrollMutation.mutateAsync({
        classId: params.id as string,
        studentId: unenrollId,
      });
      toast.success("Student unenrolled successfully");
      setUnenrollId(null);
    } catch {
      toast.error("Failed to unenroll student");
    }
  };

  const enrollmentColumns: ColumnDef<ClassEnrollment>[] = [
    {
      accessorKey: "student.nis",
      header: "NIS",
      cell: ({ row }) => (
        <span className="font-mono text-sm">
          {row.original.student?.nis || "-"}
        </span>
      ),
    },
    {
      accessorKey: "student.user.name",
      header: "Name",
      cell: ({ row }) => (
        <div>
          <p className="font-medium">
            {row.original.student?.user?.name || row.original.student?.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {row.original.student?.gender === "MALE"
              ? "Laki-laki"
              : row.original.student?.gender === "FEMALE"
                ? "Perempuan"
                : "-"}
          </p>
        </div>
      ),
    },
    {
      accessorKey: "enrolledAt",
      header: "Enrolled At",
      cell: ({ row }) => (
        <span className="text-sm">
          {safeFormat(new Date(row.original.enrolledAt), "dd MMM yyyy")}
        </span>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          className="text-red-600"
          onClick={() => setUnenrollId(row.original.studentId)}
        >
          <Trash2 className="mr-1 h-4 w-4" />
          Remove
        </Button>
      ),
    },
  ];

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </MainLayout>
    );
  }

  if (!classData) {
    return (
      <MainLayout>
        <div className="flex h-64 flex-col items-center justify-center gap-4">
          <p className="text-muted-foreground">Class not found</p>
          <Button variant="outline" onClick={() => router.push("/classes")}>
            Back to Classes
          </Button>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout
      allowedRoles={["SUPER_ADMIN", "UNIT_ADMIN", "TEACHER", "STUDENT"]}
    >
      <div className="space-y-6">
        <PageHeader
          title={classData.name}
          description={`Grade ${classData.grade}`}
        >
          <Button variant="outline" asChild>
            <Link href="/classes">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Link>
          </Button>
          <Button asChild>
            <Link href={`/classes/${classData.id}/edit`}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Link>
          </Button>
        </PageHeader>

        {/* Status Banner */}
        <div className="flex items-center gap-4">
          <Badge variant="outline">Grade {classData.grade}</Badge>
          {classData.academicYear?.isActive && (
            <Badge className="bg-green-100 text-green-800">Active Year</Badge>
          )}
          <Badge variant="secondary">
            <Users className="mr-1 h-3 w-3" />
            {enrollments?.length || 0} Students
          </Badge>
        </div>

        <Tabs defaultValue="info" className="space-y-4">
          <TabsList>
            <TabsTrigger value="info">Information</TabsTrigger>
            <TabsTrigger value="students">Students</TabsTrigger>
            <TabsTrigger value="schedule">Schedule</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    Academic Year
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <InfoRow
                    label="Year"
                    value={classData.academicYear?.name || "-"}
                  />
                  <InfoRow
                    label="Status"
                    value={
                      classData.academicYear?.isActive ? "Active" : "Inactive"
                    }
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    Unit
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <InfoRow
                    label="Unit Name"
                    value={classData.unit?.name || "-"}
                  />
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="h-5 w-5" />
                    Homeroom Teacher
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">
                    {classData.homeroomTeacher?.user.name ||
                      "No homeroom teacher assigned"}
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="students">
            <Card>
              <CardHeader>
                <CardTitle>Enrolled Students</CardTitle>
                <CardDescription>
                  Students currently enrolled in this class
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DataTable
                  columns={enrollmentColumns}
                  data={enrollments || []}
                  isLoading={enrollmentsLoading}
                  onRowClick={(row) =>
                    router.push(`/students/${row.studentId}`)
                  }
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="schedule">
            <Card>
              <CardHeader>
                <CardTitle>Class Schedule</CardTitle>
                <CardDescription>Weekly class schedule</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Schedule will be displayed here...
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Unenroll Confirmation */}
        <ConfirmDialog
          open={!!unenrollId}
          onOpenChange={(open) => !open && setUnenrollId(null)}
          title="Remove Student"
          description="Are you sure you want to remove this student from the class?"
          confirmLabel="Remove"
          onConfirm={handleUnenroll}
          isLoading={unenrollMutation.isPending}
          variant="destructive"
        />
      </div>
    </MainLayout>
  );
}

interface InfoRowProps {
  label: string;
  value: string;
}

function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="flex items-start justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
