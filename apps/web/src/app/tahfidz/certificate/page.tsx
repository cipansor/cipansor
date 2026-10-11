"use client";
import { useState, useRef, useEffect } from "react";
import { safeFormat } from "@/lib/date";
import { MainLayout } from "@/components/layout/main-layout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useStudents, Student } from "@/hooks/use-students";
import { useUnits } from "@/hooks/use-units";
import { useClasses } from "@/hooks/use-classes";
import {
  Award,
  Printer,
  Search,
  User,
  ChevronRight,
  CheckCircle2,
  BookOpen,
  Star,
} from "lucide-react";
import { toast } from "sonner";

import { id as idLocale } from "date-fns/locale";
import { api } from "@/lib/api";
import { LETTERHEAD, STUDENT_STATUS } from "@cipansor/shared";
import { certificateSigners } from "@/lib/tahfidz-certificate-signers";
import { printDocument } from "@/lib/print-document";
import { useEnvironment } from "@/hooks/use-environment";

// ========================================
// JUZ DATA & SANAD TYPES
// ========================================

const JUZ_NAMES = [
  { number: 1, name: "Juz 1 (Al-Fatihah - Al-Baqarah 141)" },
  { number: 2, name: "Juz 2 (Al-Baqarah 142-252)" },
  { number: 3, name: "Juz 3 (Al-Baqarah 253 - Ali Imran 92)" },
  { number: 4, name: "Juz 4 (Ali Imran 93 - An-Nisa 23)" },
  { number: 5, name: "Juz 5 (An-Nisa 24-147)" },
  { number: 6, name: "Juz 6 (An-Nisa 148 - Al-Maidah 81)" },
  { number: 7, name: "Juz 7 (Al-Maidah 82 - Al-An'am 110)" },
  { number: 8, name: "Juz 8 (Al-An'am 111 - Al-A'raf 87)" },
  { number: 9, name: "Juz 9 (Al-A'raf 88 - Al-Anfal 40)" },
  { number: 10, name: "Juz 10 (Al-Anfal 41 - At-Taubah 92)" },
  { number: 11, name: "Juz 11 (At-Taubah 93 - Hud 5)" },
  { number: 12, name: "Juz 12 (Hud 6 - Yusuf 52)" },
  { number: 13, name: "Juz 13 (Yusuf 53 - Ibrahim 52)" },
  { number: 14, name: "Juz 14 (Al-Hijr 1 - An-Nahl 128)" },
  { number: 15, name: "Juz 15 (Al-Isra 1 - Al-Kahf 74)" },
  { number: 16, name: "Juz 16 (Al-Kahf 75 - Taha 135)" },
  { number: 17, name: "Juz 17 (Al-Anbiya 1 - Al-Hajj 78)" },
  { number: 18, name: "Juz 18 (Al-Mu'minun 1 - Al-Furqan 20)" },
  { number: 19, name: "Juz 19 (Al-Furqan 21 - An-Naml 55)" },
  { number: 20, name: "Juz 20 (An-Naml 56 - Al-Ankabut 45)" },
  { number: 21, name: "Juz 21 (Al-Ankabut 46 - Al-Ahzab 30)" },
  { number: 22, name: "Juz 22 (Al-Ahzab 31 - Ya Sin 27)" },
  { number: 23, name: "Juz 23 (Ya Sin 28 - Az-Zumar 31)" },
  { number: 24, name: "Juz 24 (Az-Zumar 32 - Fussilat 46)" },
  { number: 25, name: "Juz 25 (Fussilat 47 - Al-Jathiyah 37)" },
  { number: 26, name: "Juz 26 (Al-Ahqaf 1 - Az-Zariyat 30)" },
  { number: 27, name: "Juz 27 (Az-Zariyat 31 - Al-Hadid 29)" },
  { number: 28, name: "Juz 28 (Al-Mujadilah 1 - At-Tahrim 12)" },
  { number: 29, name: "Juz 29 (Al-Mulk 1 - Al-Mursalat 50)" },
  { number: 30, name: "Juz 30 / Juz Amma (An-Naba - An-Nas)" },
];

