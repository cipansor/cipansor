"use client";
import { useEffect, useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { safeFormat } from "@/lib/date";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useUnits } from "@/hooks/use-units";
import { useActiveAcademicYear } from "@/hooks/use-academic-years";
import { useQualityAudits } from "@/hooks/use-quality";
import { CreateAuditDialog } from "@/components/quality/create-audit-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calendar, FileCheck, User } from "lucide-react";
import Link from "next/link";

import { id as idLocale } from "date-fns/locale";

export default function QualityAuditsPage() {
  const { user } = useAuth();
  const { data: activeAcademicYear } = useActiveAcademicYear();

  // SPMI is measured per unit and the yayasan board belongs to none, so
  // `user.unitId` is null for exactly the roles that oversee every unit — the
  // same trap the SPMI dashboard above already works around. Foundation users
  // pick a unit; unit users stay pinned to their own.
  const { data: units } = useUnits();
  const isFoundationUser = !user?.unitId;
  const [selectedUnitId, setSelectedUnitId] = useState<string>("");

  useEffect(() => {
    if (isFoundationUser && !selectedUnitId && units?.length) {
      setSelectedUnitId(units[0].id);
    }
  }, [isFoundationUser, selectedUnitId, units]);

  const unitId = user?.unitId ?? selectedUnitId;

  const { data: audits, isLoading } = useQualityAudits(
    unitId || "",
    activeAcademicYear?.id || "",
  );

  if (isFoundationUser && !unitId) {
    return (
      <MainLayout>
        <div className="p-8 text-center">
          <h2 className="text-2xl font-bold">Belum ada unit</h2>
          <p className="text-muted-foreground">
            Tambahkan unit pendidikan terlebih dahulu untuk melihat audit mutu.
          </p>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6 p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/quality">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                Audit Mutu Internal (AMI)
              </h1>
              <p className="text-muted-foreground">
                Jadwal dan pelaksanaan audit internal penjaminan mutu.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isFoundationUser && (
              <Select value={selectedUnitId} onValueChange={setSelectedUnitId}>
                <SelectTrigger
                  className="w-full md:w-56"
                  aria-label="Pilih unit"
                >
                  <SelectValue placeholder="Pilih unit" />
                </SelectTrigger>
                <SelectContent>
                  {(units ?? []).map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {unit.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {activeAcademicYear && (
              <CreateAuditDialog
                unitId={unitId}
                academicYearId={activeAcademicYear.id}
              />
            )}
          </div>
        </div>

        {isLoading ? (
          <div>Loading...</div>
        ) : audits && audits.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {audits.map((audit: any) => (
              <Card key={audit.id} className="flex flex-col">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg">{audit.name}</CardTitle>
                      <CardDescription>{audit.code}</CardDescription>
                    </div>
                    <Badge
                      variant={
                        audit.status === "COMPLETED" ? "default" : "outline"
                      }
                    >
                      {audit.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span>
                      {safeFormat(new Date(audit.startDate), "dd MMM yyyy", {
                        locale: idLocale,
                      })}{" "}
                      -{" "}
                      {safeFormat(new Date(audit.endDate), "dd MMM yyyy", {
                        locale: idLocale,
                      })}
                    </span>
                  </div>

                  {audit.leadAuditor && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <User className="h-4 w-4" />
                      <span>Lead: {audit.leadAuditor.name}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <FileCheck className="h-4 w-4" />
                    <span>{audit._count?.items || 0} Indikator Penilaian</span>
                  </div>

                  <div className="pt-4 mt-auto">
                    <Link
                      href={`/quality/audits/${audit.id}`}
                      className="w-full"
                    >
                      <Button className="w-full">Buka Lembar Audit</Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 border rounded-lg bg-muted/10 text-center">
            <FileCheck className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">Belum ada jadwal audit</h3>
            <p className="text-muted-foreground max-w-sm mt-2">
              Buat jadwal audit baru untuk memulai proses Audit Mutu Internal
              (AMI).
            </p>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
