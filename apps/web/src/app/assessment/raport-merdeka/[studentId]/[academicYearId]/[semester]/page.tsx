"use client";

import { use, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Loader2 } from "lucide-react";

interface RaportMerdekaPageParams {
  studentId: string;
  academicYearId: string;
  semester: string;
}

function RaportMerdekaPrintPageContent({
  params,
}: {
  params: RaportMerdekaPageParams;
}) {
  const { studentId, academicYearId, semester } = params;

  const {
    data: raport,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["raport-merdeka", studentId, academicYearId, semester],
    queryFn: async () => {
      const res = await api.get(
        `/assessment/raport-merdeka/students/${studentId}`,
        {
          params: { academicYearId, semester },
        },
      );
      return res.data.data;
    },
  });

  // Auto print when data loaded
  useEffect(() => {
    if (raport && !isLoading) {
      setTimeout(() => {
        window.print();
      }, 500);
    }
  }, [raport, isLoading]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Memuat Raport Merdeka...</span>
      </div>
    );
  }

  if (error || !raport) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-red-600">Gagal memuat data raport</p>
      </div>
    );
  }

  return (
    <div className="print-page bg-white text-black">
      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin: 1.5cm;
          }
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .no-print {
            display: none !important;
          }
          .page-break {
            page-break-before: always;
          }
        }
        .print-page {
          font-family: "Times New Roman", serif;
          font-size: 11pt;
          line-height: 1.4;
        }
        .border-cell {
          border: 1px solid #000;
          padding: 4px 8px;
        }
        .header-cell {
          background-color: #f3f4f6;
          font-weight: bold;
        }
      `}</style>

      {/* Header */}
      <div className="text-center border-b-2 border-black pb-4 mb-6">
        <div className="flex items-center justify-center gap-4">
          <div className="w-20 h-20 border border-gray-400 flex items-center justify-center text-xs text-gray-400">
            LOGO
          </div>
          <div>
            <h1 className="text-lg font-bold uppercase">{raport.siswa.unit}</h1>
            <h2 className="text-xl font-bold">
              LAPORAN HASIL BELAJAR PESERTA DIDIK
            </h2>
            <p className="text-sm">KURIKULUM MERDEKA</p>
            <p className="text-sm">
              Tahun Pelajaran {raport.tahunAjaran.tahun} Semester{" "}
              {raport.tahunAjaran.semesterLabel}
            </p>
          </div>
          <div className="w-20 h-20 border border-gray-400 flex items-center justify-center text-xs text-gray-400">
            LOGO
          </div>
        </div>
      </div>

      {/* Student Identity */}
      <div className="mb-6">
        <table className="w-full text-sm">
          <tbody>
            <tr>
              <td className="w-1/4">Nama Peserta Didik</td>
              <td className="w-1/4">
                : <strong>{raport.siswa.nama}</strong>
              </td>
              <td className="w-1/4">Kelas</td>
              <td className="w-1/4">
                : <strong>{raport.siswa.kelas}</strong>
              </td>
            </tr>
            <tr>
              <td>NIS</td>
              <td>: {raport.siswa.nis}</td>
              <td>Semester</td>
              <td>
                : {raport.tahunAjaran.semester} (
                {raport.tahunAjaran.semesterLabel})
              </td>
            </tr>
            <tr>
              <td>NISN</td>
              <td>: {raport.siswa.nisn}</td>
              <td>Tahun Pelajaran</td>
              <td>: {raport.tahunAjaran.tahun}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* A. Intrakurikuler - Kelompok Umum */}
      <div className="mb-6">
        <h3 className="font-bold text-sm mb-2">
          A. CAPAIAN KOMPETENSI MATA PELAJARAN
        </h3>

        <h4 className="font-semibold text-sm mb-2">Kelompok Umum</h4>
        <table className="w-full border-collapse mb-4">
          <thead>
            <tr>
              <th className="border-cell header-cell w-8">No</th>
              <th className="border-cell header-cell">Mata Pelajaran</th>
              <th className="border-cell header-cell w-16">Nilai</th>
              <th className="border-cell header-cell w-20">Predikat</th>
              <th className="border-cell header-cell">
                Deskripsi Capaian Kompetensi
              </th>
            </tr>
          </thead>
          <tbody>
            {raport.intrakurikuler.kelompokUmum.map(
              (subject: any, index: number) => (
                <tr key={subject.subjectCode}>
                  <td className="border-cell text-center">{index + 1}</td>
                  <td className="border-cell">{subject.subjectName}</td>
                  <td className="border-cell text-center font-semibold">
                    {subject.nilaiAkhir}
                  </td>
                  <td className="border-cell text-center">
                    {subject.predikat}
                  </td>
                  <td className="border-cell text-xs">{subject.deskripsi}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>

        {/* Kelompok Pesantren */}
        {raport.intrakurikuler.kelompokPesantren.length > 0 && (
          <>
            <h4 className="font-semibold text-sm mb-2">
              Kelompok Pesantren / Muatan Lokal
            </h4>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="border-cell header-cell w-8">No</th>
                  <th className="border-cell header-cell">Mata Pelajaran</th>
                  <th className="border-cell header-cell w-16">Nilai</th>
                  <th className="border-cell header-cell w-20">Predikat</th>
                  <th className="border-cell header-cell">
                    Deskripsi Capaian Kompetensi
                  </th>
                </tr>
              </thead>
              <tbody>
                {raport.intrakurikuler.kelompokPesantren.map(
                  (subject: any, index: number) => (
                    <tr key={subject.subjectCode}>
                      <td className="border-cell text-center">{index + 1}</td>
                      <td className="border-cell">{subject.subjectName}</td>
                      <td className="border-cell text-center font-semibold">
                        {subject.nilaiAkhir}
                      </td>
                      <td className="border-cell text-center">
                        {subject.predikat}
                      </td>
                      <td className="border-cell text-xs">
                        {subject.deskripsi}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* B. Projek P5 */}
      <div className="mb-6 page-break">
        <h3 className="font-bold text-sm mb-2">
          B. PROJEK PENGUATAN PROFIL PELAJAR PANCASILA (P5)
        </h3>

        {!raport.projekP5 || raport.projekP5.length === 0 ? (
          <p className="text-sm italic text-gray-600">
            Belum ada projek P5 pada semester ini.
          </p>
        ) : (
          raport.projekP5.map((projek: any, projekIndex: number) => (
            <div key={projekIndex} className="mb-4">
              <table className="w-full border-collapse mb-2">
                <tbody>
                  <tr>
                    <td className="border-cell header-cell w-1/4">
                      Tema Projek
                    </td>
                    <td className="border-cell">{projek.tema}</td>
                  </tr>
                  <tr>
                    <td className="border-cell header-cell">
                      Deskripsi Projek
                    </td>
                    <td className="border-cell">{projek.deskripsiProyek}</td>
                  </tr>
                </tbody>
              </table>

              <h4 className="font-semibold text-sm mb-2 mt-4">
                Capaian Dimensi P5:
              </h4>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="border-cell header-cell w-8">No</th>
                    <th className="border-cell header-cell w-1/4">Dimensi</th>
                    <th className="border-cell header-cell w-24">
                      Level Capaian
                    </th>
                    <th className="border-cell header-cell">Deskripsi</th>
                  </tr>
                </thead>
                <tbody>
                  {(projek.dimensiTerkait ?? []).map(
                    (dim: any, index: number) => (
                      <tr key={dim.dimensiCode ?? index}>
                        <td className="border-cell text-center">{index + 1}</td>
                        <td className="border-cell font-semibold">
                          {dim.dimensiName}
                        </td>
                        <td className="border-cell text-center text-xs">
                          {dim.capaian}
                        </td>
                        <td className="border-cell text-xs">{dim.deskripsi}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>

      {/* C. Ekstrakurikuler */}
      <div className="mb-6">
        <h3 className="font-bold text-sm mb-2">C. EKSTRAKURIKULER</h3>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="border-cell header-cell w-8">No</th>
              <th className="border-cell header-cell">
                Kegiatan Ekstrakurikuler
              </th>
              <th className="border-cell header-cell w-24">Predikat</th>
              <th className="border-cell header-cell">Keterangan</th>
            </tr>
          </thead>
          <tbody>
            {raport.ekstrakurikuler.length > 0 ? (
              raport.ekstrakurikuler.map((ekskul: any, index: number) => (
                <tr key={index}>
                  <td className="border-cell text-center">{index + 1}</td>
                  <td className="border-cell">{ekskul.nama}</td>
                  <td className="border-cell text-center">{ekskul.predikat}</td>
                  <td className="border-cell text-xs">{ekskul.keterangan}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="border-cell text-center">-</td>
                <td className="border-cell" colSpan={3}>
                  Tidak mengikuti kegiatan ekstrakurikuler
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* D. Tahfidz */}
      <div className="mb-6">
        <h3 className="font-bold text-sm mb-2">D. CAPAIAN TAHFIDZ AL-QUR'AN</h3>
        <table className="w-full border-collapse">
          <tbody>
            <tr>
              <td className="border-cell header-cell w-1/3">Total Juz</td>
              <td className="border-cell text-center font-semibold">
                {raport.tahfidz.totalJuz}
              </td>
            </tr>
            <tr>
              <td className="border-cell header-cell">Total Surah</td>
              <td className="border-cell text-center font-semibold">
                {raport.tahfidz.totalSurah}
              </td>
            </tr>
            <tr>
              <td className="border-cell header-cell">
                Total Ayat (Semester Ini)
              </td>
              <td className="border-cell text-center font-semibold">
                {raport.tahfidz.totalAyat}
              </td>
            </tr>
            <tr>
              <td className="border-cell header-cell">Surah Terakhir</td>
              <td className="border-cell text-center">
                {raport.tahfidz.surahTerakhir}
              </td>
            </tr>
            <tr>
              <td className="border-cell header-cell">Target Capaian</td>
              <td className="border-cell text-center">
                {raport.tahfidz.targetCapaian}
              </td>
            </tr>
            <tr>
              <td className="border-cell header-cell">Status</td>
              <td className="border-cell text-center font-semibold">
                {raport.tahfidz.statusCapaian}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs mt-1">
          <strong>Catatan:</strong> {raport.tahfidz.catatan}
        </p>
      </div>

      {/* E. Kehadiran */}
      <div className="mb-6">
        <h3 className="font-bold text-sm mb-2">E. KETIDAKHADIRAN</h3>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="border-cell header-cell">Sakit</th>
              <th className="border-cell header-cell">Izin</th>
              <th className="border-cell header-cell">Tanpa Keterangan</th>
              <th className="border-cell header-cell">Total Hari Efektif</th>
              <th className="border-cell header-cell">% Kehadiran</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border-cell text-center">
                {raport.kehadiran.sakit} hari
              </td>
              <td className="border-cell text-center">
                {raport.kehadiran.izin} hari
              </td>
              <td className="border-cell text-center">
                {raport.kehadiran.alpa} hari
              </td>
              <td className="border-cell text-center">
                {raport.kehadiran.total} hari
              </td>
              <td className="border-cell text-center font-semibold">
                {raport.kehadiran.persentaseKehadiran}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* F. Catatan */}
      <div className="mb-6">
        <h3 className="font-bold text-sm mb-2">F. CATATAN WALI KELAS</h3>
        <div className="border border-black p-3 min-h-16">
          <p>{raport.catatanWaliKelas || "-"}</p>
        </div>
      </div>

      {/* Signatures */}
      <div className="mt-8">
        <table className="w-full">
          <tbody>
            <tr>
              <td className="text-center w-1/3">
                <p>Mengetahui,</p>
                <p>Orang Tua/Wali</p>
                <div className="h-20"></div>
                <p>(_______________________)</p>
              </td>
              <td className="text-center w-1/3">
                <p>&nbsp;</p>
                <p>Wali Kelas</p>
                <div className="h-20"></div>
                <p className="font-semibold">{raport.waliKelas.nama}</p>
              </td>
              <td className="text-center w-1/3">
                <p>......, ........................... 20.....</p>
                <p>Kepala Sekolah</p>
                <div className="h-20"></div>
                <p>(_______________________)</p>
                <p className="text-xs">NIP. ................................</p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Footer - Keterangan Predikat */}
      <div className="mt-8 text-xs border-t pt-4">
        <p className="font-bold">Keterangan Predikat:</p>
        <table className="mt-1">
          <tbody>
            <tr>
              <td className="pr-4">A (91-100) = Sangat Baik</td>
              <td className="pr-4">B (76-90) = Baik</td>
              <td className="pr-4">C (61-75) = Cukup</td>
              <td>D (≤60) = Perlu Bimbingan</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Print Button */}
      <div className="no-print fixed bottom-4 right-4 flex gap-2">
        <button
          onClick={() => window.print()}
          className="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700"
        >
          Cetak Raport
        </button>
        <button
          onClick={() => window.history.back()}
          className="bg-gray-600 text-white px-4 py-2 rounded shadow hover:bg-gray-700"
        >
          Kembali
        </button>
      </div>
    </div>
  );
}

export default function RaportMerdekaPrintPage({
  params,
}: {
  params: Promise<RaportMerdekaPageParams>;
}) {
  const resolved = use(params);
  return (
    <main id="main-content">
      <RaportMerdekaPrintPageContent params={resolved} />
    </main>
  );
}
