"use client";
import { MainLayout } from "@/components/layout";

import { useStudentOrgs } from "@/hooks/student-org/use-student-org";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { Users } from "lucide-react";
import Link from "next/link";

/**
 * The `/student-org` endpoint returns each org with its positions and the
 * members of each; the shared `StudentOrg` DTO does not model that nesting,
 * so the shape is stated here rather than reached through `any`.
 */
type OrgPosition = {
  id: string;
  name: string;
  members: { id: string; student: { user: { name: string } } }[];
};

function StudentOrgPageContent() {
  const { data: orgs, isLoading } = useStudentOrgs();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Student Governance</h1>
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      ) : !orgs?.length ? (
        <EmptyState
          icon={Users}
          title="Belum ada organisasi mahasiswa"
          description="Organisasi mahasiswa beserta kepengurusannya akan tampil di sini."
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {orgs.map((org) => (
            <Card key={org.id}>
              <CardHeader>
                <CardTitle>{org.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  {org.description}
                </p>
                <h4 className="font-semibold mb-2 text-sm">
                  Positions & Members:
                </h4>
                <div className="space-y-2">
                  {(org.positions as OrgPosition[]).map((pos) => (
                    <div key={pos.id} className="text-sm border-l-2 pl-2">
                      <span className="font-medium">{pos.name}:</span>
                      <ul className="list-disc list-inside ml-2">
                        {pos.members.map((m) => (
                          <li key={m.id}>
                            <Link
                              href={`/student-org/members/${m.id}`}
                              className="text-primary hover:underline"
                            >
                              {m.student.user.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StudentOrgPageWithShell() {
  return (
    <MainLayout>
      <StudentOrgPageContent />
    </MainLayout>
  );
}
