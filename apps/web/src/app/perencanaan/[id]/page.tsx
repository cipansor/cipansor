"use client";
import { useState } from "react";
import { safeFormat } from "@/lib/date";
import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { useParams, useRouter } from "next/navigation";

import { id as localeId } from "date-fns/locale";
import {
  usePlan,
  useApprovePlan,
  usePlanRealizationTrend,
  PLAN_STATUS_LABEL,
  PLAN_REVIEW_STAGE_LABEL,
  planTierLabel,
} from "@/hooks/use-perencanaan";
import { useAuthStore } from "@/stores/auth";
import { getPrimaryRoleCode } from "@/lib/rbac";
import { PageHeader } from "@/components/shared/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Target,
  Calendar,
  CheckCircle2,
  TrendingUp,
  Activity,
  BarChart,
  ShieldAlert,
  ClipboardCheck,
  ArrowRight,
  Wallet,
  PieChart,
  LayoutDashboard,
} from "lucide-react";
import { RiskLevelBadge } from "@/components/risk/risk-badges";
import Link from "next/link";
import { ActivityDialog } from "./activity-dialog";
import { ObjectiveDialog } from "./objective-dialog";
import { MainLayout } from "@/components/layout";
import { IndicatorRow, ActivityCard, FundingSection } from "./plan-sections";
import { ReviewPanel } from "./review-panel";

