"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { usePublicKeyStatus } from "@/hooks/use-correspondence";
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
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Search,
} from "lucide-react";
import { safeFormat } from "@/lib/date";
import { id as localeId } from "date-fns/locale";
import type { PublicKeyStatus } from "@cipansor/shared";

/**
 * Status kunci, dalam bahasa yang dibaca pengunjung dari luar.
 *
 * `UNKNOWN` bukan galat: sidik jari yang tidak terdaftar memang mungkin, dan
 * halaman yang menyebutnya "rusak" akan menakut-nakuti orang yang cuma salah
 * ketik.
 */
const STATUS_COPY: Record<
  PublicKeyStatus,
  { label: string; tone: string; icon: React.ReactNode; note: string }
> = {
  ACTIVE: {
    label: "Kunci berlaku",
    tone: "bg-emerald-50 border-emerald-200 text-emerald-800",
    icon: <ShieldCheck className="h-5 w-5 text-emerald-600" />,
    note: "Kunci ini aktif dan dapat dipakai menandatangani pada masa berlakunya.",
  },
  EXPIRED: {
    label: "Kunci kedaluwarsa",
    tone: "bg-amber-50 border-amber-200 text-amber-800",
    icon: <ShieldAlert className="h-5 w-5 text-amber-600" />,
    note: "Kunci ini sudah lewat masa berlakunya. Naskah yang ditandatangani selama masa berlaku tetap sah; yang ditandatangani setelahnya tidak.",
  },
  REVOKED: {
    label: "Kunci dicabut",
    tone: "bg-red-50 border-red-200 text-red-800",
    icon: <ShieldX className="h-5 w-5 text-red-600" />,
    note: "Kunci ini telah dicabut. Perhatikan sebabnya di bawah — hanya sebab kebocoran kunci yang membuat naskah lama menjadi meragukan.",
  },
  UNKNOWN: {
    label: "Sidik jari tidak dikenal",
    tone: "bg-slate-50 border-slate-200 text-slate-700",
    icon: <ShieldAlert className="h-5 w-5 text-slate-500" />,
    note: "Sidik jari ini tidak terdaftar pada sistem Yayasan Pesantren Cipansor. Periksa kembali penulisannya, atau dokumennya berasal dari sistem lain.",
  },
};

/**
 * Sebab pencabutan publik (RFC 5280 §5.3.1), dalam bahasa yang bisa dibaca.
 *
 * `KEY_COMPROMISE` diberi penanda khusus karena hanya itulah yang menjadikan
 * naskah yang telanjur ditandatangani meragukan. Sebab-sebab lain — pejabat
 * berhenti, kunci diganti — tidak menyentuh keabsahan naskah lama.
 */
const REVOCATION_CODE_COPY: Record<
  string,
  { label: string; concernsOldLetters: boolean }
> = {
  KEY_COMPROMISE: {
    label: "Kunci atau passphrase diduga bocor",
    concernsOldLetters: true,
  },
  AFFILIATION_CHANGED: {
    label: "Pemegangnya berhenti menjabat",
    concernsOldLetters: false,
  },
  SUPERSEDED: {
    label: "Digantikan kunci yang lebih baru",
    concernsOldLetters: false,
  },
  CESSATION_OF_OPERATION: {
    label: "Tidak lagi dipakai tanpa dugaan kebocoran",
    concernsOldLetters: false,
  },
  PRIVILEGE_WITHDRAWN: {
    label: "Kekeliruan penerbitan",
    concernsOldLetters: false,
  },
};

