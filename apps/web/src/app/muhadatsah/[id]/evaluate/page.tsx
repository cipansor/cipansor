"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import {
  ArrowLeft,
  MessageSquare,
  Save,
  Star,
  Clock,
  Languages,
  Users,
  MessageCircle,
  BookOpen,
  FileText,
  Volume2,
  CheckCircle,
} from "lucide-react";
import { toast } from "sonner";

import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Slider } from "@/components/ui/slider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  useMuhadatsahDetail,
  useEvaluateMuhadatsah,
  getLanguageLabel,
  getGradeColor,
} from "@/hooks/use-muhadatsah";
import { muhadatsahAccessOf } from "@/lib/muhadatsah-access";
import { useAuthStore } from "@/stores/auth";

// Scoring components for Muhadatsah
const SCORING_COMPONENTS = [
  {
    key: "fluency",
    label: "Kelancaran",
    labelEn: "Fluency",
    description: "Kemampuan berbicara dengan lancar tanpa terlalu banyak jeda",
    icon: MessageCircle,
  },
  {
    key: "grammar",
    label: "Tata Bahasa",
    labelEn: "Grammar",
    description: "Ketepatan penggunaan struktur kalimat dan kaidah bahasa",
    icon: BookOpen,
  },
  {
    key: "vocabulary",
    label: "Kosa Kata",
    labelEn: "Vocabulary",
    description: "Penggunaan kosa kata yang tepat dan beragam",
    icon: FileText,
  },
  {
    key: "pronunciation",
    label: "Pengucapan",
    labelEn: "Pronunciation",
    description: "Kejelasan dan ketepatan pengucapan kata",
    icon: Volume2,
  },
];

// Calculate grade from score
const calculateGrade = (score: number): { grade: string; label: string } => {
  if (score >= 86) return { grade: "A", label: "Mumtaz (Istimewa)" };
  if (score >= 71) return { grade: "B", label: "Jayyid Jiddan (Sangat Baik)" };
  if (score >= 56) return { grade: "C", label: "Jayyid (Baik)" };
  if (score >= 41) return { grade: "D", label: "Maqbul (Cukup)" };
  return { grade: "E", label: "Rasib (Perlu Peningkatan)" };
};

// The four components the API stores on the session (one rubric per session).
interface RubricScores {
  fluency: number;
  grammar: number;
  vocabulary: number;
  pronunciation: number;
}

export default function EvaluateMuhadatsahPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [scores, setScores] = useState<RubricScores>({
    fluency: 75,
    grammar: 75,
    vocabulary: 75,
    pronunciation: 75,
  });

  const [duration, setDuration] = useState("10");
  const [feedback, setFeedback] = useState("");

  const { data: muhadatsah, isLoading, error } = useMuhadatsahDetail(id);
  const { canWrite } = muhadatsahAccessOf(useAuthStore((s) => s.user));
  const evaluateMuhadatsah = useEvaluateMuhadatsah();

  // The API averages the same four components into the session's totalScore,
  // so this is the number the session will carry.
  const sessionScore = useMemo(() => {
    const total = Object.values(scores).reduce((a, b) => a + b, 0);
    return Math.round(total / 4);
  }, [scores]);

  const sessionGrade = calculateGrade(sessionScore);

  // Handle submit
  const handleSubmit = async () => {
    try {
      const input = {
        fluencyScore: scores.fluency,
        grammarScore: scores.grammar,
        vocabularyScore: scores.vocabulary,
        pronunciationScore: scores.pronunciation,
        feedback,
        duration: parseInt(duration),
      };

      await evaluateMuhadatsah.mutateAsync({
        id,
        input,
      });

      toast.success("Penilaian muhadatsah berhasil disimpan");
      router.push(`/muhadatsah/${id}`);
    } catch (error) {
      toast.error("Gagal menyimpan penilaian");
    }
  };

  if (!canWrite) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center py-12">
          <h2 className="text-lg font-semibold mb-2">Tidak Ada Akses</h2>
          <p className="text-muted-foreground mb-4">
            Anda tidak memiliki izin untuk menilai muhadatsah.
          </p>
          <Button asChild>
            <Link href={`/muhadatsah/${id}`}>Kembali ke Detail</Link>
          </Button>
        </div>
      </MainLayout>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <MainLayout>
        <div className="mb-6">
          <Skeleton className="h-4 w-24 mb-4" />
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 space-y-6">
            <Skeleton className="h-[400px] w-full rounded-lg" />
          </div>
          <div>
            <Skeleton className="h-[300px] w-full rounded-lg" />
          </div>
        </div>
      </MainLayout>
    );
  }

  // Error state
  if (error || !muhadatsah) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center py-12">
          <h2 className="text-lg font-semibold mb-2">Data Tidak Ditemukan</h2>
          <p className="text-muted-foreground mb-4">
            Muhadatsah yang Anda cari tidak ditemukan.
          </p>
          <Button asChild>
            <Link href="/muhadatsah">Kembali ke Daftar</Link>
          </Button>
        </div>
      </MainLayout>
    );
  }

  const hasPartner = !!muhadatsah.partner;

  // Render scoring sliders for a student
  const renderScoringSliders = (
    scores: RubricScores,
    setScores: React.Dispatch<React.SetStateAction<RubricScores>>,
  ) => (
    <div className="space-y-6">
      {SCORING_COMPONENTS.map((component) => {
        const score = scores[component.key as keyof RubricScores];
        const gradeInfo = calculateGrade(score);
        return (
          <div key={component.key} className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <component.icon className="h-4 w-4 text-primary" />
                <Label className="font-medium">
                  {component.label} ({component.labelEn})
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{score}</span>
                <Badge className={getGradeColor(gradeInfo.grade)}>
                  {gradeInfo.grade}
                </Badge>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {component.description}
            </p>
            <Slider
              value={[score]}
              min={0}
              max={100}
              step={1}
              onValueChange={(value) =>
                setScores((prev) => ({ ...prev, [component.key]: value[0] }))
              }
              className="py-2"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0 (Rasib)</span>
              <span>50 (Maqbul)</span>
              <span>100 (Mumtaz)</span>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <MainLayout>
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href={`/muhadatsah/${id}`}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Kembali
          </Link>
        </Button>
        <PageHeader
          title="Penilaian Muhadatsah"
          description={`Evaluasi sesi percakapan ${getLanguageLabel(muhadatsah.language)}`}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Main Content - Scoring */}
        <div className="md:col-span-2 space-y-6">
          {/* Participants Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Peserta
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={`grid gap-4 ${hasPartner ? "md:grid-cols-2" : ""}`}
              >
                {/* Student 1 */}
                <div className="flex items-center gap-3 p-3 border rounded-lg">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback>
                      {muhadatsah.student?.name
                        ?.split(" ")
                        .map((n: string) => n[0])
                        .join("")
                        .slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="font-medium">{muhadatsah.student?.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {muhadatsah.student?.nis}
                    </p>
                  </div>
                  <Badge variant="outline">Santri 1</Badge>
                </div>

                {/* Partner */}
                {hasPartner && (
                  <div className="flex items-center gap-3 p-3 border rounded-lg">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback>
                        {muhadatsah.partner?.name
                          ?.split(" ")
                          .map((n: string) => n[0])
                          .join("")
                          .slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <p className="font-medium">{muhadatsah.partner?.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {muhadatsah.partner?.nis}
                      </p>
                    </div>
                    <Badge variant="outline">Partner</Badge>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Scoring Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="h-5 w-5 text-yellow-500" />
                Komponen Penilaian
              </CardTitle>
              <CardDescription>
                Geser slider untuk menilai sesi ini (0-100). Nilai berlaku untuk{" "}
                {hasPartner ? "kedua peserta" : "peserta"} dan tersimpan sebagai
                nilai sesi.
              </CardDescription>
            </CardHeader>
            <CardContent>{renderScoringSliders(scores, setScores)}</CardContent>
          </Card>

          {/* Duration & Feedback */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Informasi Tambahan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Duration */}
              <div className="space-y-2">
                <Label htmlFor="duration" className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Durasi Percakapan
                </Label>
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 menit</SelectItem>
                    <SelectItem value="10">10 menit</SelectItem>
                    <SelectItem value="15">15 menit</SelectItem>
                    <SelectItem value="20">20 menit</SelectItem>
                    <SelectItem value="25">25 menit</SelectItem>
                    <SelectItem value="30">30 menit</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Feedback */}
              <div className="space-y-2">
                <Label htmlFor="feedback">Catatan & Feedback</Label>
                <Textarea
                  id="feedback"
                  placeholder="Berikan catatan atau masukan untuk santri..."
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  className="min-h-[120px]"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - Summary */}
        <div className="space-y-6">
          {/* Session Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Info Sesi</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Languages className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  {getLanguageLabel(muhadatsah.language)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  {format(
                    new Date(muhadatsah.scheduledAt),
                    "dd MMMM yyyy, HH:mm",
                    {
                      locale: localeId,
                    },
                  )}
                </span>
              </div>
              {muhadatsah.topic && (
                <div className="flex items-start gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <span className="text-sm">{muhadatsah.topic}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Score Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Star className="h-5 w-5 text-yellow-500" />
                Ringkasan Nilai
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center p-4 bg-primary/10 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">Nilai Sesi</p>
                <div className="flex items-center justify-center gap-3">
                  <span className="text-4xl font-bold">{sessionScore}</span>
                  <Badge
                    className={`text-lg ${getGradeColor(sessionGrade.grade)}`}
                  >
                    {sessionGrade.grade}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  {sessionGrade.label}
                </p>
              </div>

              {/* Grade Legend */}
              <div className="grid grid-cols-5 gap-1 text-center text-xs">
                {[
                  { grade: "A", range: "86+" },
                  { grade: "B", range: "71-85" },
                  { grade: "C", range: "56-70" },
                  { grade: "D", range: "41-55" },
                  { grade: "E", range: "0-40" },
                ].map((g) => (
                  <div key={g.grade} className="p-1 bg-muted rounded">
                    <span className="font-bold">{g.grade}</span>
                    <p className="text-muted-foreground">{g.range}</p>
                  </div>
                ))}
              </div>

              <Separator />

              {/* Actions */}
              <div className="space-y-2">
                <Button
                  className="w-full"
                  onClick={handleSubmit}
                  disabled={evaluateMuhadatsah.isPending}
                >
                  {evaluateMuhadatsah.isPending ? (
                    <>
                      <span className="animate-spin mr-2">⏳</span>
                      Menyimpan...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Simpan Penilaian
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => router.back()}
                >
                  Batal
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Tips */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">📝 Panduan Penilaian</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>
                  <strong>Kelancaran:</strong> Tidak banyak jeda, alur lancar
                </li>
                <li>
                  <strong>Tata Bahasa:</strong> Struktur kalimat tepat
                </li>
                <li>
                  <strong>Kosa Kata:</strong> Kata-kata beragam & tepat
                </li>
                <li>
                  <strong>Pengucapan:</strong> Jelas dan mudah dipahami
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </MainLayout>
  );
}
