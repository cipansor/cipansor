"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useVerifyPdfLetter } from "@/hooks/use-correspondence";
import {
  TurnstileWidget,
  useTurnstile,
} from "@/components/security/turnstile-widget";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  ShieldCheck,
  AlertTriangle,
  FileText,
  Calendar,
  User,
  Building,
  RefreshCw,
  Upload,
  Lock,
  FileUp,
} from "lucide-react";
import { safeFormat } from "@/lib/date";
import { id as localeId } from "date-fns/locale";
import {
  LETTER_AUTHORING_TRACK_LABELS,
  LetterAuthoringTrack,
  SIGNING_AUTHORITY_LABELS,
  SigningAuthorityForm,
  type PublicLetterVerificationResult,
} from "@cipansor/shared";

/** Status surat, dalam bahasa yang dibaca pengunjung dari luar. */
const LETTER_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Konsep",
  PENDING_REVIEW: "Menunggu verifikasi",
  REVISION_NEEDED: "Perlu revisi",
  READY_TO_SIGN: "Siap ditandatangani",
  SIGNED: "Telah ditandatangani",
  SENT: "Telah dikirim",
  DISPOSED: "Telah didisposisikan",
  ARCHIVED: "Diarsipkan",
};

function formatWibTimestamp(
  dateInput?: Date | string | null,
  includeSeconds = false,
) {
  if (!dateInput) return "-";
  try {
    const d = new Date(dateInput);
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      ...(includeSeconds ? { second: "2-digit" } : {}),
      hour12: false,
    }).format(d);
  } catch {
    return "-";
  }
}

