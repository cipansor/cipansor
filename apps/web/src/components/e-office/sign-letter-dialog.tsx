"use client";

import { useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSignLetter } from "@/hooks/use-esign";
import { getPublicVerifyUrl } from "@/config/site";
import { PenLine, ShieldCheck } from "lucide-react";
import {
  SELECTABLE_SIGNING_AUTHORITY_FORMS,
  SIGNING_AUTHORITY_LABELS,
  SigningAuthorityForm,
  requiresRepresentedOffice,
} from "@cipansor/shared";

/**
 * Membubuhkan tanda tangan elektronik pada surat.
 *
 * Passphrase diminta di sini dan hanya di sini: ia tidak diambil dari sesi,
 * tidak disimpan, dan dibersihkan segera setelah dikirim. Itulah yang membuat
 * tanda tangan berarti "orang ini menandatangani sekarang", bukan sekadar
 * "sesi ini sedang terbuka".
 *
 * **Garis kewenangan (a.n./u.b./Plt./Plh.)** dipilih di sini bila penanda
 * tangan menandatangani atas nama jabatan lain. Ia tercetak pada naskah dan
 * ikut ditandatangani, sehingga harus ditetapkan sebelum, bukan sesudah,
 * penandatanganan. Yang tidak diperiksa sistem adalah keberadaan surat
 * kuasa/SK-nya — itu perbuatan tata usaha kepegawaian; bentuknya adalah
 * pernyataan penanda tangan yang dipublikasikan.
 *
 * Setelah berhasil, QR ditampilkan untuk dibubuhkan pada naskah. QR hanya
 * memuat URL verifikasi — tidak memuat tanda tangan, apalagi isi surat.
 */
export function SignLetterDialog({
  letterId,
  letterNumber,
  open,
  onOpenChange,
}: {
  letterId: string;
  letterNumber?: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const sign = useSignLetter();
  const [passphrase, setPassphrase] = useState("");
  const [authorityForm, setAuthorityForm] = useState<SigningAuthorityForm>(
    SigningAuthorityForm.NONE,
  );
  const [representedOffice, setRepresentedOffice] = useState("");
  const [token, setToken] = useState<string | null>(null);

  const needsRepresentedOffice = requiresRepresentedOffice(authorityForm);
  const authorityInfo = SIGNING_AUTHORITY_LABELS[authorityForm];

  const publicVerifyUrl =
    typeof window !== "undefined"
      ? getPublicVerifyUrl(window.location.origin)
      : getPublicVerifyUrl("https://cipansor.or.id");

  async function submit() {
    try {
      const res = await sign.mutateAsync({
        letterId,
        passphrase,
        signingAuthorityForm: authorityForm,
        representedOffice: needsRepresentedOffice
          ? representedOffice.trim()
          : undefined,
      });
      setPassphrase(""); // tidak disimpan, bahkan tidak di state
      setToken(res.verificationToken);
      toast.success("Surat berhasil ditandatangani.");
    } catch (e: any) {
      setPassphrase("");
      toast.error(e?.response?.data?.message ?? "Gagal menandatangani surat");
    }
  }

  function close(v: boolean) {
    if (!v) {
      setPassphrase("");
      setAuthorityForm(SigningAuthorityForm.NONE);
      setRepresentedOffice("");
      setToken(null);
    }
    onOpenChange(v);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PenLine className="h-5 w-5" />
            Tanda Tangan Elektronik
          </DialogTitle>
          <DialogDescription>
            {letterNumber ? `Surat ${letterNumber}` : "Surat keluar"} akan
            ditandatangani secara elektronik dan tidak dapat diubah lagi
            setelahnya.
          </DialogDescription>
        </DialogHeader>

        {!token ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="sign-authority">Garis kewenangan</Label>
              <Select
                value={authorityForm}
                onValueChange={(v) =>
                  setAuthorityForm(v as SigningAuthorityForm)
                }
              >
                <SelectTrigger id="sign-authority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SELECTABLE_SIGNING_AUTHORITY_FORMS.map((form) => (
                    <SelectItem key={form} value={form}>
                      {SIGNING_AUTHORITY_LABELS[form].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {authorityInfo.summary}
              </p>
            </div>

            {needsRepresentedOffice && (
              <div className="space-y-2">
                <Label htmlFor="sign-represented">Jabatan yang diwakili</Label>
                <Input
                  id="sign-represented"
                  value={representedOffice}
                  onChange={(e) => setRepresentedOffice(e.target.value)}
                  placeholder="mis. Kepala SMA Qur'an Cipansor"
                />
                <p className="text-xs text-muted-foreground">
                  Tercetak pada naskah di depan singkatan{" "}
                  {SIGNING_AUTHORITY_LABELS[authorityForm].label}. Sistem tidak
                  memeriksa surat kuasa/SK yang mendasarinya — pastikan dasarnya
                  ada.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="sign-pass">Passphrase tanda tangan</Label>
              <Input
                id="sign-pass"
                type="password"
                autoComplete="off"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Passphrase tanda tangan Anda"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && passphrase) submit();
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Berbeda dari password akun. Setelah ditandatangani, setiap
              perubahan pada naskah akan membuat tanda tangan tidak lagi sah.
            </p>
            <Button
              onClick={submit}
              disabled={
                sign.isPending ||
                !passphrase ||
                (needsRepresentedOffice && representedOffice.trim().length < 3)
              }
              className="w-full"
            >
              {sign.isPending ? "Menandatangani…" : "Tandatangani Surat"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4 text-center">
            <div className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700">
              <ShieldCheck className="h-4 w-4" />
              Surat telah ditandatangani
            </div>

            {token && (
              <>
                <div className="flex justify-center rounded-lg bg-white p-4">
                  <QRCodeCanvas value={token} size={180} level="M" />
                </div>
                <p className="break-all text-xs text-muted-foreground">
                  Verifikasi keaslian: {publicVerifyUrl}
                </p>
                <p className="text-xs text-muted-foreground">
                  QR ini sudah tercetak pada naskah suratnya — cukup unduh
                  PDF-nya. Untuk memverifikasi keaslian, unggah file PDF pada
                  portal {publicVerifyUrl}.
                </p>
              </>
            )}

            <Button
              variant="outline"
              className="w-full"
              onClick={() => close(false)}
            >
              Selesai
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