function PerencanaanDetailPageContent() {
  const params = useParams();
  const router = useRouter();
  const planId = params.id as string;

  const { data: plan, isLoading } = usePlan(planId);
  const { data: realizationTrend } = usePlanRealizationTrend(planId);
  const approvePlan = useApprovePlan();
  const user = useAuthStore((s) => s.user);
  const roleCode = getPrimaryRoleCode(user);

  const [objectiveDialogOpen, setObjectiveDialogOpen] = useState(false);
  const [activityDialogOpen, setActivityDialogOpen] = useState(false);
  const [selectedObjectiveId, setSelectedObjectiveId] = useState<string>("");
  const [editActivityData, setEditActivityData] = useState<any>(null);

  if (isLoading) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="container mx-auto py-20 text-center">
        <h2 className="text-2xl font-bold mb-2">Rencana Tidak Ditemukan</h2>
        <Button onClick={() => router.back()}>Kembali</Button>
      </div>
    );
  }

  const handleApprove = async () => {
    if (
      confirm(
        `Sahkan ${planTierLabel(plan)}? Setelah disahkan, RKA ini menjadi jangkar Perjanjian Kinerja kepala unit.`,
      )
    ) {
      await approvePlan.mutateAsync(plan.id);
    }
  };

  const statusColor =
    {
      DRAFT: "bg-slate-100 text-slate-700",
      PROPOSED: "bg-yellow-100 text-yellow-700",
      REVIEW: "bg-yellow-100 text-yellow-700",
      APPROVED: "bg-green-100 text-green-700",
      IN_PROGRESS: "bg-blue-100 text-blue-700",
      ACTIVE: "bg-blue-100 text-blue-700",
      COMPLETED: "bg-purple-100 text-purple-700",
    }[plan.status as string] || "bg-gray-100 text-gray-700";

  return (
    <div className="container mx-auto py-6 space-y-6">
      <Button
        variant="ghost"
        className="mb-2 -ml-4"
        onClick={() => router.back()}
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Kembali
      </Button>

      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <PageHeader
              title={plan.title}
              description={
                plan.parent
                  ? `${planTierLabel(plan)} · menginduk pada ${plan.parent.title}`
                  : planTierLabel(plan)
              }
            />
            <Badge
              className={`${statusColor} hover:${statusColor} ml-2 mt-[-24px]`}
            >
              {PLAN_STATUS_LABEL[plan.status] ?? plan.status}
            </Badge>
            {plan.reviewStage && plan.reviewStage !== "DITETAPKAN" && (
              <Badge
                variant="outline"
                className="mt-[-24px] border-amber-400 text-amber-700 dark:text-amber-300"
              >
                {PLAN_REVIEW_STAGE_LABEL[plan.reviewStage]}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Only an RKA Unit is approved with one button, and only by Ketua
              Pengurus. Yayasan documents go through the panel below. */}
          {plan.unitId &&
            roleCode === "YAYASAN_KETUA" &&
            (plan.status === "DRAFT" || plan.status === "PROPOSED") && (
              <Button onClick={handleApprove} disabled={approvePlan.isPending}>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Sahkan {planTierLabel(plan)}
              </Button>
            )}
        </div>
      </div>

      {plan.unitId === null && <ReviewPanel plan={plan} roleCode={roleCode} />}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Target className="w-5 h-5" /> Deskripsi Perencanaan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-sm rounded-md leading-relaxed">
              {plan.description || "Belum ada deskripsi."}
            </p>

            {(plan as any).vision && (
              <div className="rounded-md border-l-4 border-primary/60 bg-primary/5 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-primary/80">
                  Visi
                </p>
                <p className="text-sm italic mt-1 leading-relaxed">
                  “{(plan as any).vision}”
                </p>
              </div>
            )}

            {(plan as any).mission && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Misi
                </p>
                <ol className="list-decimal ml-5 space-y-1 text-sm leading-relaxed">
                  {String((plan as any).mission)
                    .split("\n")
                    .filter(Boolean)
                    .map((m: string, i: number) => (
                      <li key={i}>{m}</li>
                    ))}
                </ol>
              </div>
            )}

            <div className="pt-4 border-t space-y-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-semibold flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" /> Progres Capaian Target
                  </span>
                  <span className="text-sm font-bold text-primary">
                    {plan.progress}%
                  </span>
                </div>
                <Progress value={plan.progress} className="h-3" />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-semibold flex items-center gap-2">
                    <PieChart className="w-4 h-4" /> Realisasi Anggaran
                  </span>
                  <span className="text-sm font-bold text-emerald-600">
                    {Math.round(plan.financialProgress || 0)}%
                  </span>
                </div>
                <Progress
                  value={plan.financialProgress}
                  className="h-3 bg-slate-100"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Dihitung otomatis berdasarkan Jurnal Akuntansi yang relevan.
                </p>
              </div>

              {realizationTrend && realizationTrend.trend.length > 0 && (
                <div>
                  <span className="text-sm font-semibold">
                    Tren Realisasi Bulanan
                  </span>
                  <div className="h-[180px] mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsLineChart data={realizationTrend.trend}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                        <YAxis
                          tick={{ fontSize: 10 }}
                          tickFormatter={(v: number) =>
                            `${Math.round(v / 1000000)}jt`
                          }
                        />
                        <RechartsTooltip
                          formatter={(value) =>
                            new Intl.NumberFormat("id-ID", {
                              style: "currency",
                              currency: "IDR",
                              minimumFractionDigits: 0,
                            }).format(Number(value))
                          }
                        />
                        <Line
                          type="monotone"
                          dataKey="realization"
                          name="Realisasi"
                          stroke="#10b981"
                          strokeWidth={2}
                        />
                      </RechartsLineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="w-5 h-5" /> Detail Waktu & Dana
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Unit Terkait</span>
              {/* Hardcoded "Semua Unit (Demo)" until now — a placeholder shipped
                  as a fact, and wrong for every unit-owned RKA. */}
              <span className="font-medium">
                {plan.unit?.name ?? "Yayasan (seluruh unit)"}
              </span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Anggaran (Estimasi)</span>
              <span className="font-medium">
                {plan.budget
                  ? `Rp ${Number(plan.budget).toLocaleString("id-ID")}`
                  : "Belum ditetapkan"}
              </span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Tgl Mulai</span>
              <span className="font-medium">
                {plan.startDate
                  ? safeFormat(new Date(plan.startDate), "dd MMM yyyy", {
                      locale: localeId,
                    })
                  : "-"}
              </span>
            </div>
            <div className="flex justify-between pb-2">
              <span className="text-muted-foreground">Tgl Selesai</span>
              <span className="font-medium">
                {plan.endDate
                  ? safeFormat(new Date(plan.endDate), "dd MMM yyyy", {
                      locale: localeId,
                    })
                  : "-"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="objectives">
        <div className="flex items-center justify-between mb-4">
          <TabsList className="bg-slate-100/50">
            <TabsTrigger value="objectives" className="flex items-center gap-2">
              <Target className="w-4 h-4" /> Tujuan & Sasaran (IKI)
            </TabsTrigger>
            <TabsTrigger value="activities" className="flex items-center gap-2">
              <Activity className="w-4 h-4" /> Program & Kegiatan
            </TabsTrigger>
            <TabsTrigger
              value="funding"
              className="flex items-center gap-2 text-emerald-700 data-[state=active]:text-emerald-800"
            >
              <Wallet className="w-4 h-4" /> Anggaran & Pendanaan
            </TabsTrigger>
            <TabsTrigger
              value="risks"
              className="flex items-center gap-2 text-rose-600 data-[state=active]:text-rose-700"
            >
              <ShieldAlert className="w-4 h-4" /> Faktor Risiko
            </TabsTrigger>
            <TabsTrigger
              value="audits"
              className="flex items-center gap-2 text-blue-600 data-[state=active]:text-blue-700"
            >
              <ClipboardCheck className="w-4 h-4" /> Jejak Audit & Temuan
            </TabsTrigger>
            <TabsTrigger
              value="strategy-map"
              className="flex items-center gap-2 text-indigo-600 data-[state=active]:text-indigo-700"
            >
              <LayoutDashboard className="w-4 h-4" /> Peta Strategi
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="objectives">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
              <CardTitle className="text-lg">
                Daftar Sasaran Strategis
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setObjectiveDialogOpen(true)}
              >
                + Tambah Sasaran
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {plan.objectives && plan.objectives.length > 0 ? (
                <div className="divide-y">
                  {plan.objectives.map((obj: any) => (
                    <div
                      key={obj.id}
                      className="p-4 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h4 className="font-semibold text-base">
                            {obj.title}
                          </h4>
                          <span className="text-xs text-muted-foreground">
                            Bobot: {obj.weight}% | Prioritas: {obj.priority}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-bold text-primary">
                            {obj.progress}%
                          </span>
                          <Progress
                            value={obj.progress}
                            className="h-2 w-24 mt-1"
                          />
                        </div>
                      </div>

                      {obj.indicators && obj.indicators.length > 0 && (
                        <div className="mt-3 bg-slate-50 border rounded-md p-3">
                          <h5 className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider flex items-center gap-1">
                            <BarChart className="w-3 h-3" /> Indikator Kinerja
                            (IKU/IUP)
                          </h5>
                          <div className="space-y-3 divide-y divide-slate-100 [&>*+*]:pt-3">
                            {obj.indicators.map((ind: any) => (
                              <IndicatorRow key={ind.id} indicator={ind} />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Target className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>Belum ada sasaran strategis yang ditambahkan.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activities">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
              <CardTitle className="text-lg">
                Daftar Program & Kegiatan
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {plan.objectives && plan.objectives.length > 0 ? (
                <div className="divide-y">
                  {plan.objectives.map((obj: any) => (
                    <div key={obj.id} className="p-4">
                      <div className="flex items-center gap-2 mb-4 bg-slate-50 p-2 rounded border">
                        <Target className="w-4 h-4 text-primary" />
                        <span className="text-sm font-semibold">
                          {obj.title}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto h-7 text-xs"
                          onClick={() => {
                            setSelectedObjectiveId(obj.id);
                            setEditActivityData(null);
                            setActivityDialogOpen(true);
                          }}
                        >
                          + Tambah Kegiatan
                        </Button>
                      </div>

                      {obj.activities && obj.activities.length > 0 ? (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 ml-4">
                          {obj.activities.map((act: any) => (
                            <ActivityCard key={act.id} act={act} />
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic ml-6 py-2">
                          Belum ada kegiatan untuk sasaran ini.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>
                    Tambahkan sasaran strategis terlebih dahulu sebelum
                    memetakan kegiatan.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="funding">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-lg flex items-center gap-2">
                <Wallet className="w-5 h-5" /> Anggaran & Proyeksi Pendanaan
              </CardTitle>
              <CardDescription>
                Rekap belanja dan proyeksi pendapatan per sumber dana (RKA).
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              {(plan as any).fundingSources &&
              (plan as any).fundingSources.length > 0 ? (
                <FundingSection
                  sources={(plan as any).fundingSources}
                  totalBelanja={Number(plan.budget || 0)}
                />
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Wallet className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>
                    Proyeksi pendanaan per sumber dana disajikan pada dokumen
                    RKA tahunan.
                  </p>
                  <p className="text-sm mt-1">
                    Total belanja terencana: Rp{" "}
                    {Number(plan.budget || 0).toLocaleString("id-ID")}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="risks">
          <Card className="border-rose-100 shadow-sm">
            <CardHeader className="bg-rose-50/50 border-b pb-4">
              <CardTitle className="text-lg flex items-center gap-2 text-rose-800">
                <ShieldAlert className="w-5 h-5" /> Identifikasi & Pemetaan
                Risiko
              </CardTitle>
              <CardDescription>
                Daftar risiko yang berpotensi menghambat eksekusi Rencana
                Strategis ini.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              {(plan as any).risks && (plan as any).risks.length > 0 ? (
                <div className="space-y-4">
                  {(plan as any).risks.map((risk: any) => (
                    <div
                      key={risk.id}
                      className="p-4 border rounded-lg bg-white flex justify-between items-center"
                    >
                      <div className="flex items-center gap-3">
                        <RiskLevelBadge level={risk.riskLevel || "UNKNOWN"} />
                        <div>
                          <p className="font-medium text-slate-800">
                            {risk.code} - {risk.category}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {risk.status}
                          </p>
                        </div>
                      </div>
                      <Link href={`/risk-management/${risk.id}`}>
                        <Button size="sm" variant="ghost">
                          Lihat Detail Mitigasi{" "}
                          <ArrowRight className="w-4 h-4 ml-1" />
                        </Button>
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <ShieldAlert className="w-12 h-12 mx-auto mb-3 opacity-30 text-rose-400" />
                  <p>Belum ada risiko yang dipetakan pada rencana ini.</p>
                </div>
              )}
              <div className="mt-4 flex justify-end">
                <Link
                  href={`/risk-management/create?strategicPlanId=${plan.id}`}
                >
                  <Button
                    variant="outline"
                    className="border-rose-200 text-rose-600 hover:bg-rose-50"
                  >
                    Identifikasi Risiko Baru
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="strategy-map">
          <Card className="border-indigo-100 shadow-sm">
            <CardHeader className="bg-indigo-50/50 border-b pb-4">
              <CardTitle className="text-lg flex items-center gap-2 text-indigo-800">
                <LayoutDashboard className="w-5 h-5" /> Balanced Scorecard Peta
                Strategi
              </CardTitle>
              <CardDescription>
                Visualisasi aliran strategi dari pembelajaran hingga hasil
                finansial.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <div className="flex flex-col gap-6 max-w-4xl mx-auto">
                {["FINANCIAL", "CUSTOMER", "PROCESS", "LEARNING"].map((p) => {
                  const objectives =
                    plan.objectives?.filter((o: any) => o.perspective === p) ||
                    [];
                  const colors =
                    {
                      FINANCIAL:
                        "bg-emerald-50 border-emerald-200 text-emerald-800",
                      CUSTOMER: "bg-blue-50 border-blue-200 text-blue-800",
                      PROCESS: "bg-amber-50 border-amber-200 text-amber-800",
                      LEARNING:
                        "bg-indigo-50 border-indigo-200 text-indigo-800",
                    }[p] || "bg-slate-50 border-slate-200";

                  return (
                    <div
                      key={p}
                      className={`p-4 rounded-xl border-2 ${colors} relative`}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="font-bold text-sm uppercase tracking-widest opacity-70">
                          {p}
                        </h4>
                        <Badge
                          variant="outline"
                          className="text-[10px] uppercase font-bold"
                        >
                          {objectives.length} Items
                        </Badge>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {objectives.length > 0 ? (
                          objectives.map((o: any) => (
                            <div
                              key={o.id}
                              className="p-3 bg-white/80 rounded-lg shadow-sm border border-current/20 flex flex-col gap-2"
                            >
                              <p className="text-xs font-semibold leading-tight">
                                {o.title}
                              </p>
                              <div className="flex items-center justify-between">
                                <Progress
                                  value={o.progress}
                                  className="h-1.5 flex-1 mr-2"
                                />
                                <span className="text-[10px] font-bold">
                                  {o.progress}%
                                </span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs italic opacity-50 py-2">
                            Belum ada sasaran untuk perspektif ini.
                          </p>
                        )}
                      </div>
                      {p !== "FINANCIAL" && (
                        <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-white rounded-full p-1 border shadow-sm z-10">
                          <TrendingUp className="w-3 h-3 text-slate-400 rotate-0" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audits">
          <Card className="border-blue-100 shadow-sm">
            <CardHeader className="bg-blue-50/50 border-b pb-4">
              <CardTitle className="text-lg flex items-center gap-2 text-blue-800">
                <ClipboardCheck className="w-5 h-5" /> Rekam Jejak Audit
                Internal
              </CardTitle>
              <CardDescription>
                Daftar temuan audit (SPI) dan status tindak lanjut (Follow-up)
                atas program/kegiatan dalam rencana ini.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              {(plan as any).internalAudits &&
              (plan as any).internalAudits.length > 0 ? (
                <div className="space-y-4">
                  {(plan as any).internalAudits.map((audit: any) => (
                    <div
                      key={audit.id}
                      className="p-4 border rounded-lg bg-white flex justify-between items-center"
                    >
                      <div className="flex items-center gap-3">
                        <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-200">
                          {audit.status}
                        </Badge>
                        <span className="font-medium text-slate-800">
                          Audit Terkait Perencanaan
                        </span>
                      </div>
                      <Link href={`/pengawasan/${audit.id}`}>
                        <Button size="sm" variant="ghost">
                          Buka Detail Audit{" "}
                          <ArrowRight className="w-4 h-4 ml-1" />
                        </Button>
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <ClipboardCheck className="w-12 h-12 mx-auto mb-3 opacity-30 text-blue-400" />
                  <p>Belum ada rekaman audit internal yang dikaitkan.</p>
                </div>
              )}
              <div className="mt-4 flex justify-end">
                <Link
                  href={`/pengawasan?strategicPlanId=${plan.id}&create=true`}
                >
                  <Button
                    variant="outline"
                    className="border-blue-200 text-blue-600 hover:bg-blue-50"
                  >
                    Jadwalkan Audit Internal
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {objectiveDialogOpen && (
        <ObjectiveDialog
          open={objectiveDialogOpen}
          onOpenChange={setObjectiveDialogOpen}
          planId={plan.id}
        />
      )}

      {activityDialogOpen && (
        <ActivityDialog
          open={activityDialogOpen}
          onOpenChange={setActivityDialogOpen}
          objectiveId={selectedObjectiveId}
          unitId={plan.unitId}
          editData={editActivityData}
        />
      )}
    </div>
  );
}

export default function PerencanaanDetailPage() {
  return (
    <MainLayout>
      <PerencanaanDetailPageContent />
    </MainLayout>
  );
}