function PublicVerifyContent() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<PublicLetterVerificationResult | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  /**
   * Turnstile menggantikan tantangan aritmetika yang dulu ada di sini.
   *
   * Yang lama menyertakan jawabannya di dalam tokennya sendiri —
   * `base64url(angka1:angka2:jawaban:kedaluwarsa)` — sehingga bot cukup
   * membaca token yang baru saja diterimanya. Yang menggantikannya harus
   * dijawab oleh Cloudflare, bukan oleh nilai yang kita kirim sendiri ke
   * peramban.
   */
  const turnstile = useTurnstile();

  const verifyPdfMutation = useVerifyPdfLetter();

  /**
   * Jalur penyusunan naskah, hanya bila jawabannya benar-benar datang.
   *
   * Sebuah nilai yang tidak dikenal tidak boleh menjadi kalimat jaminan:
   * `LETTER_AUTHORING_TRACK_LABELS[nilai-asing]` bernilai `undefined`, dan
   * membacanya di dalam JSX akan menjatuhkan seluruh halaman. Yang benar
   * adalah tidak menyatakan apa-apa — halaman ini boleh diam soal cara
   * penyusunan, tetapi tidak boleh menebaknya.
   */
  const authoringTrack =
    result?.letter?.authoringTrack &&
    result.letter.authoringTrack in LETTER_AUTHORING_TRACK_LABELS
      ? (result.letter.authoringTrack as LetterAuthoringTrack)
      : null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type !== "application/pdf") {
        setError("Format file harus berupa PDF.");
        setSelectedFile(null);
        return;
      }
      setSelectedFile(file);
      setError(null);
    }
  };

  const handleVerify = async () => {
    if (!selectedFile) {
      setError("Silakan pilih file PDF dokumen terlebih dahulu.");
      return;
    }

    if (!turnstile.ready) {
      // Dua sebab, dua saran. "Tunggu sesaat" hanya benar selama tantangannya
      // masih berjalan; ketika widget-nya menyerah, menunggu tidak mengubah
      // apa pun dan yang menolong ada di panel widget itu sendiri.
      setError(
        turnstile.blocked
          ? "Verifikasi keamanan tidak dapat dimuat. Ikuti petunjuk di kotak verifikasi di bawah."
          : "Verifikasi keamanan belum selesai. Tunggu sesaat, lalu coba lagi.",
      );
      return;
    }

    setError(null);
    setResult(null);

    try {
      const data = await verifyPdfMutation.mutateAsync({
        file: selectedFile,
        turnstileToken: turnstile.token,
      });
      setResult(data);
      turnstile.refresh();
    } catch (err: any) {
      turnstile.refresh();
      if (err?.response?.status === 429) {
        setError(
          "Terlalu banyak permintaan verifikasi. Silakan tunggu beberapa saat.",
        );
      } else {
        setError(
          err?.response?.data?.error?.message ||
            err?.response?.data?.message ||
            "Terjadi kesalahan saat memverifikasi dokumen PDF.",
        );
      }
    }
  };

  return (
    <main
      id="main-content"
      className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8"
    >
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 bg-blue-100 text-blue-700 rounded-full mb-2">
            <ShieldCheck className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            Verifikasi Tanda Tangan Elektronik (TTE)
          </h1>
          <p className="text-slate-600 text-sm">
            Portal Resmi Verifikasi Keabsahan Naskah Dinas & Surat Resmi Yayasan
            Pesantren Cipansor
          </p>
        </div>

        {/* Verification Form Card */}
        <Card className="shadow-md border-slate-200">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Upload className="h-5 w-5 text-blue-600" />
              Unggah File PDF Surat / Naskah Dinas
            </CardTitle>
            <CardDescription>
              Unggah berkas PDF dokumen resmi untuk memverifikasi keabsahan
              tanda tangan elektronik.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pdf-file">Berkas Dokumen PDF</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="pdf-file"
                  type="file"
                  accept="application/pdf"
                  onChange={handleFileChange}
                  className="bg-white cursor-pointer"
                />
              </div>
              {selectedFile && (
                <p className="text-xs text-slate-600 flex items-center gap-1 mt-1">
                  <FileUp className="h-3.5 w-3.5 text-blue-600" />
                  File terpilih:{" "}
                  <span className="font-semibold text-slate-800">
                    {selectedFile.name}
                  </span>{" "}
                  ({(selectedFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>

            {turnstile.required && (
              <div className="p-3 bg-slate-100 rounded-md border text-sm space-y-2">
                <div className="flex items-center gap-2 text-slate-700 font-medium">
                  <Lock className="h-4 w-4 text-blue-600" />
                  Verifikasi keamanan
                </div>
                <TurnstileWidget
                  action="verify-letter"
                  {...turnstile.widgetProps}
                />
              </div>
            )}

            <Button
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold"
              onClick={handleVerify}
              // `turnstile.ready` ikut di sini supaya halaman ini sejalan
              // dengan enam permukaan lainnya. Tanpa itu tombolnya satu-satunya
              // yang tetap terbuka ketika gerbangnya mati — penjaga di
              // `handleVerify` memang menahannya, tapi tombol yang bisa ditekan
              // dan selalu menolak adalah undangan untuk menekannya berulang.
              disabled={
                verifyPdfMutation.isPending || !selectedFile || !turnstile.ready
              }
            >
              {verifyPdfMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                  Memeriksa Keabsahan Dokumen...
                </>
              ) : (
                "Verifikasi Dokumen"
              )}
            </Button>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Verification Result Card */}
        {result && (
          <Card
            className={`shadow-lg border-2 ${
              result.isValid
                ? "border-green-500 bg-white"
                : result.isRevoked
                  ? "border-orange-500 bg-orange-50/20"
                  : "border-red-500 bg-red-50/20"
            }`}
          >
            <CardHeader className="pb-4 border-b">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl flex items-center gap-2">
                  {result.isValid ? (
                    <span className="text-green-700 flex items-center gap-2">
                      <ShieldCheck className="h-6 w-6 text-green-600" />
                      DOKUMEN SAH & TERVERIFIKASI
                    </span>
                  ) : result.isRevoked ? (
                    <span className="text-orange-700 flex items-center gap-2">
                      <AlertTriangle className="h-6 w-6 text-orange-600" />
                      NASKAH TELAH DICABUT
                    </span>
                  ) : (
                    <span className="text-red-700 flex items-center gap-2">
                      <AlertTriangle className="h-6 w-6 text-red-600" />
                      DOKUMEN TIDAK VALID
                    </span>
                  )}
                </CardTitle>
                <Badge
                  className={
                    result.isValid
                      ? "bg-green-100 text-green-800 hover:bg-green-100 text-sm py-1"
                      : result.isRevoked
                        ? "bg-orange-100 text-orange-800 hover:bg-orange-100 text-sm py-1"
                        : "bg-red-100 text-red-800 hover:bg-red-100 text-sm py-1"
                  }
                >
                  {result.isValid
                    ? "RESMI"
                    : result.isRevoked
                      ? "DICABUT"
                      : "INVALID"}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="pt-6 space-y-6">
              {result.isRevoked && (
                <div className="p-4 bg-orange-100 border border-orange-300 rounded-md text-orange-900 text-sm">
                  <p className="font-semibold flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Keterangan Pencabutan:
                  </p>
                  <p className="mt-1">
                    Surat ini telah resmi dicabut oleh penerbit/penandatangan
                    pada{" "}
                    <strong>
                      {result.revokedAt
                        ? `${formatWibTimestamp(result.revokedAt, true)} WIB`
                        : "tanggal yang ditentukan"}
                    </strong>
                    . Dokumen ini tidak lagi berlaku untuk keperluan
                    administratif.
                  </p>
                  {/* The reason is the whole point of asking for one. Without
                      it the page can only say "dicabut" and leave the reader
                      to guess whether the letter was wrong, superseded, or
                      issued to the wrong person — which is exactly what they
                      came here to find out. */}
                  {result.revokedReason && (
                    <p className="mt-3 border-t border-orange-300 pt-3">
                      <span className="block text-xs uppercase tracking-wider text-orange-700">
                        Alasan pencabutan
                        {result.revokedByName
                          ? ` · oleh ${result.revokedByName}`
                          : ""}
                      </span>
                      <span className="font-medium whitespace-pre-line">
                        {result.revokedReason}
                      </span>
                    </p>
                  )}

                  {/* Pencabutannya dibuktikan, bukan sekadar dipercaya: pencabut
                      menandatangani pernyataannya dengan kuncinya sendiri, sama
                      seperti CRL ditandatangani penerbitnya (RFC 5280). Yang
                      dibuktikan termasuk alasannya — teks di atas tidak dapat
                      disunting setelah ditandatangani tanpa membatalkannya. */}
                  {result.revocationVerified === true && (
                    <p className="mt-3 flex items-start gap-2 text-xs text-orange-800">
                      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        Pencabutan ini terverifikasi secara kriptografis:
                        dinyatakan oleh pejabat yang namanya tercantum, dengan
                        alasan persis seperti yang tertulis di atas.
                      </span>
                    </p>
                  )}
                </div>
              )}

              {result.letter && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <FileText className="h-4 w-4 text-blue-600" /> Detail Naskah
                    Dinas / Surat
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-slate-50 rounded-lg border text-sm">
                    <div>
                      <span className="text-xs text-slate-500 block">
                        Nomor Surat
                      </span>
                      <span className="font-bold text-slate-900">
                        {result.letter.letterNumber}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">
                        Unit Penerbit
                      </span>
                      <span className="font-medium text-slate-900 flex items-center gap-1">
                        <Building className="h-3.5 w-3.5 text-slate-400" />
                        {result.letter.unitName}
                      </span>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="text-xs text-slate-500 block">
                        Perihal
                      </span>
                      {result.letter.subject ? (
                        <span className="font-medium text-slate-900">
                          {result.letter.subject}
                        </span>
                      ) : (
                        <span className="font-medium text-slate-500 italic flex items-center gap-1">
                          <Lock className="h-3.5 w-3.5" />
                          Perihal dan isi surat tidak ditampilkan (Sifat Surat
                          Rahasia/Terbatas)
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">
                        Tanggal Surat
                      </span>
                      <span className="font-medium text-slate-900 flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5 text-slate-400" />
                        {safeFormat(
                          new Date(result.letter.date),
                          "dd MMMM yyyy",
                          {
                            locale: localeId,
                          },
                        )}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">
                        Status Dokumen
                      </span>
                      {/* Was the raw enum — "SIGNED", "ARCHIVED" — on the one
                          page in the system read by people outside it. */}
                      <span className="font-medium text-slate-900">
                        {LETTER_STATUS_LABEL[result.letter.status] ??
                          result.letter.status}
                      </span>
                    </div>
                    {/*
                      Apa yang dibuktikan halaman ini, dan apa yang tidak.

                      Pemeriksaan di atas mengikat byte berkas yang diunggah
                      pembaca kepada byte yang ditandatangani — itu berlaku
                      sama untuk kedua jalur. Yang berbeda adalah hubungan
                      antara keterangan di kartu ini dan isi dokumennya:
                      naskah yang disusun sistem mengambil keduanya dari satu
                      sumber, sedangkan naskah yang diunggah penyusunnya tidak
                      dapat diperiksa demikian oleh mesin mana pun.
                      Menampilkan keduanya tanpa membedakannya berarti
                      menjanjikan pemeriksaan yang tidak pernah terjadi.
                    */}
                    {authoringTrack && (
                      <div className="sm:col-span-2 border-t pt-3">
                        <span className="text-xs text-slate-500 block">
                          Cara Naskah Disusun
                        </span>
                        <span className="font-medium text-slate-900 flex items-center gap-1">
                          {authoringTrack === LetterAuthoringTrack.UPLOADED ? (
                            <FileUp className="h-3.5 w-3.5 text-slate-400" />
                          ) : (
                            <FileText className="h-3.5 w-3.5 text-slate-400" />
                          )}
                          {LETTER_AUTHORING_TRACK_LABELS[authoringTrack].label}
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-slate-600">
                          {
                            LETTER_AUTHORING_TRACK_LABELS[authoringTrack]
                              .assurance
                          }
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {result.signer && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <User className="h-4 w-4 text-blue-600" /> Informasi
                    Penandatangan Elektronik (TTE)
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-slate-50 rounded-lg border text-sm">
                    {/* Nama dan jabatan — bukan NIP. Halaman ini terbuka untuk
                        umum dan hanya perlu menjawab siapa yang menandatangani,
                        bukan nomor induk kepegawaiannya. */}
                    <div>
                      <span className="text-xs text-slate-500 block">
                        Nama Penandatangan
                      </span>
                      <span className="font-bold text-slate-900">
                        {result.signer.name}
                      </span>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="text-xs text-slate-500 block">
                        Jabatan / Wewenang
                      </span>
                      <span className="font-medium text-slate-900">
                        {result.signer.position}
                      </span>
                    </div>
                    {/*
                      Garis kewenangan (a.n./u.b./Plt./Plh.), bila dipakai.

                      Ditampilkan karena ia tercetak pada naskahnya: pembaca
                      yang memegang surat ber-tanda "a.n. Kepala …" berhak tahu
                      bentuk apa yang dinyatakan penandatangannya, dan di mana
                      tanggung jawabnya berada. Nilainya bagian dari payload
                      yang ditandatangani, jadi yang terbaca di sini adalah
                      yang benar-benar ditandatangani.
                    */}
                    {result.signingAuthorityForm &&
                      result.signingAuthorityForm in SIGNING_AUTHORITY_LABELS &&
                      result.signingAuthorityForm !==
                        SigningAuthorityForm.NONE && (
                        <div className="sm:col-span-2 border-t pt-3">
                          <span className="text-xs text-slate-500 block">
                            Garis Kewenangan
                          </span>
                          <span className="font-medium text-slate-900">
                            {
                              SIGNING_AUTHORITY_LABELS[
                                result.signingAuthorityForm
                              ].label
                            }
                            {result.representedOffice
                              ? ` — mewakili ${result.representedOffice}`
                              : ""}
                          </span>
                          <span className="mt-1 block text-xs leading-relaxed text-slate-600">
                            {
                              SIGNING_AUTHORITY_LABELS[
                                result.signingAuthorityForm
                              ].authority
                            }
                          </span>
                        </div>
                      )}
                    {result.signedAt && (
                      <div className="sm:col-span-2">
                        <span className="text-xs text-slate-500 block">
                          Waktu Penandatanganan
                        </span>
                        <span className="font-medium text-slate-900">
                          {formatWibTimestamp(result.signedAt, true)} WIB
                        </span>
                      </div>
                    )}
                    {result.digest && (
                      <div className="sm:col-span-2">
                        <span className="text-xs text-slate-500 block">
                          Digital Digest SHA-256
                        </span>
                        <span className="font-mono text-xs text-slate-600 truncate block">
                          {result.digest}
                        </span>
                      </div>
                    )}
                    {result.signerKeyFingerprint && (
                      <div className="sm:col-span-2">
                        <span className="text-xs text-slate-500 block">
                          Sidik Jari Kunci Penandatangan
                        </span>
                        <span className="font-mono text-xs text-slate-600 break-all block">
                          {result.signerKeyFingerprint}
                        </span>
                        <span className="text-xs text-slate-500 mt-1 block">
                          Catat sekali, lalu bandingkan pada setiap naskah
                          berikutnya dari penandatangan yang sama — seperti
                          memeriksa sidik jari sebuah sertifikat.{" "}
                          <a
                            href="/public/verify-key"
                            className="font-semibold text-blue-700 underline"
                          >
                            Periksa status kuncinya
                          </a>
                          .
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/*
                A failed check needs to say what to do next, not only that it
                failed.

                Verification binds to the exact bytes that were signed, so a
                *genuine* letter fails this check the moment it is re-saved,
                re-compressed, printed to PDF again, or passed through a chat
                app. Left as one red sentence, the page tells that person their
                real document is a forgery. The likeliest innocent cause comes
                first, and there is a way to ask a human.
              */}
              {!result.isValid && !result.isRevoked && (
                <div className="space-y-4">
                  <p className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700">
                    {result.reason ||
                      "Dokumen ini tidak terdaftar dalam sistem resmi Yayasan Pesantren Cipansor."}
                  </p>

                  <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    <p className="font-semibold text-slate-900">
                      Sebelum menyimpulkan dokumen ini palsu, periksa dahulu:
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      <li>
                        Berkas yang diunggah harus{" "}
                        <strong>berkas PDF asli</strong> yang diterima dari
                        Yayasan — bukan hasil pindai, foto, tangkapan layar,
                        atau cetak ulang menjadi PDF baru.
                      </li>
                      <li>
                        Berkas yang dikirim ulang lewat aplikasi pesan kadang
                        dipadatkan sehingga isinya berubah sedikit. Mintalah
                        berkas aslinya.
                      </li>
                      <li>
                        Surat yang terbit sebelum sistem tanda tangan elektronik
                        ini berlaku memang tidak terdaftar di sini.
                      </li>
                    </ul>
                    <p className="mt-3">
                      Masih ragu?{" "}
                      <a
                        href="mailto:halo@cipansor.or.id"
                        className="font-semibold text-blue-700 underline"
                      >
                        halo@cipansor.or.id
                      </a>{" "}
                      — sebutkan nomor suratnya, dan petugas kami akan
                      memeriksakannya.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

export default function PublicVerifyLetterPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center">Memuat halaman verifikasi...</div>
      }
    >
      <PublicVerifyContent />
    </Suspense>
  );
}
