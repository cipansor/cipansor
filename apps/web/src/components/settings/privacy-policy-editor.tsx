"use client";

/**
 * Super-admin editor for the public, versioned Kebijakan Privasi (UU PDP
 * 27/2022 Pasal 30, 35).
 *
 * It PUBLISHES a new version — it never edits an existing one. A consent only
 * covers the text the registrant actually read, so `Registrant.consentVersion`
 * points at a number, and changing a published text would make that record
 * lie (decisions/persetujuan-pengguna.md). The server computes the next version
 * number; this form never sends one.
 *
 * All three languages are required: the public site serves id/en/ar on every
 * page, and a version missing a translation is unreadable to part of its
 * audience. The API enforces the same.
 */

import { useState } from "react";
import { FileText, Globe, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useCreatePrivacyPolicyVersion,
  usePrivacyPolicyCurrent,
  usePrivacyPolicyVersions,
} from "@/hooks/use-privacy-policy";

/** Mirrors `privacyPolicyTextFields` in @cipansor/shared. */
const MAX_BODY = 20000;
const MAX_SUMMARY = 500;

type LangKey = "id" | "en" | "ar";

const LANGS: { key: LangKey; label: string; dir: "ltr" | "rtl" }[] = [
  { key: "id", label: "Indonesia", dir: "ltr" },
  { key: "en", label: "English", dir: "ltr" },
  { key: "ar", label: "العربية", dir: "rtl" },
];

interface Draft {
  bodies: Record<LangKey, string>;
  summaries: Record<LangKey, string>;
}

const EMPTY: Draft = {
  bodies: { id: "", en: "", ar: "" },
  summaries: { id: "", en: "", ar: "" },
};

function formatDate(iso: string): string | null {
  try {
    return new Date(iso).toLocaleString("id-ID", {
      dateStyle: "long",
      timeStyle: "short",
    });
  } catch {
    return null;
  }
}

/** Today, in the format a `<input type="date">` expects, in WIB. */
function todayInputValue(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts;
}

