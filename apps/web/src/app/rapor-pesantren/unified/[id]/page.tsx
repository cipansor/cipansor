"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import api, { ApiResponse } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Printer, CalendarDays, BookOpen, Star, FileText } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// The unified rapor consumes the real aggregator output of
// GET /rapor-pesantren/:id. Its per-domain summaries are intentionally sparse
// (only the fields the aggregator computes are present; unavailable domains
// come back null), so this view models exactly that contract.
interface UnifiedRapor {
  id: string;
  semester: number;
  status: "DRAFT" | "FINAL" | "PUBLISHED";
  overallScore: number | null;
  overallGrade: string | null;
  academicYear?: { name: string } | null;
  student?: {
    name: string;
    nis: string;
    class?: { name: string } | null;
    dormRoom?: { name: string } | null;
  } | null;
  tahfidz?: {
    tahfidzScore?: number | null;
    tahfidzGrade?: string | null;
    recentSurahs?: string[] | null;
  } | null;
  takhosus?: {
    takhosusName?: string | null;
    attendanceRate?: number | null;
  } | null;
  ibadah?: {
    sholatFardhuPercentage?: number | null;
    sholatRawatibCount?: number | null;
  } | null;
  muhadhoroh?: {
    speechGrade?: string | null;
    speechSkillScore?: number | null;
  } | null;
  kitabProgress?: {
    kitabName?: string | null;
    completionRate?: number | null;
  } | null;
  akhlak?: {
    totalViolations?: number | null;
    totalRewards?: number | null;
  } | null;
  headTeacherNotes?: string | null;
  musyrifNotes?: string | null;
  principalNotes?: string | null;
  notes?: string | null;
}

