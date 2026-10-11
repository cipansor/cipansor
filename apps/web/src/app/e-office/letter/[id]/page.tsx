"use client";
import { useRouter } from "next/navigation";
import { authFileUrl } from "@/lib/files";
import { safeFormat } from "@/lib/date";
import { useCorrespondence } from "@/hooks/use-correspondence";
import { useAuth } from "@/hooks/use-auth";
import { useCorrespondenceParticipants } from "@/hooks/use-correspondence";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LetterStatusBadge } from "@/components/e-office/letter-status-badge";
import { DispositionTimeline } from "@/components/e-office/disposition-timeline";
import {
  ArrowLeft,
  FileText,
  Send,
  CheckCircle,
  XCircle,
  Printer,
  ShieldCheck,
  ShieldOff,
  PenLine,
  Undo2,
  Paperclip,
  Truck,
} from "lucide-react";

import { id as idLocale } from "date-fns/locale";
import { use, useState } from "react";
/*
 * Tidak ada html2canvas dan jsPDF di sini lagi.
 *
 * Halaman ini dulu merender seluruh surat menjadi satu PNG lalu menempelkannya
 * ke sebuah PDF — naskah yang tidak dapat dipilih, dicari, dibaca pembaca
 * layar, atau membawa tanda tangan PAdES. PR-1 menggantinya dengan penghasil
 * PDF di server, tetapi jalur lamanya ditinggalkan hidup-hidup: `pdfRef`
 * dipasang dan tidak pernah dibaca, `LetterPDFTemplate` dirender tersembunyi
 * pada setiap kali halaman surat dibuka, dan kedua pustaka itu tetap ikut
 * terkirim ke peramban. Kode mati yang tetap dimuat pengguna bukan sekadar
 * kode mati.
 */
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  LetterType,
  LetterNature,
  LetterUrgency,
  LetterAuthoringTrack,
  LetterDirection,
  LetterDispatchChannel,
  LETTER_TYPE_LABELS,
  LETTER_NATURE_LABELS,
  LETTER_URGENCY_LABELS,
  LETTER_DISPATCH_CHANNEL_LABELS,
  mayEditLetter,
  ccRecipientName,
  mayRevokeSignature,
  whoMayRevoke,
  type LetterCcInput,
} from "@cipansor/shared";
import { LetterFlowHistory } from "@/components/e-office/letter-flow-history";
import { SignLetterDialog } from "@/components/e-office/sign-letter-dialog";
import { RevokeLetterDialog } from "@/components/e-office/revoke-letter-dialog";
import { RevocationRequestsCard } from "@/components/e-office/revocation-requests-card";
import { TembusanEditor } from "@/components/e-office/tembusan-editor";
import { getPrimaryRoleCode } from "@/lib/rbac";

/** Status seorang verifikator, dalam bahasa yang dibaca penggunanya. */
const REVIEWER_STATUS_LABEL: Record<string, string> = {
  PENDING: "Menunggu",
  APPROVED: "Sudah diparaf",
  REJECTED: "Dikembalikan",
  REVISION_NEEDED: "Minta revisi",
};

