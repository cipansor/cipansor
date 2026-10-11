"use client";

import { MainLayout } from "@/components/layout/main-layout";
import { useActiveAcademicYear } from "@/hooks/use-academic-years";
import { useAuth } from "@/hooks/use-auth";
import { useUnits } from "@/hooks/use-units";
import { useEffect, useState } from "react";
import {
  useStandardDetails,
  useDeleteEvidence,
  useQualityStandards,
} from "@/hooks/use-quality";
import { useParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Trash2,
  ArrowLeft,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";
import { EvidenceUploadDialog } from "@/components/quality/evidence-upload-dialog";
import { authFileUrl } from "@/lib/files";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function StandardDetailPage() {
  const params = useParams();
  const { user } = useAuth();
  const { data: activeAcademicYear } = useActiveAcademicYear();
  const standardId = params.id as string;

  // SPMI is measured per unit and the yayasan board belongs to none, so
  // `user.unitId` is null for exactly the roles that oversee every unit (the
  // same trap `/quality` and `/quality/audits` already work around). Foundation
  // users pick a unit; unit users stay pinned to their own.
  const { data: units } = useUnits();
  const isFoundationUser = !user?.unitId;
  const [selectedUnitId, setSelectedUnitId] = useState<string>("");

  useEffect(() => {
    if (isFoundationUser && !selectedUnitId && units?.length) {
      setSelectedUnitId(units[0].id);
    }
  }, [isFoundationUser, selectedUnitId, units]);

  const unitId = user?.unitId ?? selectedUnitId;
  const fullUnitId = unitId || "";

  const { data: standard, isLoading } = useStandardDetails(
    standardId,
    fullUnitId,
    activeAcademicYear?.id || "",
  );

  const deleteEvidence = useDeleteEvidence();

  if (isFoundationUser && !unitId)
    return (
      <MainLayout>
        <div className="p-8 text-center">
          <h2 className="text-2xl font-bold">Belum ada unit</h2>
          <p className="text-muted-foreground">
            Tambahkan unit pendidikan terlebih dahulu untuk melihat standar
            mutu.
          </p>
        </div>
      </MainLayout>
    );
  if (!fullUnitId || !activeAcademicYear?.id || isLoading)
    return (
      <MainLayout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </MainLayout>
    );
  if (!standard)
    return (
      <MainLayout>
        <div className="p-8 text-center">
          <p className="text-muted-foreground">Standar mutu tidak ditemukan</p>
          <Button asChild className="mt-4">
            <Link href="/quality">Kembali ke Daftar</Link>
          </Button>
        </div>
      </MainLayout>
    );

  return (
    <MainLayout>
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-4">
          <Link href="/quality">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {standard.name}
            </h1>
            <p className="text-muted-foreground">{standard.description}</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Indikator & Bukti Fisik</CardTitle>
            <CardDescription>
              Daftar indikator pemenuhan standar dan dokumen bukti yang telah
              diunggah.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="w-full">
              {standard.indicators.map((indicator) => {
                const hasEvidence =
                  indicator.evidences && indicator.evidences.length > 0;

                return (
                  <AccordionItem key={indicator.id} value={indicator.id}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center justify-between w-full pr-4 text-left">
                        <div className="flex items-center gap-3">
                          <Badge
                            variant={hasEvidence ? "default" : "outline"}
                            className={
                              hasEvidence
                                ? "bg-green-600 hover:bg-green-700"
                                : ""
                            }
                          >
                            {indicator.code}
                          </Badge>
                          <span className="text-sm font-medium">
                            {indicator.name}
                          </span>
                        </div>
                        {hasEvidence && (
                          <Badge variant="secondary" className="ml-auto">
                            {indicator.evidences?.length} Bukti
                          </Badge>
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pt-4 pb-4 px-1">
                      <div className="space-y-4">
                        <div className="flex justify-between items-center bg-muted/50 p-3 rounded-lg">
                          <p className="text-sm text-muted-foreground">
                            Target Skor: {indicator.targetScore}
                          </p>
                          <EvidenceUploadDialog
                            unitId={unitId}
                            indicatorId={indicator.id}
                          />
                        </div>

                        {indicator.evidences &&
                        indicator.evidences.length > 0 ? (
                          <div className="grid gap-2">
                            {indicator.evidences.map((evidence) => (
                              <div
                                key={evidence.id}
                                className="flex items-center justify-between border rounded-md p-3"
                              >
                                <div className="flex items-center gap-3 overflow-hidden">
                                  <FileText className="h-8 w-8 text-blue-500 shrink-0" />
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium truncate">
                                      {evidence.name}
                                    </p>
                                    <p className="text-xs text-muted-foreground truncate">
                                      {evidence.description}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                      Oleh: {evidence.uploadedBy?.name} •{" "}
                                      {new Date(
                                        evidence.createdAt,
                                      ).toLocaleDateString()}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button variant="ghost" size="icon" asChild>
                                    <a
                                      href={authFileUrl(evidence.fileUrl)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <ExternalLink className="h-4 w-4" />
                                    </a>
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                    onClick={() => {
                                      if (
                                        confirm(
                                          "Apakah Anda yakin ingin menghapus bukti ini?",
                                        )
                                      ) {
                                        deleteEvidence.mutate(evidence.id);
                                      }
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <Alert>
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>Belum ada bukti</AlertTitle>
                            <AlertDescription>
                              Silakan unggah dokumen bukti fisik untuk indikator
                              ini.
                            </AlertDescription>
                          </Alert>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