function UnifiedRaporPageContent() {
  const params = useParams();
  const raporId = params.id as string;

  const {
    data: rapor,
    isLoading: loading,
    error,
  } = useQuery({
    queryKey: ["rapor-pesantren", "unified", raporId],
    queryFn: async () => {
      const res = await api.get<ApiResponse<UnifiedRapor>>(
        `/rapor-pesantren/${raporId}`,
      );
      return res.data.data;
    },
    enabled: !!raporId,
  });

  if (loading)
    return (
      <div className="p-8 text-center text-gray-500 animate-pulse">
        Memuat Unified Rapor Pesantren...
      </div>
    );
  if (error)
    return (
      <Alert variant="destructive" className="m-8 w-auto">
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
          Gagal mengambil data Rapor Pesantren
        </AlertDescription>
      </Alert>
    );
  if (!rapor)
    return (
      <div className="p-8 text-center text-gray-500">Rapor tidak ditemukan</div>
    );

  const fmt = (v?: number | null, digits = 1) =>
    v === null || v === undefined ? "-" : v.toFixed(digits);

  return (
    <div className="container mx-auto p-4 max-w-5xl space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
            Rapor Pesantren Terpadu
          </h1>
          <p className="text-gray-500 mt-1 flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> Periode Akademik{" "}
            {rapor.academicYear?.name} - Semester {rapor.semester}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {rapor.status === "PUBLISHED" ? (
            <Badge variant="default" className="bg-green-600">
              Dipublikasikan
            </Badge>
          ) : (
            <Badge variant="secondary">Draft</Badge>
          )}
          <Button
            onClick={() => window.print()}
            variant="outline"
            className="print:hidden"
          >
            <Printer className="h-4 w-4 mr-2" /> Cetak Rapor
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-1 shadow-sm border-gray-100">
          <CardHeader className="bg-gray-50/50 pb-4 border-b">
            <CardTitle className="text-lg">Data Santri</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div className="text-center">
              <div className="w-24 h-24 mx-auto bg-gray-200 rounded-full mb-3 flex items-center justify-center text-gray-400">
                <span className="text-3xl font-semibold">
                  {rapor.student?.name?.[0]}
                </span>
              </div>
              <h2 className="text-xl font-bold">{rapor.student?.name}</h2>
              <p className="text-sm text-gray-500">NIS: {rapor.student?.nis}</p>
            </div>

            <div className="space-y-2 text-sm pt-2 border-t text-gray-600">
              <div className="flex justify-between">
                <span>Kelas:</span>{" "}
                <span className="font-medium text-gray-900">
                  {rapor.student?.class?.name || "-"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Asrama:</span>{" "}
                <span className="font-medium text-gray-900">
                  {rapor.student?.dormRoom?.name || "-"}
                </span>
              </div>
              <div className="flex justify-between mt-4">
                <span className="font-bold text-gray-800">Nilai Akhir:</span>
                <span className="font-bold text-blue-600 text-lg">
                  {fmt(rapor.overallScore, 2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold text-gray-800">Predikat:</span>
                <Badge variant="default" className="text-xs">
                  {rapor.overallGrade || "-"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="md:col-span-2 space-y-6">
          <Card className="shadow-sm border-gray-100">
            <CardHeader className="bg-blue-50/50 pb-4 border-b border-blue-100 text-blue-900">
              <CardTitle className="flex items-center gap-2 text-lg">
                <BookOpen className="h-5 w-5 text-blue-600" /> Capaian
                Kepesantrenan &amp; Akademik
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-gray-100">
                {/* Tahfidz Section */}
                <div className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold text-gray-800">
                      Tahfidz Al-Quran
                    </h3>
                    <div className="text-right">
                      <span className="block font-bold text-lg text-blue-600">
                        {fmt(rapor.tahfidz?.tahfidzScore)}
                      </span>
                      <Badge variant="outline">
                        {rapor.tahfidz?.tahfidzGrade || "-"}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-sm text-gray-600 mt-2">
                    Capaian Terakhir:{" "}
                    <span className="font-medium text-gray-900">
                      {rapor.tahfidz?.recentSurahs?.length
                        ? rapor.tahfidz.recentSurahs.join(", ")
                        : "Belum ada setoran"}
                    </span>
                  </div>
                </div>

                {/* Takhosus Section */}
                <div className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold text-gray-800">
                      Program Takhosus
                    </h3>
                    <div className="text-right">
                      <span className="block font-bold text-lg text-blue-600">
                        {fmt(rapor.takhosus?.attendanceRate)}%
                      </span>
                      <Badge variant="outline">Kehadiran</Badge>
                    </div>
                  </div>
                  {rapor.takhosus?.takhosusName ? (
                    <div className="text-sm text-gray-600 mt-2">
                      Program:{" "}
                      <span className="font-medium text-gray-900">
                        {rapor.takhosus.takhosusName}
                      </span>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-400 mt-2 italic">
                      Tidak Mengikuti Takhosus
                    </div>
                  )}
                </div>

                {/* Kitab Kuning Section */}
                <div className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold text-gray-800">
                      Kajian Kitab Kuning
                    </h3>
                    <div className="text-right">
                      <span className="block font-bold text-lg text-blue-600">
                        {fmt(rapor.kitabProgress?.completionRate)}%
                      </span>
                      <Badge variant="outline">Progres</Badge>
                    </div>
                  </div>
                  <div className="text-sm text-gray-600 mt-2">
                    {rapor.kitabProgress?.kitabName ? (
                      <>
                        Kitab:{" "}
                        <span className="font-medium text-gray-900">
                          {rapor.kitabProgress.kitabName}
                        </span>
                      </>
                    ) : (
                      <span className="text-gray-400 italic">
                        Belum ada kajian kitab
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-gray-100">
            <CardHeader className="bg-amber-50/50 pb-4 border-b border-amber-100 text-amber-900">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Star className="h-5 w-5 text-amber-500" /> Ibadah &amp;
                Karakter (Akhlak)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-gray-100">
                {/* Ibadah */}
                <div className="p-4 hover:bg-gray-50 transition-colors flex justify-between items-center">
                  <div>
                    <h3 className="font-semibold text-gray-800 mb-1">
                      Capaian Ibadah Yaumiyyah
                    </h3>
                    <p className="text-sm text-gray-500">
                      Sholat Rawatib: {rapor.ibadah?.sholatRawatibCount ?? 0}{" "}
                      kali
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="block font-bold text-lg text-amber-600">
                      {fmt(rapor.ibadah?.sholatFardhuPercentage)}%
                    </span>
                    <Badge variant="outline">Sholat Fardhu</Badge>
                  </div>
                </div>

                {/* Akhlak */}
                <div className="p-4 hover:bg-gray-50 transition-colors flex justify-between items-center">
                  <div>
                    <h3 className="font-semibold text-gray-800 mb-1">
                      Akhlak &amp; Kedisiplinan
                    </h3>
                    <p className="text-sm text-gray-500">
                      Pelanggaran:{" "}
                      <span className="text-red-500 font-medium">
                        {rapor.akhlak?.totalViolations ?? 0}
                      </span>{" "}
                      | Prestasi:{" "}
                      <span className="text-green-600 font-medium">
                        {rapor.akhlak?.totalRewards ?? 0}
                      </span>
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="block font-bold text-lg text-amber-600">
                      {fmt(rapor.muhadhoroh?.speechSkillScore)}
                    </span>
                    <Badge variant="outline">Muhadhoroh</Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-gray-100 print-break-inside-avoid">
            <CardHeader className="bg-gray-50/50 pb-4 border-b">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5 text-gray-600" /> Catatan Musyrif
                &amp; Mudir
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              {rapor.musyrifNotes && (
                <div className="bg-gray-50 p-3 rounded-md border border-gray-100">
                  <h4 className="font-bold text-sm text-gray-700 mb-1">
                    Catatan Musyrif Asrama
                  </h4>
                  <p className="text-sm text-gray-600 italic whitespace-pre-wrap">
                    &ldquo;{rapor.musyrifNotes}&rdquo;
                  </p>
                </div>
              )}
              {rapor.headTeacherNotes && (
                <div className="bg-blue-50 p-3 rounded-md border border-blue-100">
                  <h4 className="font-bold text-sm text-blue-800 mb-1">
                    Catatan Wali Kelas
                  </h4>
                  <p className="text-sm text-blue-900 italic whitespace-pre-wrap">
                    &ldquo;{rapor.headTeacherNotes}&rdquo;
                  </p>
                </div>
              )}
              {rapor.principalNotes && (
                <div className="bg-emerald-50 p-3 rounded-md border border-emerald-100">
                  <h4 className="font-bold text-sm text-emerald-800 mb-1">
                    Catatan Mudir
                  </h4>
                  <p className="text-sm text-emerald-900 italic whitespace-pre-wrap">
                    &ldquo;{rapor.principalNotes}&rdquo;
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Print Footer */}
      <div className="hidden print:block mt-12 pt-8 border-t border-gray-300">
        <div className="flex justify-between px-12 text-sm">
          <div className="text-center">
            <p className="mb-16">
              Mengetahui,
              <br />
              Wali Santri
            </p>
            <p className="border-t border-gray-800 pt-1 w-40">
              (...................................)
            </p>
          </div>
          <div className="text-center">
            <p className="mb-16">
              Mudirul Ma&apos;had,
              <br />
              Pondok Pesantren Cipansor
            </p>
            <p className="border-t border-gray-800 pt-1 w-48 font-bold">
              Kyai Pimpinan
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function UnifiedRaporPage() {
  return (
    <main id="main-content">
      <UnifiedRaporPageContent />
    </main>
  );
}
