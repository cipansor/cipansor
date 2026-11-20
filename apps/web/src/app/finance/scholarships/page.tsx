"use client";
import { useState } from "react";
import { safeFormat } from "@/lib/date";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus,
  Search,
  RefreshCw,
  Filter,
  GraduationCap,
  Users,
  Eye,
} from "lucide-react";
import { toast } from "sonner";

import { id as localeID } from "date-fns/locale";

import {
  useScholarships,
  useCreateScholarship,
  useAssignScholarship,
  useScholarshipRecipients,
  useScholarshipCriteria,
  useCreateScholarshipCriterion,
  useAssessScholarshipRecipient,
  type Scholarship,
  type ScholarshipRecipient,
  type ScholarshipAssessmentResult,
  ScholarshipSource,
  ScholarshipType,
} from "@/hooks/use-finance-enhancement";
import { FINANCE_UNIT_ROLE_CODES } from "@cipansor/shared";
import { useAuth } from "@/hooks/use-auth";
import { getPrimaryRoleCode } from "@/lib/rbac";
import { criterionValueLabel, formatCriterionScore } from "@/lib/income-range";
import { useUnits } from "@/hooks/use-units";
import { useStudents } from "@/hooks/use-students";
import { useAcademicYears } from "@/hooks/use-academic-years";

const SOURCE_LABELS: Record<ScholarshipSource, string> = {
  [ScholarshipSource.INTERNAL]: "Internal Yayasan",
  [ScholarshipSource.GOVERNMENT]: "Pemerintah (PIP/KIP)",
  [ScholarshipSource.COMPANY]: "CSR Perusahaan",
  [ScholarshipSource.FOUNDATION]: "Lembaga Zakat/Amil",
  [ScholarshipSource.DONOR]: "Donatur Perorangan",
  [ScholarshipSource.OTHER]: "Lainnya",
};

const TYPE_LABELS: Record<ScholarshipType, string> = {
  [ScholarshipType.FULL]: "Beasiswa Penuh (Full)",
  [ScholarshipType.PARTIAL]: "Beasiswa Parsial",
  [ScholarshipType.SPECIFIC]: "Bantuan Khusus",
  [ScholarshipType.FIXED_AMOUNT]: "Bantuan Tetap (Fixed)",
};

/** Peran_Keuangan_Unit — who may compute a score and write a criterion (R11.15). */
const FINANCE_UNIT_ROLES: readonly string[] = FINANCE_UNIT_ROLE_CODES;

/**
 * Whether this account may score for this program: a finance-unit role, and for
 * a non-Super-Admin only within its own unit. The API enforces the same rule;
 * this decides whether the button exists at all (R11.11).
 */
export function canScoreProgram(
  roleCode: string | undefined,
  userUnitId: string | null | undefined,
  programUnitId: string,
): boolean {
  if (!roleCode || !FINANCE_UNIT_ROLES.includes(roleCode)) return false;
  if (roleCode === "SUPER_ADMIN") return true;
  return !!userUnitId && userUnitId === programUnitId;
}

/** The score total to one decimal, "-" when every criterion was excluded. */
function formatTotal(total: number | null): string {
  return total === null || Number.isNaN(total) ? "-" : total.toFixed(1);
}

