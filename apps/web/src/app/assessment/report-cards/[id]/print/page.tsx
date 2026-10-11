"use client";
import { useParams, useRouter } from "next/navigation";
import { safeFormat } from "@/lib/date";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useReportCard } from "@/hooks";
import { ArrowLeft, Printer, Loader2, AlertCircle } from "lucide-react";

import { id as idLocale } from "date-fns/locale";

export default function PrintReportCardPage() {
  const params = useParams();
  const router = useRouter();
  const reportCardId = params.id as string;

  const { data: reportCard, isLoading } = useReportCard(reportCardId);

  const handlePrint = () => {
    window.print();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!reportCard) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen space-y-4">
        <AlertCircle className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Rapor tidak ditemukan</p>
        <Button onClick={() => router.push("/assessment/report-cards")}>
          Kembali ke Daftar
        </Button>
      </div>
    );
  }

  const getGradeLetter = (score: number): string => {
    if (score >= 90) return "A";
    if (score >= 80) return "B";
    if (score >= 70) return "C";
    if (score >= 60) return "D";
    return "E";
  };

  const getGradeDescription = (score: number): string => {
    if (score >= 90) return "Sangat Baik";
    if (score >= 80) return "Baik";
    if (score >= 70) return "Cukup";
    if (score >= 60) return "Kurang";
    return "Sangat Kurang";
  };

  return (
    <main id="main-content">
      {/* Print Controls - Hidden in print */}
      <div className="print:hidden fixed top-0 left-0 right-0 bg-background border-b p-4 z-50">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="font-bold">Preview Cetak Rapor</h1>
              <p className="text-sm text-muted-foreground">
                {reportCard.student?.user?.name || "-"}
              </p>
            </div>
          </div>
          <Button onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Cetak
          </Button>
        </div>
      </div>

      {/* Printable Content */}
      <div className="max-w-4xl mx-auto p-8 print:p-0 print:mt-0 mt-20">
        <div className="bg-white p-8 print:p-4 print:shadow-none shadow-lg rounded-lg print:rounded-none">
          {/* Header */}
          <div className="text-center border-b-2 border-black pb-4 mb-6">
            <h1 className="text-2xl font-bold uppercase tracking-wider">
              Laporan Hasil Belajar Peserta Didik
            </h1>
            <h2 className="text-xl font-semibold mt-2">
              Pondok Pesantren / Madrasah
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Semester {reportCard.semester} Tahun Ajaran{" "}
              {reportCard.academicYear?.name}
            </p>
          </div>

          {/* Student Info */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="space-y-2">
              <div className="flex">
                <span className="w-32 text-sm">Nama</span>
                <span className="text-sm">
                  : <strong>{reportCard.student?.user?.name || "-"}</strong>
                </span>
              </div>
              <div className="flex">
                <span className="w-32 text-sm">NIS</span>
                <span className="text-sm">: {reportCard.student?.nis}</span>
              </div>
              <div className="flex">
                <span className="w-32 text-sm">NISN</span>
                <span className="text-sm">
                  : {reportCard.student?.nisn ?? "-"}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex">
                <span className="w-32 text-sm">Kelas</span>
                <span className="text-sm">: {reportCard.class?.name}</span>
              </div>
              <div className="flex">
                <span className="w-32 text-sm">Semester</span>
                <span className="text-sm">: {reportCard.semester}</span>
              </div>
              <div className="flex">
                <span className="w-32 text-sm">Tahun Ajaran</span>
                <span className="text-sm">
                  : {reportCard.academicYear?.name}
                </span>
              </div>
            </div>
          </div>

          {/* Grades Table */}
          <div className="mb-6">
            <h3 className="font-bold text-sm mb-2 uppercase">
              A. Nilai Akademik
            </h3>
            <table className="w-full border-collapse border border-black text-sm">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-black p-2 w-10">No</th>
                  <th className="border border-black p-2 text-left">
                    Mata Pelajaran
                  </th>
                  <th className="border border-black p-2 w-20">KKM</th>
                  <th className="border border-black p-2 w-20">Pengetahuan</th>
                  <th className="border border-black p-2 w-20">Keterampilan</th>
                  <th className="border border-black p-2 w-20">Rata-rata</th>
                  <th className="border border-black p-2 w-16">Predikat</th>
                </tr>
              </thead>
              <tbody>
                {reportCard.subjects?.map((subject, index) => (
                  <tr key={subject.id ?? index}>
                    <td className="border border-black p-2 text-center">
                      {index + 1}
                    </td>
                    <td className="border border-black p-2">
                      {subject.subject?.name ?? subject.subjectName}
                    </td>
                    <td className="border border-black p-2 text-center">70</td>
                    <td className="border border-black p-2 text-center">
                      {(subject.knowledgeScore ?? 0).toFixed(0)}
                    </td>
                    <td className="border border-black p-2 text-center">
                      {(subject.skillScore ?? 0).toFixed(0)}
                    </td>
                    <td className="border border-black p-2 text-center font-semibold">
                      {subject.finalScore?.toFixed(0) ?? "-"}
                    </td>
                    <td className="border border-black p-2 text-center font-bold">
                      {getGradeLetter(subject.finalScore ?? 0)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-gray-100 font-bold">
                  <td
                    colSpan={5}
                    className="border border-black p-2 text-right"
                  >
                    Rata-rata
                  </td>
                  <td className="border border-black p-2 text-center">
                    {reportCard.averageScore?.toFixed(1) ?? "-"}
                  </td>
                  <td className="border border-black p-2 text-center">
                    {getGradeLetter(reportCard.averageScore ?? 0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Grade Legend */}
          <div className="mb-6 text-xs">
            <h4 className="font-semibold mb-1">Keterangan Predikat:</h4>
            <p>
              A = Sangat Baik (90-100) | B = Baik (80-89) | C = Cukup (70-79) |
              D = Kurang (60-69) | E = Sangat Kurang (&lt;60)
            </p>
          </div>

          {/* Attendance */}
          {reportCard.attendance && (
            <div className="mb-6">
              <h3 className="font-bold text-sm mb-2 uppercase">
                B. Ketidakhadiran
              </h3>
              <table className="border-collapse border border-black text-sm">
                <tbody>
                  <tr>
                    <td className="border border-black p-2 w-24">Sakit</td>
                    <td className="border border-black p-2 w-20 text-center">
                      {reportCard.attendance.sick} hari
                    </td>
                    <td className="border border-black p-2 w-24">Izin</td>
                    <td className="border border-black p-2 w-20 text-center">
                      {reportCard.attendance.permitted} hari
                    </td>
                    <td className="border border-black p-2 w-24">
                      Tanpa Keterangan
                    </td>
                    <td className="border border-black p-2 w-20 text-center">
                      {reportCard.attendance.absent} hari
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Summary */}
          <div className="mb-6">
            <h3 className="font-bold text-sm mb-2 uppercase">C. Prestasi</h3>
            <table className="border-collapse border border-black text-sm w-full">
              <tbody>
                <tr>
                  <td className="border border-black p-2 w-40">
                    Peringkat Kelas
                  </td>
                  <td className="border border-black p-2 font-semibold">
                    {reportCard.rank ?? "-"} dari{" "}
                    {reportCard.totalStudents ?? "-"} siswa
                  </td>
                </tr>
                <tr>
                  <td className="border border-black p-2">Nilai Rata-rata</td>
                  <td className="border border-black p-2 font-semibold">
                    {reportCard.averageScore?.toFixed(2) ?? "-"} (
                    {getGradeDescription(reportCard.averageScore ?? 0)})
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Teacher Notes */}
          <div className="mb-8">
            <h3 className="font-bold text-sm mb-2 uppercase">
              D. Catatan Wali Kelas
            </h3>
            <div className="border border-black p-3 min-h-[60px] text-sm">
              {reportCard.teacherNotes ||
                "Terus tingkatkan prestasi dan pertahankan semangat belajar."}
            </div>
          </div>

          {/* Signatures */}
          <div className="grid grid-cols-3 gap-4 text-center text-sm mt-8">
            <div>
              <p>Orang Tua/Wali</p>
              <div className="h-20"></div>
              <p className="border-t border-black pt-1">
                (.............................)
              </p>
            </div>
            <div>
              <p>Wali Kelas</p>
              <div className="h-20"></div>
              <p className="border-t border-black pt-1">
                {reportCard.class?.teacher?.name ??
                  "(.............................)"}
              </p>
            </div>
            <div>
              <p>Kepala Madrasah</p>
              <div className="h-20"></div>
              <p className="border-t border-black pt-1">
                (.............................)
              </p>
            </div>
          </div>

          {/* Print Date */}
          <div className="text-right text-sm mt-8">
            <p>
              Dicetak:{" "}
              {safeFormat(new Date(), "d MMMM yyyy", { locale: idLocale })}
            </p>
          </div>
        </div>
      </div>

      {/* Print Styles */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin: 1.5cm;
          }
          body {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .print\\:hidden {
            display: none !important;
          }
        }
      `}</style>
    </main>
  );
}