const CERTIFICATE_TYPES = [
  {
    id: "TAHFIDZ_JUZ_AMMA",
    label: "Sertifikat Hafalan Juz 30 (Juz Amma)",
    description: "Untuk santri yang telah menyelesaikan hafalan Juz Amma",
    icon: "📖",
    color: "bg-green-100 text-green-700",
  },
  {
    id: "TAHFIDZ_5_JUZ",
    label: "Sertifikat Hafalan 5 Juz",
    description: "Untuk santri yang telah menyelesaikan hafalan 5 Juz",
    icon: "📗",
    color: "bg-blue-100 text-blue-700",
  },
  {
    id: "TAHFIDZ_10_JUZ",
    label: "Sertifikat Hafalan 10 Juz",
    description: "Untuk santri yang telah menyelesaikan hafalan 10 Juz",
    icon: "📘",
    color: "bg-purple-100 text-purple-700",
  },
  {
    id: "TAHFIDZ_30_JUZ",
    label: "Sanad Hafalan 30 Juz (Khatam)",
    description: "Sanad resmi untuk Hafidz/Hafidzah 30 Juz Al-Quran",
    icon: "🏆",
    color: "bg-yellow-100 text-yellow-700",
  },
  {
    id: "SANAD_QIRAAH",
    label: "Sanad Qira'ah",
    description: "Sanad untuk bacaan Al-Quran dengan riwayat tertentu",
    icon: "📜",
    color: "bg-amber-100 text-amber-700",
  },
];

const QIRAAH_TYPES = [
  "Riwayat Hafs dari Ashim",
  "Riwayat Warsy dari Nafi",
  "Riwayat Qalun dari Nafi",
  "Riwayat Ad-Duri dari Abu Amr",
  "Riwayat As-Susi dari Abu Amr",
  "Riwayat Syu'bah dari Ashim",
  "Qiraah Sab'ah (7 Qiraah)",
];

const GRADE_OPTIONS = [
  "Mumtaz (Istimewa)",
  "Jayyid Jiddan (Sangat Baik)",
  "Jayyid (Baik)",
  "Maqbul (Cukup)",
];

interface FormData {
  certificateType: string;
  tanggalSertifikat: string;
  musyrifName: string;
  musyrifTitle: string;
  completedJuz: number[];
  grade: string;
  qiraahType: string;
  sanadChain: string;
  notes: string;
}