export function RecipientsDialog({
  scholarship,
  onClose,
}: {
  scholarship: Scholarship | null;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { data: recipients, isLoading } = useScholarshipRecipients(
    scholarship?.id || "",
    { limit: 50 },
  );
  const {
    data: criteria,
    isLoading: criteriaLoading,
    isError: criteriaFailed,
  } = useScholarshipCriteria(scholarship?.id || "");
  const createCriterion = useCreateScholarshipCriterion(scholarship?.id || "");
  const assess = useAssessScholarshipRecipient(scholarship?.id || "");

  const [results, setResults] = useState<
    Record<string, ScholarshipAssessmentResult>
  >({});
  const [scoreError, setScoreError] = useState<string | null>(null);

  if (!scholarship) return null;

  const roleCode = getPrimaryRoleCode(user ?? null);
  const mayScore = canScoreProgram(roleCode, user?.unitId, scholarship.unitId);
  const hasCriteria = (criteria?.length ?? 0) > 0;

  const handleAssess = async (recipientId: string) => {
    setScoreError(null);
    try {
      const result = await assess.mutateAsync(recipientId);
      setResults((prev) => ({ ...prev, [recipientId]: result }));
    } catch {
      // R11.9: say the score was not computed, and keep any previous score out
      // of sight for this recipient.
      setResults((prev) => {
        const next = { ...prev };
        delete next[recipientId];
        return next;
      });
      setScoreError("Skor tidak dihitung. Silakan coba lagi.");
    }
  };

  const handleCreateCriterion = async (formData: FormData) => {
    try {
      await createCriterion.mutateAsync({
        name: formData.get("name") as string,
        weight: Number(formData.get("weight")),
        type: "NUMERIC",
        targetValue: (formData.get("targetValue") as string) || undefined,
      });
      toast.success("Kriteria berhasil ditambahkan");
    } catch {
      toast.error("Gagal menambahkan kriteria");
    }
  };

  return (
    <Dialog open={!!scholarship} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Penerima Beasiswa: {scholarship.name}</DialogTitle>
          <DialogDescription>
            Daftar santri penerima beasiswa ini.
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Skor beasiswa hanya pendukung keputusan. Keputusan penerimaan tetap
          dicatat oleh petugas, bukan ditentukan oleh mesin.
        </p>

        {/* Criteria of the program (R11.13) */}
        <div className="mt-2 space-y-2">
          <h3 className="text-sm font-semibold">Kriteria Penilaian</h3>
          {criteriaLoading ? (
            <p className="text-sm text-muted-foreground">Memuat kriteria...</p>
          ) : criteriaFailed ? (
            // Not the same as "no criteria": the API refused the read, so
            // saying the program has none would be a guess.
            <p className="text-sm text-muted-foreground">
              Kriteria tidak dapat ditampilkan untuk akun ini.
            </p>
          ) : !hasCriteria ? (
            <p className="text-sm text-muted-foreground">
              Program ini belum memiliki kriteria penilaian.
            </p>
          ) : (
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kriteria</TableHead>
                    <TableHead>Bobot</TableHead>
                    <TableHead>Target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {criteria?.map((criterion) => (
                    <TableRow key={criterion.id}>
                      <TableCell>{criterion.name}</TableCell>
                      <TableCell>{criterion.weight}</TableCell>
                      <TableCell>{criterion.targetValue || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {mayScore && (
            <form
              action={handleCreateCriterion}
              className="flex flex-col sm:flex-row gap-2 items-end"
            >
              <div className="space-y-1 flex-1">
                <Label htmlFor="criterion-name">Nama kriteria</Label>
                <Input
                  id="criterion-name"
                  name="name"
                  placeholder="Hafalan Al-Quran"
                  required
                />
              </div>
              <div className="space-y-1 w-24">
                <Label htmlFor="criterion-weight">Bobot</Label>
                <Input
                  id="criterion-weight"
                  name="weight"
                  type="number"
                  min="0.1"
                  step="0.1"
                  defaultValue="1"
                  required
                />
              </div>
              <div className="space-y-1 w-32">
                <Label htmlFor="criterion-target">Target</Label>
                <Input
                  id="criterion-target"
                  name="targetValue"
                  placeholder="30"
                />
              </div>
              <Button type="submit" disabled={createCriterion.isPending}>
                {createCriterion.isPending ? "Menyimpan..." : "Tambah kriteria"}
              </Button>
            </form>
          )}
        </div>

        {scoreError && (
          <p role="alert" className="text-sm text-destructive">
            {scoreError}
          </p>
        )}

        <div className="mt-4 border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama Santri</TableHead>
                <TableHead>NIS</TableHead>
                <TableHead>Kelas</TableHead>
                <TableHead>Tahun Ajaran</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Mulai</TableHead>
                {mayScore && <TableHead className="text-right">Aksi</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-4">
                    Memuat data...
                  </TableCell>
                </TableRow>
              ) : recipients?.data?.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-4 text-muted-foreground"
                  >
                    Belum ada penerima.
                  </TableCell>
                </TableRow>
              ) : (
                recipients?.data?.map((recipient: ScholarshipRecipient) => {
                  const result = results[recipient.id];
                  return (
                    <TableRow key={recipient.id} className="align-top">
                      <TableCell className="font-medium">
                        {recipient.student?.name || "Unknown"}
                        {result && (
                          <div className="mt-2 space-y-1">
                            {result.criteria.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                Program ini belum memiliki kriteria penilaian.
                              </p>
                            ) : (
                              <>
                                {result.criteria.map((c) => (
                                  <div
                                    key={c.criterionId}
                                    className="text-xs text-muted-foreground"
                                  >
                                    {c.name}: {criterionValueLabel(c.value)} —{" "}
                                    {formatCriterionScore(c.score)}
                                  </div>
                                ))}
                                <div className="text-xs font-medium flex items-center gap-2">
                                  <span>
                                    Skor total: {formatTotal(result.totalScore)}
                                  </span>
                                  {!result.complete && (
                                    <Badge variant="secondary">
                                      belum lengkap
                                    </Badge>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{recipient.student?.nis || "-"}</TableCell>
                      <TableCell>{recipient.student?.class || "-"}</TableCell>
                      <TableCell>
                        {recipient.academicYear?.name || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            recipient.status === "ACTIVE"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {recipient.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {safeFormat(
                          new Date(recipient.startDate),
                          "dd MMM yyyy",
                          {
                            locale: localeID,
                          },
                        )}
                      </TableCell>
                      {mayScore && (
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleAssess(recipient.id)}
                            disabled={
                              assess.isPending &&
                              assess.variables === recipient.id
                            }
                          >
                            Hitung skor
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ScholarshipsPage() {
  const [activeView, setActiveView] = useState<"SCHOLARSHIPS" | "RECIPIENTS">(
    "SCHOLARSHIPS",
  );
  const [selectedUnitId, setSelectedUnitId] = useState<string | "ALL">("ALL");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedScholarshipForView, setSelectedScholarshipForView] =
    useState<Scholarship | null>(null);

  const { data: unitsData } = useUnits();
  const { data: academicYears } = useAcademicYears();
  const { data: studentsData } = useStudents({
    unitId: selectedUnitId === "ALL" ? undefined : selectedUnitId,
    search: studentSearch, // Added search
    limit: 20, // Reduced limit, rely on search
  });

  const {
    data: scholarshipsData,
    isLoading: scholarshipsLoading,
    refetch: refetchScholarships,
  } = useScholarships({
    unitId: selectedUnitId === "ALL" ? undefined : selectedUnitId,
    limit: 100,
  });

  const createScholarship = useCreateScholarship();
  const assignScholarship = useAssignScholarship();

  const handleCreate = async (formData: FormData) => {
    try {
      await createScholarship.mutateAsync({
        name: formData.get("name") as string,
        description: formData.get("description") as string,
        source: formData.get("source") as ScholarshipSource,
        type: formData.get("type") as ScholarshipType,
        quota: parseInt(formData.get("quota") as string) || undefined,
        startDate: formData.get("startDate") as string,
        endDate: (formData.get("endDate") as string) || undefined,
        unitId: (formData.get("unitId") as string) || undefined,
        isActive: true,
      });
      toast.success("Program beasiswa berhasil dibuat");
      setIsAddDialogOpen(false);
      refetchScholarships();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Gagal membuat program");
    }
  };

  const handleAssign = async (formData: FormData) => {
    try {
      await assignScholarship.mutateAsync({
        scholarshipId: formData.get("scholarshipId") as string,
        studentId: formData.get("studentId") as string,
        academicYearId: formData.get("academicYearId") as string,
        startDate: formData.get("startDate") as string,
        notes: formData.get("notes") as string,
      });
      toast.success("Beasiswa berhasil diberikan ke santri");
      setIsAssignDialogOpen(false);
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Gagal memberikan beasiswa");
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <PageHeader
          title="Manajemen Beasiswa"
          description="Kelola program beasiswa dan penerima bantuan"
        />

        <div className="flex flex-col sm:flex-row gap-4 justify-between items-center">
          <div className="flex gap-2">
            <Button
              variant={activeView === "SCHOLARSHIPS" ? "default" : "outline"}
              onClick={() => setActiveView("SCHOLARSHIPS")}
            >
              <GraduationCap className="h-4 w-4 mr-2" />
              Program Beasiswa
            </Button>
          </div>

          <div className="flex gap-2">
            <Dialog
              open={isAssignDialogOpen}
              onOpenChange={setIsAssignDialogOpen}
            >
              <DialogTrigger asChild>
                <Button variant="secondary">
                  <Users className="h-4 w-4 mr-2" />
                  Assign Santri
                </Button>
              </DialogTrigger>
              <DialogContent>
                <form action={handleAssign}>
                  <DialogHeader>
                    <DialogTitle>Berikan Beasiswa</DialogTitle>
                    <DialogDescription>
                      Pilih santri dan program beasiswa
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="studentId">Cari Santri</Label>
                      {/* Simple Search Input inside Dialog */}
                      <Input
                        placeholder="Ketik nama santri..."
                        value={studentSearch}
                        onChange={(e) => setStudentSearch(e.target.value)}
                        className="mb-2"
                      />
                      <Select name="studentId" required>
                        <SelectTrigger>
                          <SelectValue placeholder="Pilih santri" />
                        </SelectTrigger>
                        <SelectContent>
                          {studentsData?.data.map((s: any) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.user.name} ({s.nis})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="scholarshipId">Program Beasiswa</Label>
                      <Select name="scholarshipId" required>
                        <SelectTrigger>
                          <SelectValue placeholder="Pilih program" />
                        </SelectTrigger>
                        <SelectContent>
                          {scholarshipsData?.data.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="academicYearId">Tahun Ajaran</Label>
                      <Select name="academicYearId" required>
                        <SelectTrigger>
                          <SelectValue placeholder="Pilih tahun ajaran" />
                        </SelectTrigger>
                        <SelectContent>
                          {academicYears?.data?.map((ay: any) => (
                            <SelectItem key={ay.id} value={ay.id}>
                              {ay.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="startDate">Tanggal Mulai</Label>
                      <Input
                        id="startDate"
                        name="startDate"
                        type="date"
                        defaultValue={safeFormat(new Date(), "yyyy-MM-dd")}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="notes">Catatan</Label>
                      <Textarea
                        id="notes"
                        name="notes"
                        placeholder="Keterangan tambahan..."
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsAssignDialogOpen(false)}
                    >
                      Batal
                    </Button>
                    <Button
                      type="submit"
                      disabled={assignScholarship.isPending}
                    >
                      {assignScholarship.isPending ? "Menyimpan..." : "Simpan"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Buat Program
                </Button>
              </DialogTrigger>
              <DialogContent>
                <form action={handleCreate}>
                  <DialogHeader>
                    <DialogTitle>Buat Program Beasiswa Baru</DialogTitle>
                    <DialogDescription>
                      Tambahkan skema bantuan pembiayaan baru
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Nama Program</Label>
                      <Input
                        id="name"
                        name="name"
                        placeholder="Beasiswa Prestasi Tahfidz"
                        required
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="source">Sumber Dana</Label>
                        <Select name="source" required>
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih sumber" />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(SOURCE_LABELS).map(
                              ([key, label]) => (
                                <SelectItem key={key} value={key}>
                                  {label}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="type">Tipe Beasiswa</Label>
                        <Select name="type" required>
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih tipe" />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(TYPE_LABELS).map(([key, label]) => (
                              <SelectItem key={key} value={key}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="quota">Kuota (Opsional)</Label>
                        <Input
                          id="quota"
                          name="quota"
                          type="number"
                          min="0"
                          placeholder="Tak terbatas"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="unitId">Unit (Opsional)</Label>
                        <Select name="unitId">
                          <SelectTrigger>
                            <SelectValue placeholder="Semua Unit" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">Semua Unit</SelectItem>
                            {unitsData?.map((unit: any) => (
                              <SelectItem key={unit.id} value={unit.id}>
                                {unit.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="startDate">Berlaku Mulai</Label>
                        <Input
                          id="startDate"
                          name="startDate"
                          type="date"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="endDate">Berlaku Sampai</Label>
                        <Input id="endDate" name="endDate" type="date" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description">Deskripsi</Label>
                      <Textarea
                        id="description"
                        name="description"
                        placeholder="Syarat dan ketentuan..."
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsAddDialogOpen(false)}
                    >
                      Batal
                    </Button>
                    <Button
                      type="submit"
                      disabled={createScholarship.isPending}
                    >
                      {createScholarship.isPending ? "Menyimpan..." : "Simpan"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* List */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama Program</TableHead>
                  <TableHead>Sumber</TableHead>
                  <TableHead>Tipe</TableHead>
                  <TableHead>Penerima</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scholarshipsLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
                      Memuat data...
                    </TableCell>
                  </TableRow>
                ) : scholarshipsData?.data.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-8 text-muted-foreground"
                    >
                      Belum ada program beasiswa
                    </TableCell>
                  </TableRow>
                ) : (
                  scholarshipsData?.data.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="font-medium">{item.name}</div>
                        {item.description && (
                          <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                            {item.description}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {SOURCE_LABELS[item.source as ScholarshipSource] ||
                            item.source}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {TYPE_LABELS[item.type as ScholarshipType] ||
                            item.type}
                        </span>
                      </TableCell>
                      <TableCell>
                        {item._count?.recipients || 0} /{" "}
                        {item.quota ? item.quota : "∞"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={item.isActive ? "default" : "secondary"}
                        >
                          {item.isActive ? "Aktif" : "Nonaktif"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedScholarshipForView(item)}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          Lihat
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Recipients Dialog */}
        <RecipientsDialog
          scholarship={selectedScholarshipForView}
          onClose={() => setSelectedScholarshipForView(null)}
        />
      </div>
    </MainLayout>
  );
}