function PublicKeyStatusContent() {
  const [fingerprint, setFingerprint] = useState("");
  const [submitted, setSubmitted] = useState("");

  const { data, isLoading, isError } = usePublicKeyStatus(submitted);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(fingerprint.trim());
  };

  const copy = data ? STATUS_COPY[data.status] : null;
  const revocationCopy =
    data?.revocationCode && REVOCATION_CODE_COPY[data.revocationCode];

  return (
    <main
      id="main-content"
      className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8"
    >
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 bg-blue-100 text-blue-700 rounded-full mb-2">
            <KeyRound className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            Status Kunci Tanda Tangan
          </h1>
          <p className="text-slate-600 text-sm">
            Periksa apakah kunci yang menandatangani sebuah naskah dinas masih
            berlaku — tanpa perlu mengunggah dokumennya.
          </p>
        </div>

        <Card className="shadow-md border-slate-200">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Search className="h-5 w-5 text-blue-600" />
              Masukkan Sidik Jari Kunci
            </CardTitle>
            <CardDescription>
              Sidik jari kunci tercetak pada halaman verifikasi setiap naskah
              dinas, dalam bentuk pasangan huruf-angka yang dipisah titik dua
              (mis. <span className="font-mono">AB:CD:EF:…</span>). Boleh
              ditempel apa adanya.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fingerprint">Sidik Jari Kunci</Label>
                <Input
                  id="fingerprint"
                  name="fingerprint"
                  value={fingerprint}
                  onChange={(e) => setFingerprint(e.target.value)}
                  placeholder="AB:CD:EF:12:34:…"
                  autoComplete="off"
                  className="font-mono"
                />
              </div>
              <Button
                type="submit"
                disabled={!fingerprint.trim() || isLoading}
                className="w-full"
              >
                {isLoading ? "Memeriksa…" : "Periksa Status Kunci"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {isError && (
          <p className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700">
            Permintaan tidak dapat diproses. Silakan coba lagi beberapa saat
            lagi.
          </p>
        )}

        {data && copy && (
          <Card className="shadow-md border-slate-200">
            <CardContent className="space-y-4">
              <div className={`rounded-md border p-4 ${copy.tone}`}>
                <div className="flex items-center gap-2 font-semibold">
                  {copy.icon}
                  {copy.label}
                </div>
                <p className="mt-2 text-sm">{copy.note}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {data.algorithm && (
                  <div>
                    <span className="text-xs text-slate-500 block">
                      Algoritma
                    </span>
                    <span className="font-medium text-slate-900">
                      {data.algorithm}
                    </span>
                  </div>
                )}
                {data.expiresAt && (
                  <div>
                    <span className="text-xs text-slate-500 block">
                      Berlaku Sampai
                    </span>
                    <span className="font-medium text-slate-900">
                      {safeFormat(data.expiresAt, "dd MMMM yyyy", {
                        locale: localeId,
                      })}
                    </span>
                  </div>
                )}
                {data.revokedAt && (
                  <div>
                    <span className="text-xs text-slate-500 block">
                      Dicabut Pada
                    </span>
                    <span className="font-medium text-slate-900">
                      {safeFormat(data.revokedAt, "dd MMMM yyyy", {
                        locale: localeId,
                      })}
                    </span>
                  </div>
                )}
              </div>

              {revocationCopy && (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                    Sebab pencabutan:
                    <Badge
                      variant={
                        revocationCopy.concernsOldLetters
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {revocationCopy.label}
                    </Badge>
                  </div>
                  <p className="mt-2">
                    {revocationCopy.concernsOldLetters
                      ? "Karena sebabnya dugaan kebocoran kunci, keaslian naskah yang ditandatangani dengan kunci ini perlu diverifikasi ulang — hubungi Yayasan."
                      : "Sebab ini tidak menyentuh keabsahan naskah yang sudah ditandatangani pada masa berlaku kunci — naskah itu tetap sah."}
                  </p>
                </div>
              )}

              <p className="text-xs text-slate-500">
                Ingin memeriksa sebuah <em>dokumen</em>, bukan kuncinya?{" "}
                <Link
                  href="/public/verify-letter"
                  className="font-semibold text-blue-700 underline"
                >
                  Unggah berkas PDF naskah dinas di sini
                </Link>
                .
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

export default function PublicKeyStatusPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center">Memuat halaman status kunci…</div>
      }
    >
      <PublicKeyStatusContent />
    </Suspense>
  );
}