export default function TahfidzCertificatePage() {
  const { data: environment } = useEnvironment();
  const [selectedUnitId, setSelectedUnitId] = useState<string>("");
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [activeTab, setActiveTab] = useState("select-student");
  const [formData, setFormData] = useState<FormData>({
    certificateType: "TAHFIDZ_JUZ_AMMA",
    tanggalSertifikat: safeFormat(new Date(), "yyyy-MM-dd"),
    musyrifName: "",
    musyrifTitle: "Musyrif Tahfidz",
    completedJuz: [30],
    grade: "Jayyid Jiddan (Sangat Baik)",
    qiraahType: "Riwayat Hafs dari Ashim",
    sanadChain: "",
    notes: "",
  });
  const [generatedCertNumber, setGeneratedCertNumber] = useState<string | null>(
    null,
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [shouldPrint, setShouldPrint] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const { data: units = [] } = useUnits();
  const { data: classesData } = useClasses({
    unitId: selectedUnitId || undefined,
  });
  const classes = classesData?.data || [];
  const { data: studentsData, isLoading: studentsLoading } = useStudents({
    unitId: selectedUnitId || undefined,
    classId: selectedClassId || undefined,
    search: searchQuery || undefined,
    status: STUDENT_STATUS.ACTIVE,
    limit: 50,
  });

  const students = studentsData?.data || [];
  const selectedCertType = CERTIFICATE_TYPES.find(
    (c) => c.id === formData.certificateType,
  );

  const handleSelectStudent = (student: Student) => {
    setSelectedStudent(student);
    setGeneratedCertNumber(null);
    setActiveTab("select-type");
  };

  const handleSelectType = (typeId: string) => {
    let defaultJuz: number[] = [];
    if (typeId === "TAHFIDZ_JUZ_AMMA") defaultJuz = [30];
    else if (typeId === "TAHFIDZ_5_JUZ") defaultJuz = [26, 27, 28, 29, 30];
    else if (typeId === "TAHFIDZ_10_JUZ")
      defaultJuz = [21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
    else if (typeId === "TAHFIDZ_30_JUZ")
      defaultJuz = Array.from({ length: 30 }, (_, i) => i + 1);

    setFormData({
      ...formData,
      certificateType: typeId,
      completedJuz: defaultJuz,
    });
    setGeneratedCertNumber(null);
    setActiveTab("fill-details");
  };

  const handleJuzToggle = (juzNumber: number) => {
    setFormData((prev) => ({
      ...prev,
      completedJuz: prev.completedJuz.includes(juzNumber)
        ? prev.completedJuz.filter((j) => j !== juzNumber)
        : [...prev.completedJuz, juzNumber].sort((a, b) => a - b),
    }));
  };

  const performPrint = () => {
    const printContent = printRef.current?.innerHTML || "";

    const printed = printDocument({
      title: `Sertifikat Tahfidz - ${selectedStudent?.name ?? ""}`,
      head: `
        <link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Cinzel:wght@400;600;700&family=Great+Vibes&family=Noto+Naskh+Arabic:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
          @page {
            size: A4 landscape;
            margin: 0;
          }
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: 'Amiri', 'Noto Naskh Arabic', serif;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        </style>
      `,
      body: printContent,
      testCopy: environment?.testCopy,
    });
    if (!printed) {
      toast.error("Popup diblokir. Izinkan popup untuk mencetak.");
      return;
    }
    toast.success("Sertifikat siap dicetak");
  };

  // Trigger print logic when shouldPrint becomes true AND we have a generatedCertNumber
  useEffect(() => {
    if (shouldPrint && generatedCertNumber) {
      // Double check printRef content is ready
      // Small timeout to ensure state update propagated to DOM
      const timer = setTimeout(() => {
        performPrint();
        setShouldPrint(false); // Reset trigger
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [shouldPrint, generatedCertNumber]);

  const handlePrint = async () => {
    if (!selectedStudent) {
      toast.error("Pilih santri terlebih dahulu");
      return;
    }

    // Generate certificate first if not already generated
    let currentCertNumber = generatedCertNumber;

    if (!currentCertNumber) {
      setIsGenerating(true);
      try {
        const res = await api.post("/tahfidz/certificates/generate", {
          studentId: selectedStudent.id,
          certificateType: formData.certificateType,
          issueDate: formData.tanggalSertifikat,
          grade: formData.grade,
          completedJuz: formData.completedJuz,
          qiraahType: formData.qiraahType,
          musyrifName: formData.musyrifName,
          sanadChain: formData.sanadChain,
          notes: formData.notes,
        });

        if (res.data && res.data.success) {
          currentCertNumber = res.data.data.certificateNumber;
          setGeneratedCertNumber(currentCertNumber);
          toast.success("Nomor sertifikat berhasil digenerate");
          // Trigger print effect
          setShouldPrint(true);
        } else {
          toast.error("Gagal generate nomor sertifikat");
          setIsGenerating(false);
          return;
        }
      } catch (err) {
        console.error(err);
        toast.error("Gagal generate nomor sertifikat");
        setIsGenerating(false);
        return;
      }
      setIsGenerating(false);
    } else {
      // If already generated, just print
      setShouldPrint(true);
    }
  };

  // ========================================
  // RENDER CERTIFICATE PREVIEW
  // ========================================
  const renderCertificatePreview = () => {
    if (!selectedStudent || !selectedCertType) return null;

    const isSanad =
      formData.certificateType === "TAHFIDZ_30_JUZ" ||
      formData.certificateType === "SANAD_QIRAAH";

    const bgColor = isSanad
      ? "linear-gradient(135deg, #0c4a6e 0%, #082f49 100%)"
      : "linear-gradient(135deg, #065f46 0%, #022c22 100%)";

    const accentColor = isSanad ? "#fbbf24" : "#10b981";

    // Use generated number or fallback to placeholder
    const certNumberDisplay = generatedCertNumber
      ? `No: ${generatedCertNumber}`
      : `No: [DRAFT]/${formData.certificateType.split("_").pop()}/CPN/${safeFormat(new Date(), "MM/yyyy")}`;

    return (
      <div
        ref={printRef}
        className="w-[297mm] h-[210mm] relative overflow-hidden"
        style={{ background: bgColor }}
      >
        {/* Decorative Islamic Pattern Border */}
        <div
          className="absolute inset-4 border-4 rounded-lg"
          style={{ borderColor: accentColor }}
        >
          <div
            className="absolute inset-2 border-2 rounded"
            style={{ borderColor: accentColor, opacity: 0.5 }}
          />
        </div>

        {/* Corner Arabic Calligraphy Decorations */}
        <div
          className="absolute top-6 left-6 text-4xl opacity-30"
          style={{
            color: accentColor,
            fontFamily: "'Noto Naskh Arabic', serif",
          }}
        >
          ﷽
        </div>
        <div
          className="absolute top-6 right-6 text-4xl opacity-30"
          style={{
            color: accentColor,
            fontFamily: "'Noto Naskh Arabic', serif",
          }}
        >
          ﷽
        </div>

        {/* Content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white px-16 py-8">
          {/* Bismillah */}
          <div
            className="text-3xl mb-2 opacity-80"
            style={{ fontFamily: "'Noto Naskh Arabic', serif" }}
          >
            بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيْمِ
          </div>

          {/* Header */}
          <div className="text-center mb-4">
            <p className="text-xs tracking-[0.3em] uppercase opacity-80">
              {/* The yayasan's name, not a generic one. */}
              {LETTERHEAD.organisation}
            </p>
            <h1
              className="text-2xl font-bold tracking-wide mt-1"
              style={{ fontFamily: "'Cinzel', serif", color: accentColor }}
            >
              PONDOK PESANTREN CIPANSOR
            </h1>
            <p className="text-xs opacity-70 mt-1">
              Tahfidz Al-Qur&apos;an Program
            </p>
          </div>

          {/* Certificate Type Title */}
          <div className="text-center mb-4">
            <p
              className="text-2xl font-bold tracking-widest uppercase"
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              {isSanad ? "SANAD" : "SERTIFIKAT"}
            </p>
            <p
              className="text-lg opacity-90 mt-1"
              style={{ fontFamily: "'Amiri', serif" }}
            >
              {selectedCertType.label}
            </p>
            {isSanad && (
              <p
                className="text-xl mt-2"
                style={{
                  fontFamily: "'Noto Naskh Arabic', serif",
                  color: accentColor,
                }}
              >
                إِجَازَةٌ فِي حِفْظِ الْقُرْآنِ الْكَرِيمِ
              </p>
            )}
          </div>

          {/* Certificate Number */}
          <p className="text-xs opacity-60 mb-3">{certNumberDisplay}</p>

          {/* Main Text */}
          <div className="text-center mb-4">
            <p className="text-base mb-2">Diberikan kepada:</p>
            <p
              className="text-3xl mb-2"
              style={{
                fontFamily: "'Great Vibes', cursive",
                color: accentColor,
              }}
            >
              {selectedStudent.name}
            </p>
            <p className="text-sm opacity-80">NIS: {selectedStudent.nis}</p>
            <p className="text-xs opacity-70">
              Tempat/Tanggal Lahir: {selectedStudent.birthPlace || "-"},{" "}
              {selectedStudent.birthDate
                ? safeFormat(
                    new Date(selectedStudent.birthDate),
                    "d MMMM yyyy",
                    {
                      locale: idLocale,
                    },
                  )
                : "-"}
            </p>
          </div>

          {/* Description */}
          <div className="text-center mb-4 max-w-2xl">
            <p
              className="text-sm leading-relaxed"
              style={{ fontFamily: "'Amiri', serif" }}
            >
              {formData.certificateType === "TAHFIDZ_JUZ_AMMA" &&
                "Telah menyelesaikan hafalan Juz 30 (Juz Amma) Al-Quran Al-Karim dengan bacaan yang baik dan benar."}
              {formData.certificateType === "TAHFIDZ_5_JUZ" &&
                `Telah menyelesaikan hafalan ${formData.completedJuz.length} Juz Al-Quran Al-Karim dengan bacaan yang baik dan benar.`}
              {formData.certificateType === "TAHFIDZ_10_JUZ" &&
                `Telah menyelesaikan hafalan ${formData.completedJuz.length} Juz Al-Quran Al-Karim dengan bacaan yang baik dan benar.`}
              {formData.certificateType === "TAHFIDZ_30_JUZ" &&
                "Telah menyelesaikan hafalan 30 Juz Al-Quran Al-Karim (Khatam) dan berhak menyandang gelar HAFIDZ/HAFIDZAH."}
              {formData.certificateType === "SANAD_QIRAAH" &&
                `Telah menyelesaikan bacaan Al-Quran dengan ${formData.qiraahType} dan berhak menerima sanad.`}
            </p>
          </div>

          {/* Grade & Qiraah */}
          <div className="flex gap-8 mb-4 text-center">
            <div>
              <p className="text-xs opacity-70">Predikat</p>
              <p
                className="text-base font-semibold"
                style={{ color: accentColor }}
              >
                {formData.grade}
              </p>
            </div>
            <div>
              <p className="text-xs opacity-70">Qira&apos;ah</p>
              <p
                className="text-base font-semibold"
                style={{ color: accentColor }}
              >
                {formData.qiraahType}
              </p>
            </div>
            <div>
              <p className="text-xs opacity-70">Jumlah Juz</p>
              <p
                className="text-base font-semibold"
                style={{ color: accentColor }}
              >
                {formData.completedJuz.length} Juz
              </p>
            </div>
          </div>

          {/* Sanad Chain (only for full Sanad) */}
          {isSanad && formData.sanadChain && (
            <div className="text-center mb-4 max-w-xl">
              <p className="text-xs opacity-70 mb-1">Silsilah Sanad:</p>
              <p
                className="text-xs leading-relaxed opacity-90"
                style={{ fontFamily: "'Amiri', serif" }}
              >
                {formData.sanadChain}
              </p>
            </div>
          )}

          {/* The musyrif who guided the memorisation. Printed so the paper and
              the downloaded PDF (which reads the same value back from the mint
              metadata) carry the same line. */}
          {formData.musyrifName && (
            <p className="text-sm mb-4">
              Musyrif:{" "}
              <span className="font-semibold">{formData.musyrifName}</span>
            </p>
          )}

          {/* Date */}
          <p className="text-sm mb-6">
            Ditetapkan di {LETTERHEAD.city},{" "}
            {safeFormat(new Date(formData.tanggalSertifikat), "d MMMM yyyy", {
              locale: idLocale,
            })}
          </p>

          {/* Signatures — as on the yayasan's own signed certificate: the
              Direktur Tahfidz of the santri's side, the Pimpinan Pesantren,
              and the Ketua Yayasan who acknowledges. Names from the published
              structure (office-holders.ts), never typed into this page. */}
          <div className="flex justify-center gap-16 w-full">
            {certificateSigners(selectedStudent?.gender).map((signer) => (
              <div key={signer.role} className="text-center">
                <p className="text-xs">{signer.lead ?? "\u00a0"}</p>
                <p className="text-xs mb-12">{signer.role}</p>
                <div
                  className="w-48 border-b mb-1"
                  style={{ borderColor: accentColor }}
                />
                <p className="text-sm font-semibold" data-testid="cert-signer">
                  {signer.name}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Watermark */}
        <div className="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none">
          <div
            className="text-[200px]"
            style={{
              fontFamily: "'Noto Naskh Arabic', serif",
              color: accentColor,
            }}
          >
            ۞
          </div>
        </div>
      </div>
    );
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Award className="h-6 w-6 text-primary" />
              Sertifikat & Sanad Tahfidz
            </h1>
            <p className="text-muted-foreground">
              Generate sertifikat hafalan Al-Qur&apos;an dan sanad resmi
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="default"
              onClick={handlePrint}
              disabled={!selectedStudent || isGenerating}
              className="transition-all hover:shadow-md hover:-translate-y-0.5"
            >
              <Printer className="h-4 w-4 mr-2" />
              {isGenerating ? "Generating..." : "Cetak Sertifikat"}
            </Button>
          </div>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <div
            className={`flex items-center gap-2 px-4 py-2 rounded-full ${
              activeTab === "select-student"
                ? "bg-primary text-primary-foreground"
                : selectedStudent
                  ? "bg-green-100 text-green-800"
                  : "bg-muted"
            }`}
          >
            {selectedStudent ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <span className="w-5 h-5 rounded-full bg-current/20 flex items-center justify-center text-xs">
                1
              </span>
            )}
            <span className="text-sm font-medium">Pilih Santri</span>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground hidden sm:block" />
          <div
            className={`flex items-center gap-2 px-4 py-2 rounded-full ${
              activeTab === "select-type"
                ? "bg-primary text-primary-foreground"
                : formData.certificateType && selectedStudent
                  ? "bg-green-100 text-green-800"
                  : "bg-muted"
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-current/20 flex items-center justify-center text-xs">
              2
            </span>
            <span className="text-sm font-medium">Pilih Jenis</span>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground hidden sm:block" />
          <div
            className={`flex items-center gap-2 px-4 py-2 rounded-full ${
              activeTab === "fill-details"
                ? "bg-primary text-primary-foreground"
                : "bg-muted"
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-current/20 flex items-center justify-center text-xs">
              3
            </span>
            <span className="text-sm font-medium">Isi Detail</span>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="hidden">
            <TabsTrigger value="select-student">Pilih Santri</TabsTrigger>
            <TabsTrigger value="select-type">Pilih Jenis</TabsTrigger>
            <TabsTrigger value="fill-details">Isi Detail</TabsTrigger>
          </TabsList>

          {/* Step 1: Select Student */}
          <TabsContent value="select-student" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Pilih Santri
                </CardTitle>
                <CardDescription>
                  Cari dan pilih santri yang akan menerima sertifikat tahfidz
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="glass-card p-4 rounded-xl flex flex-col gap-4 md:flex-row mb-6 shadow-sm border-none">
                  <Select
                    value={selectedUnitId}
                    onValueChange={(value) => {
                      setSelectedUnitId(value);
                      setSelectedClassId("");
                    }}
                  >
                    <SelectTrigger className="w-full md:w-48 bg-background/50 backdrop-blur-sm border-muted-foreground/20">
                      <SelectValue placeholder="Pilih unit" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Semua Unit</SelectItem>
                      {units.map((unit) => (
                        <SelectItem key={unit.id} value={unit.id}>
                          {unit.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={selectedClassId}
                    onValueChange={setSelectedClassId}
                    disabled={!selectedUnitId}
                  >
                    <SelectTrigger className="w-full md:w-48 bg-background/50 backdrop-blur-sm border-muted-foreground/20">
                      <SelectValue placeholder="Pilih kelas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Semua Kelas</SelectItem>
                      {classes.map((cls) => (
                        <SelectItem key={cls.id} value={cls.id}>
                          {cls.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Cari nama atau NIS..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 bg-background/50 backdrop-blur-sm border-muted-foreground/20"
                    />
                  </div>
                </div>

                {studentsLoading ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                      <Skeleton key={i} className="h-24" />
                    ))}
                  </div>
                ) : students.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Tidak ada santri ditemukan</p>
                    <p className="text-sm">
                      Gunakan filter untuk mencari santri
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {students.map((student) => {
                      const initials = student.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .substring(0, 2)
                        .toUpperCase();
                      const isSelected = selectedStudent?.id === student.id;

                      return (
                        <div
                          key={student.id}
                          className={`
                            flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-all
                            ${
                              isSelected
                                ? "bg-primary/10 border-primary ring-2 ring-primary"
                                : "hover:bg-muted hover:border-muted-foreground/50"
                            }
                          `}
                          onClick={() => handleSelectStudent(student)}
                        >
                          <Avatar className="h-12 w-12">
                            <AvatarFallback className="bg-emerald-100 text-emerald-700">
                              {initials}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">
                              {student.name}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              NIS: {student.nis}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {student.currentClass?.name || "-"} •{" "}
                              {student.unit?.name}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Step 2: Select Certificate Type */}
          <TabsContent value="select-type" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5" />
                  Pilih Jenis Sertifikat
                </CardTitle>
                <CardDescription>
                  {selectedStudent && (
                    <span>
                      Untuk: <strong>{selectedStudent.name}</strong> (
                      {selectedStudent.nis})
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {CERTIFICATE_TYPES.map((type) => {
                    const isSelected = formData.certificateType === type.id;

                    return (
                      <div
                        key={type.id}
                        className={`
                          p-6 rounded-xl border-2 cursor-pointer transition-all
                          ${
                            isSelected
                              ? "border-primary bg-primary/5 shadow-lg"
                              : "border-muted hover:border-muted-foreground/50 hover:bg-muted/50"
                          }
                        `}
                        onClick={() => handleSelectType(type.id)}
                      >
                        <div
                          className={`w-12 h-12 rounded-lg ${type.color} flex items-center justify-center mb-4 text-2xl`}
                        >
                          {type.icon}
                        </div>
                        <h3 className="font-semibold mb-1">{type.label}</h3>
                        <p className="text-xs text-muted-foreground">
                          {type.description}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Step 3: Fill Details */}
          <TabsContent value="fill-details" className="space-y-4">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Form */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Star className="h-5 w-5" />
                    Detail Sertifikat
                  </CardTitle>
                  <CardDescription>
                    Isi informasi untuk sertifikat tahfidz
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Student Info */}
                  {selectedStudent && (
                    <div className="p-4 bg-muted rounded-lg flex items-center gap-3">
                      <Avatar className="h-12 w-12">
                        <AvatarFallback className="bg-emerald-100 text-emerald-700">
                          {selectedStudent.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .substring(0, 2)
                            .toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{selectedStudent.name}</p>
                        <p className="text-sm text-muted-foreground">
                          NIS: {selectedStudent.nis} •{" "}
                          {selectedStudent.unit?.name}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Certificate Type Badge */}
                  {selectedCertType && (
                    <Badge className={selectedCertType.color}>
                      {selectedCertType.label}
                    </Badge>
                  )}

                  {/* Tanggal Sertifikat */}
                  <div className="space-y-2">
                    <Label>Tanggal Sertifikat</Label>
                    <Input
                      type="date"
                      value={formData.tanggalSertifikat}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          tanggalSertifikat: e.target.value,
                        })
                      }
                    />
                  </div>

                  {/* Musyrif/ah */}
                  <div className="space-y-2">
                    <Label>Nama Musyrif/ah</Label>
                    <Input
                      value={formData.musyrifName}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          musyrifName: e.target.value,
                        })
                      }
                      placeholder="Nama musyrif yang membimbing"
                    />
                  </div>

                  {/* Grade */}
                  <div className="space-y-2">
                    <Label>Predikat</Label>
                    <Select
                      value={formData.grade}
                      onValueChange={(value) =>
                        setFormData({ ...formData, grade: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GRADE_OPTIONS.map((grade) => (
                          <SelectItem key={grade} value={grade}>
                            {grade}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Qiraah Type */}
                  <div className="space-y-2">
                    <Label>Qira&apos;ah</Label>
                    <Select
                      value={formData.qiraahType}
                      onValueChange={(value) =>
                        setFormData({ ...formData, qiraahType: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {QIRAAH_TYPES.map((qiraah) => (
                          <SelectItem key={qiraah} value={qiraah}>
                            {qiraah}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Juz Selection */}
                  <div className="space-y-2">
                    <Label>
                      Juz yang Dihafalkan ({formData.completedJuz.length} Juz)
                    </Label>
                    <div className="grid grid-cols-6 gap-2 max-h-40 overflow-y-auto p-2 border rounded-md">
                      {JUZ_NAMES.map((juz) => (
                        <button
                          key={juz.number}
                          type="button"
                          onClick={() => handleJuzToggle(juz.number)}
                          className={`
                            w-full aspect-square rounded-md text-sm font-medium transition-all
                            ${
                              formData.completedJuz.includes(juz.number)
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted hover:bg-muted/80"
                            }
                          `}
                          title={juz.name}
                        >
                          {juz.number}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Sanad Chain (for full Sanad) */}
                  {(formData.certificateType === "TAHFIDZ_30_JUZ" ||
                    formData.certificateType === "SANAD_QIRAAH") && (
                    <div className="space-y-2">
                      <Label>Silsilah Sanad (Opsional)</Label>
                      <Textarea
                        value={formData.sanadChain}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            sanadChain: e.target.value,
                          })
                        }
                        placeholder="Ust. Muhammad Ridwan → Syeikh Abdullah → ..."
                        rows={3}
                      />
                    </div>
                  )}

                  {/* Notes */}
                  <div className="space-y-2">
                    <Label>Catatan Tambahan</Label>
                    <Textarea
                      value={formData.notes}
                      onChange={(e) =>
                        setFormData({ ...formData, notes: e.target.value })
                      }
                      placeholder="Catatan tambahan (opsional)"
                      rows={2}
                    />
                  </div>

                  <div className="flex gap-2 pt-4">
                    <Button
                      variant="outline"
                      onClick={() => setActiveTab("select-type")}
                    >
                      Kembali
                    </Button>
                    <Button
                      onClick={handlePrint}
                      className="flex-1"
                      disabled={isGenerating}
                    >
                      <Printer className="h-4 w-4 mr-2" />
                      {isGenerating ? "Generating..." : "Cetak Sertifikat"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Preview */}
              <Card>
                <CardHeader>
                  <CardTitle>Preview Sertifikat</CardTitle>
                  <CardDescription>
                    Tampilan sertifikat yang akan dicetak (ukuran A4 landscape)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="border rounded-lg overflow-hidden bg-gray-100">
                    <div className="transform scale-[0.35] origin-top-left w-[286%] -mb-[65%]">
                      {renderCertificatePreview()}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* Hidden Print Area */}
        <div className="hidden">{renderCertificatePreview()}</div>
      </div>
    </MainLayout>
  );
}