export function PrivacyPolicyEditor() {
  const { data: current, isLoading, isError } = usePrivacyPolicyCurrent();
  const { data: versions } = usePrivacyPolicyVersions();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Gagal memuat Kebijakan Privasi</AlertTitle>
        <AlertDescription>
          Kebijakan Privasi tidak dapat diambil. Silakan muat ulang halaman ini.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <Alert variant="info">
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Versi lama tidak pernah disunting</AlertTitle>
        <AlertDescription>
          Persetujuan pendaftar menunjuk <strong>nomor versi</strong> teks yang
          benar-benar dibaca saat itu (UU PDP 27/2022 Pasal 20, 25). Karena itu
          menekan “Terbitkan” membuat <strong>versi baru</strong>, bukan
          mengubah yang lama. Pastikan teks sudah final sebelum menerbitkan.
        </AlertDescription>
      </Alert>

      {current && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Versi yang berlaku
            </CardTitle>
            <CardDescription>
              Halaman publik dan formulir SPMB menampilkan versi ini, dan
              persetujuan pendaftar baru menunjuk nomornya.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="flex items-center gap-2">
              <Badge>Versi {current.version}</Badge>
            </p>
            <p className="text-muted-foreground">
              Berlaku sejak{" "}
              {formatDate(current.effectiveAt) ?? current.effectiveAt}
            </p>
            <p className="text-muted-foreground">{current.texts.id.summary}</p>
          </CardContent>
        </Card>
      )}

      {!current && (
        <Alert variant="warning">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Belum ada versi terbit</AlertTitle>
          <AlertDescription>
            Selama belum ada versi, formulir SPMB menolak menerima persetujuan
            dan pendaftaran daring tidak dapat dikirim. Terbitkan versi pertama
            di bawah ini.
          </AlertDescription>
        </Alert>
      )}

      {/* Remount the form once a version exists, so a first publication does
          not leave the "not yet published" banner behind. */}
      <PublishForm key={current?.version ?? "none"} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Riwayat versi
          </CardTitle>
          <CardDescription>
            Versi terbaru lebih dulu. Isi tiap versi tidak dapat diubah.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {versions && versions.data.length > 0 ? (
            <ul className="divide-y divide-border text-sm">
              {versions.data.map((v) => (
                <li key={v.id} className="flex items-start gap-3 py-3">
                  <Badge variant="secondary">Versi {v.version}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-muted-foreground">
                      {v.summary}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Berlaku sejak {formatDate(v.effectiveAt) ?? v.effectiveAt}
                      {v.createdBy ? ` · oleh ${v.createdBy.name}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Belum ada versi yang diterbitkan.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PublishForm() {
  const create = useCreatePrivacyPolicyVersion();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [effectiveAt, setEffectiveAt] = useState(todayInputValue());

  const busy = create.isPending;

  const setBody = (key: LangKey, value: string) =>
    setDraft((prev) => ({
      ...prev,
      bodies: { ...prev.bodies, [key]: value },
    }));
  const setSummary = (key: LangKey, value: string) =>
    setDraft((prev) => ({
      ...prev,
      summaries: { ...prev.summaries, [key]: value },
    }));

  const bodiesOk = LANGS.every(
    (l) =>
      draft.bodies[l.key].trim().length >= 20 &&
      draft.bodies[l.key].length <= MAX_BODY,
  );
  const summariesOk = LANGS.every(
    (l) =>
      draft.summaries[l.key].trim().length >= 10 &&
      draft.summaries[l.key].length <= MAX_SUMMARY,
  );
  const canPublish = bodiesOk && summariesOk && !!effectiveAt && !busy;

  const onPublish = async () => {
    try {
      const created = await create.mutateAsync({
        bodies: {
          id: draft.bodies.id.trim(),
          en: draft.bodies.en.trim(),
          ar: draft.bodies.ar.trim(),
        },
        summaries: {
          id: draft.summaries.id.trim(),
          en: draft.summaries.en.trim(),
          ar: draft.summaries.ar.trim(),
        },
        // Noon WIB, so no timezone can move the effective day.
        effectiveAt: new Date(`${effectiveAt}T12:00:00+07:00`),
      });
      toast.success(
        `Versi ${created.version} diterbitkan. Halaman publik dan formulir SPMB kini memakainya.`,
      );
      setDraft(EMPTY);
    } catch {
      toast.error("Gagal menerbitkan versi. Periksa isian lalu coba lagi.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Terbitkan versi baru</CardTitle>
        <CardDescription>
          Ketiga bahasa wajib diisi: situs publik menyajikan Indonesia, Inggris,
          dan Arab di setiap halaman.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-xs space-y-2">
          <Label htmlFor="effectiveAt">Berlaku sejak</Label>
          <Input
            id="effectiveAt"
            type="date"
            value={effectiveAt}
            onChange={(e) => setEffectiveAt(e.target.value)}
            disabled={busy}
          />
        </div>

        <Tabs defaultValue="id">
          <TabsList>
            {LANGS.map((l) => (
              <TabsTrigger key={l.key} value={l.key}>
                {l.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {LANGS.map((l) => (
            <TabsContent key={l.key} value={l.key} className="space-y-4 pt-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor={`summary-${l.key}`}>Ringkasan</Label>
                  <span
                    className={`text-xs ${
                      draft.summaries[l.key].length > MAX_SUMMARY
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }`}
                  >
                    {draft.summaries[l.key].length}/{MAX_SUMMARY}
                  </span>
                </div>
                <Input
                  id={`summary-${l.key}`}
                  dir={l.dir}
                  value={draft.summaries[l.key]}
                  onChange={(e) => setSummary(l.key, e.target.value)}
                  disabled={busy}
                  placeholder="Ringkasan satu paragraf untuk halaman publik…"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor={`body-${l.key}`}>Isi lengkap</Label>
                  <span
                    className={`text-xs ${
                      draft.bodies[l.key].length > MAX_BODY
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }`}
                  >
                    {draft.bodies[l.key].length}/{MAX_BODY}
                  </span>
                </div>
                <Textarea
                  id={`body-${l.key}`}
                  dir={l.dir}
                  value={draft.bodies[l.key]}
                  onChange={(e) => setBody(l.key, e.target.value)}
                  disabled={busy}
                  rows={14}
                  className="leading-relaxed"
                  placeholder="Data yang diproses, dasar hukumnya, masa simpan, dan hak subjek data…"
                />
              </div>
            </TabsContent>
          ))}
        </Tabs>

        {!bodiesOk && (
          <p className="text-sm text-muted-foreground">
            Isi lengkap minimal 20 karakter di setiap bahasa.
          </p>
        )}
        {!summariesOk && (
          <p className="text-sm text-muted-foreground">
            Ringkasan minimal 10 karakter dan maksimal {MAX_SUMMARY} karakter di
            setiap bahasa.
          </p>
        )}
      </CardContent>
      <CardFooter>
        <Button onClick={onPublish} disabled={!canPublish}>
          <Save className="mr-2 h-4 w-4" />
          {busy ? "Menerbitkan…" : "Terbitkan versi baru"}
        </Button>
      </CardFooter>
    </Card>
  );
}