export default function LetterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuth();
  const {
    useLetter,
    updateLetter,
    submitForReview,
    reviewLetter,
    createDisposition,
    updateDispositionStatus,
    resubmitLetter,
    dispatchLetter,
    updateLetterCc,
  } = useCorrespondence(user?.unitId);
  const [participantSearch, setParticipantSearch] = useState("");
  const { data: participantsData } = useCorrespondenceParticipants({
    search: participantSearch || undefined,
    limit: 100,
  });
  const { data: letter, isLoading } = useLetter(id);

  const [notes, setNotes] = useState("");
  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [resubmitNote, setResubmitNote] = useState("");
  const [dispositionData, setDispositionData] = useState({
    recipientIds: [] as string[],
    instruction: "",
    deadline: "",
    notes: "",
  });
  const [forwardModalOpen, setForwardModalOpen] = useState(false);
  const [forwardData, setForwardData] = useState({
    nextReviewerId: "",
    isFinalSigner: false,
    notes: "",
  });
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [completeNotes, setCompleteNotes] = useState("");
  const [ccDraft, setCcDraft] = useState<LetterCcInput[] | null>(null);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editFormData, setEditFormData] = useState<{
    subject: string;
    content: string;
    recipientName: string;
    recipientInstance: string;
    urgency: LetterUrgency;
  }>({
    subject: "",
    content: "",
    recipientName: "",
    recipientInstance: "",
    urgency: LetterUrgency.NORMAL,
  });
  const [dispatchData, setDispatchData] = useState({
    channel: LetterDispatchChannel.HAND_DELIVERY as LetterDispatchChannel,
    dispatchedAt: "",
    receivedByName: "",
    trackingNumber: "",
    note: "",
  });
  const [selectedReviewerId, setSelectedReviewerId] = useState<string>("");

  // Find active disposition for current user
  const activeDisposition = letter?.dispositions?.find(
    (d) => d.recipientId === user?.id && d.status !== "COMPLETED",
  );

  /**
   * The letter's signature, and whether it still stands.
   *
   * `signatures` is ordered oldest-first by the API, so the last entry is the
   * one that speaks for the letter now. A revoked signature is deliberately
   * kept and shown: a letter that circulated must be able to explain itself,
   * and "withdrawn, for this reason" is a far more useful answer to whoever
   * holds a printout than silence.
   */
  const latestSignature = letter?.signatures?.at(-1) ?? null;
  const activeSignature = latestSignature?.revokedAt ? null : latestSignature;
  const revokedSignature = latestSignature?.revokedAt ? latestSignature : null;

  /**
   * Kewenangan mencabut, dibaca dari tabel yang sama dengan yang ditegakkan
   * server (`@cipansor/shared`), bukan disalin ulang di sini.
   *
   * Yang tidak berwenang tidak kehilangan salurannya: tombolnya tetap ada dan
   * membuka permohonan, bukan pencabutan. Menyembunyikannya sama sekali berarti
   * petugas tata usaha yang menemukan nomor surat ganda tidak punya jalan apa
   * pun selain memberi tahu secara lisan.
   */
  const signerParty = activeSignature
    ? {
        userId: letter?.reviewers?.find((r) => r.isSigner)?.reviewerId ?? "",
        roleCode: activeSignature.signerRoleCode ?? null,
      }
    : null;
  const actorParty = {
    userId: user?.id ?? "",
    roleCode: getPrimaryRoleCode(user) ?? null,
  };
  const canRevokeLetter =
    !!signerParty && mayRevokeSignature(signerParty, actorParty);
  const whoMayRevokeText = signerParty ? whoMayRevoke(signerParty) : "";

  // Mirrors the server's `updateLetter` authorisation (creator, executive
  // foundation roles, or a role that handles unit correspondence) so the UI
  // and the API can never disagree about who sees the "Edit Naskah Surat"
  // button. `mayEditLetter` is the same single source the backend guard uses —
  // previously the UI hard-coded only SUPER_ADMIN / SDIT_ADMIN, leaving e.g.
  // the tata usaha and kepala sekolah of every unit unable to edit a naskah
  // they were entitled to change.
  const canEditNaskah =
    letter?.createdById === user?.id || mayEditLetter(getPrimaryRoleCode(user));

  const handleUpdateDisposition = async (
    status: "IN_PROGRESS" | "COMPLETED",
    notes?: string,
  ) => {
    if (!activeDisposition) return;
    try {
      await updateDispositionStatus.mutateAsync({
        id: activeDisposition.id,
        status,
        notes,
      });
      toast.success("Status disposisi diperbarui");
    } catch (error) {
      toast.error("Gagal memperbarui status");
    }
  };

  const handleResubmit = async () => {
    if (!letter?.id) return;
    try {
      await resubmitLetter.mutateAsync({
        id: letter.id,
        note: resubmitNote.trim() || undefined,
      });
      setResubmitNote("");
      toast.success("Surat diajukan ulang untuk diverifikasi.");
    } catch (error: any) {
      toast.error(
        error?.response?.data?.error?.message ??
          error?.response?.data?.message ??
          "Gagal mengajukan ulang surat",
      );
    }
  };

  const handleDownloadPDF = async () => {
    if (!letter?.id) return;

    try {
      toast.info("Sedang mengunduh dokumen PDF...");
      const response = await fetch(
        `/api/correspondence/letters/${letter.id}/pdf`,
        {
          // The HttpOnly session cookie authenticates this same-origin fetch;
          // there is no token in JavaScript to put in a header.
          credentials: "same-origin",
        },
      );

      /**
       * Pesan servernya yang dibacakan, bukan kalimat umum.
       *
       * Penolakan di sisi server bukan "gagal mengunduh": naskahnya bisa saja
       * arsipnya tidak lagi utuh, atau byte-nya sudah menyimpang dari yang
       * ditandatangani sehingga salinan bercap tidak dapat dipertanggung-
       * jawabkan. Menggantinya dengan "Gagal mengunduh surat" membuat operator
       * mencoba lagi, bukan melapor.
       */
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.error?.message ||
            body?.message ||
            "Gagal mengunduh file PDF dari server",
        );
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Surat-${letter.letterNumber || letter.agendaNumber || "Draft"}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success("Surat berhasil diunduh");
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Gagal mengunduh surat",
      );
    }
  };

  const isUpdating = updateDispositionStatus.isPending;

  if (isLoading) {
    return <div className="p-6 text-center">Memuat data surat...</div>;
  }

  if (!letter) {
    return <div className="p-6 text-center">Surat tidak ditemukan.</div>;
  }

  /**
   * Berkas yang diunggah penyusun, yang bukan naskah yang ditandatangani.
   *
   * Keadaan yang dijaga keterangan ini hanya tersisa untuk surat lama: surat
   * keluar yang berkas unggahannya ada tetapi jalur penyusunannya tercatat
   * `GENERATED` — termasuk surat yang dibuat sebelum kolom jalur itu ada, dan
   * sebelum jalur `UPLOADED` benar-benar menandatangani byte unggahan.
   *
   * Surat keluar baru yang membawa berkas naskah sekarang tercatat `UPLOADED`,
   * dan bagi surat itu berkasnya **adalah** naskahnya — tidak ada dokumen kedua
   * yang perlu dibedakan, jadi keterangan ini tidak lagi muncul.
   *
   * Pada surat masuk keadaannya terbalik dan labelnya tetap benar: berkas itu
   * memang naskah aslinya, dan tidak ada naskah lain yang disusun sistem.
   */
  const uploadedFileIsNotTheNaskah =
    !!letter.fileUrl &&
    letter.direction === LetterDirection.OUTGOING &&
    letter.authoringTrack !== LetterAuthoringTrack.UPLOADED;

  const handleReview = async (action: "APPROVE" | "REJECT") => {
    try {
      await reviewLetter.mutateAsync({ id: letter.id, action, notes });
      toast.success(
        `Surat berhasil ${action === "APPROVE" ? "disetujui" : "ditolak"}`,
      );
    } catch (error) {
      toast.error("Gagal memproses review");
    }
  };

  const handleSubmitDraftForReview = async () => {
    const firstReviewerId =
      letter.reviewers?.[0]?.reviewerId || selectedReviewerId;
    if (!firstReviewerId) {
      toast.error("Pemeriksa pertama wajib dipilih saat mengajukan review");
      return;
    }
    try {
      await submitForReview.mutateAsync({
        id: letter.id,
        note: notes || "Mengajukan draft untuk ditinjau",
        reviewerIds: letter.reviewers?.length
          ? undefined
          : [selectedReviewerId],
      });
      toast.success("Draft surat berhasil diajukan untuk ditinjau");
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message ||
          "Gagal mengajukan draft untuk ditinjau",
      );
    }
  };

  const handleForwardReview = async () => {
    const hasExistingSigner = letter.reviewers?.some((r) => r.isSigner);
    if (
      !forwardData.nextReviewerId &&
      !forwardData.isFinalSigner &&
      !hasExistingSigner
    ) {
      toast.error(
        "Pilih pejabat penerus atau tandai sebagai penandatangan akhir.",
      );
      return;
    }
    try {
      await reviewLetter.mutateAsync({
        id: letter.id,
        action: "APPROVE",
        notes: forwardData.notes || notes,
        nextReviewerId: forwardData.nextReviewerId || undefined,
        isFinalSigner: forwardData.isFinalSigner,
      });
      toast.success(
        forwardData.nextReviewerId
          ? "Surat berhasil disetujui dan diteruskan"
          : "Surat berhasil disetujui",
      );
      setForwardModalOpen(false);
    } catch (error) {
      toast.error("Gagal meneruskan surat");
    }
  };

  /**
   * Mencatat pengiriman.
   *
   * Pesan penolakan server dibacakan apa adanya: "naskah ini sudah dicabut"
   * dan "belum ditandatangani" adalah dua hal yang berbeda, dan menggantinya
   * dengan "gagal mencatat pengiriman" membuat petugas mencoba lagi alih-alih
   * memperbaiki keadaannya.
   */
  const handleDispatch = async () => {
    if (!letter?.id) return;
    try {
      await dispatchLetter.mutateAsync({
        id: letter.id,
        channel: dispatchData.channel,
        dispatchedAt: dispatchData.dispatchedAt
          ? new Date(dispatchData.dispatchedAt).toISOString()
          : undefined,
        receivedByName: dispatchData.receivedByName.trim() || undefined,
        trackingNumber: dispatchData.trackingNumber.trim() || undefined,
        note: dispatchData.note.trim() || undefined,
      });
      toast.success("Pengiriman surat tercatat");
      setDispatchOpen(false);
      setDispatchData({
        channel: LetterDispatchChannel.HAND_DELIVERY,
        dispatchedAt: "",
        receivedByName: "",
        trackingNumber: "",
        note: "",
      });
    } catch (error: any) {
      toast.error(
        error?.response?.data?.error?.message ??
          error?.response?.data?.message ??
          "Gagal mencatat pengiriman surat",
      );
    }
  };

  const handleSaveCc = async () => {
    if (!letter?.id || ccDraft === null) return;
    try {
      await updateLetterCc.mutateAsync({
        id: letter.id,
        ccRecipients: ccDraft,
      });
      setCcDraft(null);
      toast.success("Daftar tembusan disimpan");
    } catch (error: any) {
      toast.error(
        error?.response?.data?.error?.message ??
          error?.response?.data?.message ??
          "Gagal menyimpan tembusan",
      );
    }
  };

  const handleCreateDisposition = async () => {
    if (
      !dispositionData.recipientIds ||
      dispositionData.recipientIds.length === 0 ||
      !dispositionData.instruction
    ) {
      toast.error("Penerima dan Instruksi wajib diisi");
      return;
    }

    try {
      await createDisposition.mutateAsync({
        letterId: letter.id,
        senderId: user?.id || "",
        recipientIds: dispositionData.recipientIds,
        instruction: dispositionData.instruction,
        deadline: dispositionData.deadline,
        notes: dispositionData.notes,
      });
      toast.success("Disposisi berhasil dibuat");
      setDispositionOpen(false);
      setDispositionData({
        recipientIds: [],
        instruction: "",
        deadline: "",
        notes: "",
      });
    } catch (error) {
      toast.error("Gagal membuat disposisi");
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Dialog Forward Concept Letter */}
      {/* Dialog Edit Letter */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Edit Naskah Surat</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Perihal / Judul Surat</Label>
              <Input
                value={editFormData.subject}
                onChange={(e) =>
                  setEditFormData({ ...editFormData, subject: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Nama Penerima</Label>
                <Input
                  value={editFormData.recipientName}
                  onChange={(e) =>
                    setEditFormData({
                      ...editFormData,
                      recipientName: e.target.value,
                    })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Instansi Penerima</Label>
                <Input
                  value={editFormData.recipientInstance}
                  onChange={(e) =>
                    setEditFormData({
                      ...editFormData,
                      recipientInstance: e.target.value,
                    })
                  }
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Urgensi</Label>
              <Select
                value={editFormData.urgency}
                onValueChange={(val) =>
                  setEditFormData({
                    ...editFormData,
                    urgency: val as LetterUrgency,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LETTER_URGENCY_LABELS).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Isi Ringkas Naskah</Label>
              <Textarea
                rows={5}
                value={editFormData.content}
                onChange={(e) =>
                  setEditFormData({ ...editFormData, content: e.target.value })
                }
              />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setEditModalOpen(false)}>
              Batal
            </Button>
            <Button
              onClick={async () => {
                if (!letter?.id) return;
                try {
                  await updateLetter.mutateAsync({
                    id: letter.id,
                    data: {
                      subject: editFormData.subject,
                      content: editFormData.content,
                      recipientName: editFormData.recipientName,
                      recipientInstance: editFormData.recipientInstance,
                      urgency: editFormData.urgency,
                    },
                  });
                  toast.success("Naskah surat berhasil diperbarui");
                  setEditModalOpen(false);
                } catch (error: any) {
                  toast.error(
                    error?.response?.data?.message ||
                      "Gagal memperbarui naskah surat",
                  );
                }
              }}
              disabled={updateLetter.isPending}
            >
              {updateLetter.isPending ? "Menyimpan..." : "Simpan Perubahan"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={forwardModalOpen} onOpenChange={setForwardModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Setujui & Teruskan Konsep Surat</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Diteruskan Kepada Pejabat/Atasan Berikutnya</Label>
              <Input
                placeholder="Cari pejabat..."
                value={participantSearch}
                onChange={(e) => setParticipantSearch(e.target.value)}
                className="text-xs mb-1"
              />
              <Select
                onValueChange={(val) =>
                  setForwardData({
                    ...forwardData,
                    nextReviewerId: val,
                    isFinalSigner: false,
                  })
                }
                value={forwardData.nextReviewerId}
                disabled={forwardData.isFinalSigner}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih pejabat penerus..." />
                </SelectTrigger>
                <SelectContent>
                  {participantsData?.data
                    .filter((u) => u.id !== user?.id)
                    .map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.nip ? `${u.name} (${u.nip})` : u.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2 pt-2">
              <input
                type="checkbox"
                id="isFinalSigner"
                checked={forwardData.isFinalSigner}
                onChange={(e) =>
                  setForwardData({
                    ...forwardData,
                    isFinalSigner: e.target.checked,
                    nextReviewerId: e.target.checked
                      ? ""
                      : forwardData.nextReviewerId,
                  })
                }
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label
                htmlFor="isFinalSigner"
                className="text-sm font-medium cursor-pointer"
              >
                Atau tandai untuk langsung diajukan ke Penandatanganan Akhir
              </Label>
            </div>
            <div className="grid gap-2">
              <Label>Catatan / Instruksi Pengulas</Label>
              <Textarea
                placeholder="Catatan pengulasan atau catatan persetujuan..."
                value={forwardData.notes}
                onChange={(e) =>
                  setForwardData({ ...forwardData, notes: e.target.value })
                }
              />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => setForwardModalOpen(false)}
            >
              Batal
            </Button>
            <Button onClick={handleForwardReview}>Proses & Teruskan</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dispositionOpen} onOpenChange={setDispositionOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Buat Disposisi / Teruskan Surat Masuk</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Diteruskan Kepada (Dapat Memilih Beberapa Penerima)</Label>
              <div className="space-y-2 border rounded-md p-3">
                <Input
                  placeholder="Cari penerima disposisi..."
                  value={participantSearch}
                  onChange={(e) => setParticipantSearch(e.target.value)}
                  className="text-xs mb-2 bg-white"
                />
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {participantsData?.data.map((u) => (
                    <div key={u.id} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id={`disp-rec-${u.id}`}
                        value={u.id}
                        checked={dispositionData.recipientIds.includes(u.id)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          const current = dispositionData.recipientIds;
                          if (checked) {
                            setDispositionData({
                              ...dispositionData,
                              recipientIds: [...current, u.id],
                            });
                          } else {
                            setDispositionData({
                              ...dispositionData,
                              recipientIds: current.filter((id) => id !== u.id),
                            });
                          }
                        }}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <label
                        htmlFor={`disp-rec-${u.id}`}
                        className="text-sm cursor-pointer"
                      >
                        {u.nip ? `${u.name} (${u.nip})` : u.name}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Instruksi</Label>
              <Textarea
                placeholder="Isi instruksi disposisi..."
                value={dispositionData.instruction}
                onChange={(e) =>
                  setDispositionData({
                    ...dispositionData,
                    instruction: e.target.value,
                  })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>Batas Waktu</Label>
              <Input
                type="date"
                value={dispositionData.deadline}
                onChange={(e) =>
                  setDispositionData({
                    ...dispositionData,
                    deadline: e.target.value,
                  })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>Catatan Tambahan</Label>
              <Textarea
                placeholder="Catatan (opsional)..."
                value={dispositionData.notes}
                onChange={(e) =>
                  setDispositionData({
                    ...dispositionData,
                    notes: e.target.value,
                  })
                }
              />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setDispositionOpen(false)}>
              Batal
            </Button>
            <Button onClick={handleCreateDisposition}>Kirim Disposisi</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Selesaikan Disposisi</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Catatan Penyelesaian</Label>
              <Textarea
                placeholder="Tuliskan laporan hasil tindak lanjut..."
                value={completeNotes}
                onChange={(e) => setCompleteNotes(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => setCompleteDialogOpen(false)}
            >
              Batal
            </Button>
            <Button
              onClick={async () => {
                await handleUpdateDisposition("COMPLETED", completeNotes);
                setCompleteDialogOpen(false);
              }}
              disabled={isUpdating}
            >
              {isUpdating ? "Menyimpan..." : "Selesai"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/*
        Buku ekspedisi.

        Yang dicatat bukan sekadar "sudah dikirim" melainkan kapan, lewat apa,
        kepada siapa diserahkan, dan nomor resinya. Ketika penerima menyatakan
        tidak menerima surat, keempatnya itulah jawabannya.
      */}
      <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Catat Pengiriman Surat</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Saluran Pengiriman</Label>
              <Select
                value={dispatchData.channel}
                onValueChange={(val) =>
                  setDispatchData({
                    ...dispatchData,
                    channel: val as LetterDispatchChannel,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LETTER_DISPATCH_CHANNEL_LABELS).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Tanggal Pengiriman</Label>
              <Input
                type="date"
                value={dispatchData.dispatchedAt}
                onChange={(e) =>
                  setDispatchData({
                    ...dispatchData,
                    dispatchedAt: e.target.value,
                  })
                }
              />
              {/* Dicatat setelah kurir kembali adalah hal biasa; dicatat untuk
                  besok tidak — server pun menolaknya. */}
              <p className="text-xs text-muted-foreground">
                Kosongkan bila dikirim hari ini. Tidak dapat diisi tanggal yang
                belum tiba.
              </p>
            </div>
            <div className="grid gap-2">
              <Label>Diterima Oleh (opsional)</Label>
              <Input
                placeholder="Nama penerima di tempat tujuan"
                value={dispatchData.receivedByName}
                onChange={(e) =>
                  setDispatchData({
                    ...dispatchData,
                    receivedByName: e.target.value,
                  })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>Nomor Resi (opsional)</Label>
              <Input
                placeholder="Nomor resi kurir/pos"
                value={dispatchData.trackingNumber}
                onChange={(e) =>
                  setDispatchData({
                    ...dispatchData,
                    trackingNumber: e.target.value,
                  })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>Catatan (opsional)</Label>
              <Textarea
                placeholder="Keterangan tambahan..."
                value={dispatchData.note}
                onChange={(e) =>
                  setDispatchData({ ...dispatchData, note: e.target.value })
                }
              />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setDispatchOpen(false)}>
              Batal
            </Button>
            <Button
              onClick={handleDispatch}
              disabled={dispatchLetter.isPending}
            >
              {dispatchLetter.isPending ? "Menyimpan..." : "Catat Pengiriman"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <SignLetterDialog
        letterId={letter.id}
        letterNumber={letter.letterNumber}
        open={signOpen}
        onOpenChange={setSignOpen}
      />

      <RevokeLetterDialog
        letterId={letter.id}
        letterNumber={letter.letterNumber}
        canRevoke={canRevokeLetter}
        whoMayRevokeText={whoMayRevokeText}
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
      />

      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Detail Surat</h1>
          <p className="text-muted-foreground text-sm">
            {letter.letterNumber || letter.agendaNumber || "Draft"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {revokedSignature ? (
            <Badge
              variant="outline"
              className="border-orange-600 text-orange-700 bg-orange-50 gap-1"
            >
              <ShieldOff className="h-3 w-3" />
              Naskah dicabut
            </Badge>
          ) : (
            letter.status === "SIGNED" && (
              <Badge
                variant="outline"
                className="border-green-600 text-green-600 bg-green-50 gap-1"
              >
                <ShieldCheck className="h-3 w-3" />
                Status: Ditandatangani
              </Badge>
            )
          )}
          {/* Labelled when revoked, because an unqualified green "Sudah TTD"
              beside an orange "dicabut" reads as a contradiction. The letter
              really is SIGNED in the agenda — that is what this badge says,
              and saying so removes the ambiguity. */}
          {revokedSignature && (
            <span className="text-xs text-muted-foreground">
              Status agenda:
            </span>
          )}
          <LetterStatusBadge status={letter.status} />
        </div>
      </div>

      {/* A withdrawn signature must be the first thing the page says. The
          letter keeps its SIGNED status — it really was signed, and really did
          circulate — so without this the page would still read as valid. */}
      {revokedSignature && (
        <div className="rounded-lg border border-orange-300 bg-orange-50 p-4 text-sm text-orange-900">
          <p className="flex items-center gap-2 font-semibold">
            <ShieldOff className="h-4 w-4" />
            Naskah dinas ini telah dicabut
          </p>
          {revokedSignature.revokedReason && (
            <p className="mt-1">{revokedSignature.revokedReason}</p>
          )}
          <p className="mt-2 text-xs text-orange-800">
            Dicabut{" "}
            {safeFormat(
              new Date(revokedSignature.revokedAt!),
              "dd MMMM yyyy HH:mm",
              {
                locale: idLocale,
              },
            )}
            {revokedSignature.revokedBy?.name
              ? ` oleh ${revokedSignature.revokedBy.name}`
              : ""}
            . Surat ini tidak lagi berlaku, dan halaman verifikasi publik
            menyatakannya demikian kepada siapa pun yang mengunggah berkasnya.
          </p>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Informasi Surat</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Perihal
                  </label>
                  <p className="font-medium">{letter.subject}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Tanggal
                  </label>
                  <p>
                    {safeFormat(new Date(letter.date), "dd MMMM yyyy", {
                      locale: idLocale,
                    })}
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Pengirim
                  </label>
                  <p>{letter.senderName || letter.senderInstance || "-"}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Penerima
                  </label>
                  <p>
                    {letter.recipientName || letter.recipientInstance || "-"}
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Jenis Naskah
                  </label>
                  <p>
                    {letter.type
                      ? LETTER_TYPE_LABELS[letter.type as LetterType]
                      : "Surat Dinas (Korespondensi)"}
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Sifat
                  </label>
                  {/* Was the raw enum (e.g. "STRICTLY_CONFIDENTIAL"); the
                      label reads as Indonesian, matching the form. */}
                  <p>
                    {LETTER_NATURE_LABELS[letter.nature as LetterNature] ??
                      letter.nature}
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Urgensi
                  </label>
                  {/* Was the raw enum ("NORMAL"), like Sifat used to be. */}
                  <p>
                    {LETTER_URGENCY_LABELS[letter.urgency as LetterUrgency] ??
                      letter.urgency}
                  </p>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Isi Ringkas
                </label>
                <div className="mt-1 p-3 bg-muted/30 rounded-md text-sm whitespace-pre-wrap">
                  {letter.content || "-"}
                </div>
              </div>

              {/* Berkas naskahnya sendiri — bukan lampiran, yang punya
                  daftarnya sendiri di bawah. Sebelumnya berlabel "Lampiran
                  Surat.pdf", sehingga satu-satunya berkas yang ada disebut
                  dengan nama sesuatu yang belum pernah ada. */}
              {letter.fileUrl && (
                <div className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-blue-600" />
                    <span className="text-sm font-medium flex-1">
                      {uploadedFileIsNotTheNaskah
                        ? "Berkas unggahan penyusun"
                        : "Berkas naskah"}
                    </span>
                    <Button variant="ghost" size="sm" asChild>
                      <a
                        href={authFileUrl(letter.fileUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Download
                      </a>
                    </Button>
                  </div>
                  {uploadedFileIsNotTheNaskah && (
                    <p className="text-xs text-muted-foreground">
                      Berkas ini <strong>bukan</strong> naskah yang
                      ditandatangani. Naskah surat keluar ini disusun sistem;
                      yang ditandatangani, diarsipkan, dan diperiksa pada
                      halaman verifikasi publik adalah berkas dari{" "}
                      <em>Cetak Surat</em>.
                    </p>
                  )}
                </div>
              )}

              {(letter.attachments?.length ?? 0) > 0 && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Lampiran ({letter.attachments!.length} berkas)
                  </label>
                  <ul className="mt-1 space-y-2">
                    {letter.attachments!.map((att, index) => (
                      <li
                        key={att.id}
                        className="flex items-center gap-2 rounded-md border p-3"
                      >
                        <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {index + 1}. {att.name}
                        </span>
                        <Button variant="ghost" size="sm" asChild>
                          <a
                            href={authFileUrl(att.fileUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Unduh
                          </a>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {/*
            Tembusan — dapat disusun selama naskah belum ditandatangani.

            Sesudah ditandatangani daftar ini terkunci, dan bukan karena
            kehati-hatian belaka: tembusan tercetak di kaki naskah dan byte
            naskah itu sudah diarsipkan, jadi daftar yang berubah sesudahnya
            akan menyebut tembusan yang tidak ada pada lembar yang beredar —
            dan lembar itulah yang dipegang orang.
          */}
          {(() => {
            const cc = (letter.recipients ?? []).filter((r) => r.isCC);
            const locked = (letter.signatures?.length ?? 0) > 0;
            const editing = ccDraft !== null;
            if (locked && cc.length === 0) return null;

            return (
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle>Tembusan</CardTitle>
                    {!locked && !editing && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setCcDraft(
                            cc.map((r) =>
                              r.userId
                                ? { userId: r.userId }
                                : { externalName: ccRecipientName(r) },
                            ),
                          )
                        }
                      >
                        Susun Tembusan
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {editing ? (
                    <>
                      <TembusanEditor
                        value={ccDraft}
                        onChange={setCcDraft}
                        participants={participantsData?.data ?? []}
                        search={participantSearch}
                        onSearchChange={setParticipantSearch}
                        disabled={updateLetterCc.isPending}
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCcDraft(null)}
                          disabled={updateLetterCc.isPending}
                        >
                          Batal
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleSaveCc}
                          disabled={updateLetterCc.isPending}
                        >
                          {updateLetterCc.isPending ? "Menyimpan..." : "Simpan"}
                        </Button>
                      </div>
                    </>
                  ) : cc.length > 0 ? (
                    <ol className="list-decimal space-y-1 pl-5 text-sm">
                      {cc.map((r) => (
                        <li key={r.id}>
                          {ccRecipientName(r)}
                          {!r.userId && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              (pihak luar — diantar di luar sistem)
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Belum ada tembusan. Naskah dicetak tanpa daftar tembusan.
                    </p>
                  )}

                  {locked && (
                    <p className="text-xs text-muted-foreground">
                      Naskah sudah ditandatangani, sehingga daftar tembusan
                      terkunci — ia tercetak pada lembar yang beredar.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {letter.fileUrl && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  {uploadedFileIsNotTheNaskah
                    ? "Pratinjau Berkas Unggahan"
                    : "Pratinjau Naskah"}
                </CardTitle>
                {uploadedFileIsNotTheNaskah && (
                  <CardDescription>
                    Bukan naskah yang ditandatangani — lihat keterangan pada
                    berkas unggahan di atas.
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <object
                  data={authFileUrl(letter.fileUrl)}
                  type="application/pdf"
                  className="w-full h-[600px] rounded border bg-muted"
                >
                  <div className="flex flex-col items-center justify-center h-full p-6 text-center text-muted-foreground">
                    <FileText className="h-12 w-12 mb-2 opacity-50" />
                    <p className="mb-2">Pratinjau tidak tersedia.</p>
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={authFileUrl(letter.fileUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Unduh Dokumen
                      </a>
                    </Button>
                  </div>
                </object>
              </CardContent>
            </Card>
          )}

          {/*
            Buku ekspedisi surat keluar.

            Kartu ini ada untuk surat keluar saja, dan tetap tampil sebelum ada
            pengiriman apa pun: yang perlu diketahui petugas justru bahwa naskah
            yang sudah ditandatangani ini belum keluar dari kantor.
          */}
          {letter.direction === LetterDirection.OUTGOING && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="h-5 w-5" />
                  Pengiriman
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {letter.sentAt ? (
                  <p className="text-sm">
                    Keluar dari kantor pada{" "}
                    <span className="font-medium">
                      {safeFormat(new Date(letter.sentAt), "dd MMMM yyyy", {
                        locale: idLocale,
                      })}
                    </span>
                    .
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Belum tercatat dikirim.
                  </p>
                )}

                {(letter.dispatches?.length ?? 0) > 0 && (
                  <ul className="space-y-3">
                    {letter.dispatches!.map((d) => (
                      <li key={d.id} className="rounded-md border p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">
                            {LETTER_DISPATCH_CHANNEL_LABELS[d.channel] ??
                              d.channel}
                          </Badge>
                          <span className="text-muted-foreground text-xs">
                            {safeFormat(
                              new Date(d.dispatchedAt),
                              "dd MMMM yyyy",
                              { locale: idLocale },
                            )}
                          </span>
                        </div>
                        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                          {d.receivedByName && (
                            <p>Diterima oleh: {d.receivedByName}</p>
                          )}
                          {d.trackingNumber && (
                            <p>Nomor resi: {d.trackingNumber}</p>
                          )}
                          {d.dispatchedBy?.name && (
                            <p>Dicatat oleh: {d.dispatchedBy.name}</p>
                          )}
                        </div>
                        {d.note && (
                          <p className="mt-2 whitespace-pre-line">{d.note}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          <RevocationRequestsCard
            letterId={letter.id}
            requests={letter.revocationRequests ?? []}
            canDecide={canRevokeLetter}
            currentUserId={user?.id}
          />

          <Card>
            <CardHeader>
              <CardTitle>Riwayat Disposisi</CardTitle>
            </CardHeader>
            <CardContent>
              <DispositionTimeline dispositions={letter.dispositions} />
            </CardContent>
          </Card>

          {/* The full flow history: every forward, paraf, return and archive,
              in order. Distinct from the disposition list above, which shows
              only the routing hops; this also captures verification and
              revision, which is what "who returned this and when" needs. */}
          <Card>
            <CardHeader>
              <CardTitle>Histori Alur Surat</CardTitle>
            </CardHeader>
            <CardContent>
              <LetterFlowHistory events={letter.flowEvents} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Active Disposition Action Card */}
          {activeDisposition && (
            <Card className="border-blue-200 bg-blue-50">
              <CardHeader>
                <CardTitle className="text-blue-800">
                  Tindak Lanjut Disposisi
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-blue-700">
                  Instruksi: <strong>"{activeDisposition.instruction}"</strong>
                </p>
                {/* `flex-1`, not `w-full`. Two `w-full` buttons in one flex
                    row each asked for the whole width, so the second one hung
                    off the edge of the card and "Selesai" was cut in half. */}
                <div className="flex gap-2">
                  {activeDisposition.status === "PENDING" && (
                    <Button
                      className="flex-1 bg-blue-600 hover:bg-blue-700"
                      size="sm"
                      onClick={() => handleUpdateDisposition("IN_PROGRESS")}
                      disabled={isUpdating}
                    >
                      {isUpdating ? "Memproses..." : "Mulai"}
                    </Button>
                  )}
                  <Button
                    className="flex-1 bg-green-600 hover:bg-green-700"
                    size="sm"
                    onClick={() => setCompleteDialogOpen(true)}
                    disabled={isUpdating}
                  >
                    {isUpdating ? "Memproses..." : "Selesai"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Aksi</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* A withdrawn letter is still printable — stamped DICABUT, the
                  way an e-signature platform watermarks a voided document. The
                  office still has to file a copy, and whoever holds the letter
                  deserves a sheet that explains itself. */}
              {(letter.status === "DRAFT" ||
                letter.status === "REVISION_NEEDED") &&
                canEditNaskah && (
                  <Button
                    className="w-full bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={() => {
                      setEditFormData({
                        subject: letter.subject || "",
                        content: letter.content || "",
                        recipientName: letter.recipientName || "",
                        recipientInstance: letter.recipientInstance || "",
                        urgency: letter.urgency || "NORMAL",
                      });
                      setEditModalOpen(true);
                    }}
                  >
                    <PenLine className="mr-2 h-4 w-4" />
                    Edit Naskah Surat
                  </Button>
                )}

              <Button
                className="w-full"
                variant="outline"
                onClick={handleDownloadPDF}
              >
                <Printer className="mr-2 h-4 w-4" />
                Cetak Surat
              </Button>
              {revokedSignature && (
                <p className="-mt-1 text-xs text-muted-foreground">
                  Salinan yang dicetak akan bercap DICABUT beserta alasannya.
                </p>
              )}

              <Button
                className="w-full"
                variant="outline"
                onClick={() => setDispositionOpen(true)}
              >
                <Send className="mr-2 h-4 w-4" />
                Disposisi
              </Button>

              {/*
                Langkah yang selama ini tidak punya tombol.

                Ditawarkan hanya untuk naskah keluar yang sudah ditandatangani
                dan belum dicabut — persis keadaan yang akan diterima server,
                supaya tombol ini tidak menjanjikan sesuatu yang akan ditolak.
                Tetap tampil setelah surat berstatus terkirim: surat yang sama
                diantar ke beberapa alamat, dan yang tidak sampai dikirim ulang.
              */}
              {letter.direction === LetterDirection.OUTGOING &&
                !revokedSignature &&
                (letter.status === "SIGNED" || letter.status === "SENT") && (
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={() => setDispatchOpen(true)}
                  >
                    <Truck className="mr-2 h-4 w-4" />
                    {letter.sentAt
                      ? "Catat Pengiriman Lagi"
                      : "Catat Pengiriman"}
                  </Button>
                )}

              {/*
                Menarik kembali surat yang telanjur beredar.

                Skema dan halaman verifikasi publik sudah lama siap
                menampilkannya; yang tidak pernah ada adalah jalan untuk
                melakukannya, sehingga satu-satunya cara adalah menyunting basis
                data. Wewenangnya tetap ditegakkan server — di sini ia hanya
                menentukan tombolnya ditawarkan atau tidak.
              */}
              {!!activeSignature && (
                <Button
                  className="w-full border-orange-300 text-orange-700 hover:bg-orange-50"
                  variant="outline"
                  onClick={() => setRevokeOpen(true)}
                >
                  <Undo2 className="mr-2 h-4 w-4" />
                  {canRevokeLetter ? "Cabut Naskah Dinas" : "Ajukan Pencabutan"}
                </Button>
              )}

              {/*
                Konsep yang dikembalikan untuk revisi.

                Sebelumnya tidak ada jalan keluar dari keadaan ini: rutenya ada
                di API sejak aturan alurnya diperketat, tetapi tidak satu pun
                halaman memanggilnya, sehingga surat yang dikembalikan berhenti
                di situ selamanya.

                Mengajukan ulang menghapus seluruh paraf, termasuk yang sudah
                diberikan sebelum surat dikembalikan — sebuah paraf menyatakan
                naskah *itu* layak diajukan, dan naskahnya sudah berubah. Itu
                dikatakan di sini, bukan disimpan sebagai kejutan.
              */}
              {letter.status === "REVISION_NEEDED" &&
                letter.createdById === user?.id && (
                  <div className="space-y-3 border-t pt-4">
                    <p className="text-xs font-medium text-muted-foreground">
                      Surat dikembalikan untuk diperbaiki
                    </p>
                    <Textarea
                      placeholder="Catatan perbaikan (opsional)…"
                      value={resubmitNote}
                      onChange={(e) => setResubmitNote(e.target.value)}
                      className="text-xs"
                    />
                    <Button
                      className="w-full bg-blue-600 hover:bg-blue-700"
                      size="sm"
                      onClick={handleResubmit}
                      disabled={resubmitLetter.isPending}
                    >
                      <Send className="mr-2 h-4 w-4" />
                      {resubmitLetter.isPending
                        ? "Mengajukan…"
                        : "Ajukan Ulang"}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Seluruh paraf yang sudah diberikan akan dihapus dan
                      dikumpulkan ulang, karena naskahnya berubah setelah
                      diparaf.
                    </p>
                  </div>
                )}

              {letter.status === "DRAFT" && letter.createdById === user?.id && (
                <div className="space-y-3 pt-2 border-t">
                  {(!letter.reviewers || letter.reviewers.length === 0) && (
                    <div className="space-y-2">
                      <Label className="text-xs font-medium text-slate-700">
                        Pilih Pemeriksa Pertama
                      </Label>
                      <Input
                        placeholder="Cari pejabat..."
                        value={participantSearch}
                        onChange={(e) => setParticipantSearch(e.target.value)}
                        className="text-xs mb-1"
                      />
                      <Select
                        value={selectedReviewerId}
                        onValueChange={setSelectedReviewerId}
                      >
                        <SelectTrigger className="text-xs bg-white">
                          <SelectValue placeholder="Pilih pemeriksa/atasan..." />
                        </SelectTrigger>
                        <SelectContent>
                          {participantsData?.data.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.nip ? `${u.name} (${u.nip})` : u.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <Button
                    className="w-full bg-blue-600 hover:bg-blue-700"
                    onClick={handleSubmitDraftForReview}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Ajukan Review
                  </Button>
                </div>
              )}

              {/*
                Verifikasi berjenjang.

                Sebelumnya blok ini bertanda "Mock Logic" dan menampilkan
                Setuju/Tolak kepada siapa pun yang membuka surat. Sejak
                pemeriksaan giliran ditegakkan di server (utils/letter-workflow),
                tombol itu menjanjikan sesuatu yang akan ditolak API. Panel ini
                kini menawarkan persis apa yang akan diterima — dan menyebut
                siapa yang sedang ditunggu bila bukan giliran kita.

                Penandatangan tidak memakai "Setuju": ia menandatangani, dengan
                passphrase. Itulah bedanya paraf dengan tanda tangan.
              */}
              {(() => {
                const reviewers = letter.reviewers ?? [];
                const mine = reviewers.find((r) => r.reviewerId === user?.id);
                const turn = [...reviewers]
                  .filter((r) => r.status !== "APPROVED")
                  .sort((a, b) => a.order - b.order)[0];
                const openForReview =
                  letter.status === "PENDING_REVIEW" ||
                  letter.status === "READY_TO_SIGN";

                if (!mine || !openForReview) return null;

                if (letter.status === "READY_TO_SIGN" && mine.isSigner) {
                  return (
                    <div className="pt-4 border-t space-y-3">
                      <p className="text-xs font-medium text-muted-foreground mb-2">
                        Penandatanganan
                      </p>
                      <Button
                        className="w-full bg-green-600 hover:bg-green-700"
                        size="sm"
                        onClick={() => setSignOpen(true)}
                      >
                        <PenLine className="mr-2 h-4 w-4" />
                        Tandatangani Dokumen
                      </Button>
                    </div>
                  );
                }

                const myTurn = !!mine && turn?.reviewerId === user?.id;

                if (!myTurn) {
                  return (
                    <div className="pt-4 border-t">
                      <p className="text-xs text-muted-foreground">
                        Menunggu verifikator urutan {turn?.order} lebih dahulu.
                      </p>
                    </div>
                  );
                }

                return (
                  <div className="pt-4 border-t space-y-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      {mine.isSigner
                        ? "Penandatanganan"
                        : "Paraf / Persetujuan"}
                    </p>
                    <Textarea
                      placeholder="Catatan (opsional)..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="mb-2 text-xs"
                    />
                    <div className="flex gap-2">
                      {mine.isSigner ? (
                        <Button
                          className="flex-1 bg-green-600 hover:bg-green-700"
                          size="sm"
                          onClick={() => setSignOpen(true)}
                        >
                          <PenLine className="mr-2 h-3 w-3" />
                          Tandatangani
                        </Button>
                      ) : (
                        <Button
                          className="flex-1 bg-green-600 hover:bg-green-700"
                          size="sm"
                          onClick={() => {
                            setForwardData({
                              nextReviewerId: "",
                              isFinalSigner: false,
                              notes: notes,
                            });
                            setForwardModalOpen(true);
                          }}
                        >
                          <CheckCircle className="mr-2 h-3 w-3" />
                          Setuju & Teruskan
                        </Button>
                      )}
                      <Button
                        className="flex-1"
                        variant="destructive"
                        size="sm"
                        onClick={() => handleReview("REJECT")}
                      >
                        <XCircle className="mr-2 h-3 w-3" />
                        Kembalikan
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status Review</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {letter.reviewers?.map((reviewer, index) => (
                  <div
                    key={reviewer.id}
                    className="flex items-start gap-3 text-sm"
                  >
                    <div
                      className={`
                      flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold
                      ${
                        reviewer.status === "APPROVED"
                          ? "bg-green-100 text-green-700"
                          : reviewer.status === "REJECTED"
                            ? "bg-red-100 text-red-700"
                            : "bg-gray-100 text-gray-700"
                      }
                    `}
                    >
                      {index + 1}
                    </div>
                    <div>
                      <p className="font-medium">
                        {reviewer.reviewer?.name ?? "Tidak diketahui"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {/* Ini bagian yang paling sering dibaca di halaman ini:
                            surat berhenti di siapa. Sebelumnya namanya kosong
                            (DTO menjanjikan `reviewerName`, API mengirim
                            `reviewer.name`) dan statusnya berbahasa Inggris. */}
                        {reviewer.isSigner ? "Penanda tangan" : "Paraf"} ·{" "}
                        {REVIEWER_STATUS_LABEL[reviewer.status] ??
                          reviewer.status}
                      </p>
                      {reviewer.notes && (
                        <p className="text-xs mt-1 bg-muted p-2 rounded">
                          "{reviewer.notes}"
                        </p>
                      )}
                    </div>
                  </div>
                ))}
                {(!letter.reviewers || letter.reviewers.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center">
                    Belum ada pemeriksa yang ditunjuk.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
