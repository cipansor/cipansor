"use client";

import { useTalentAnalytics } from "@/hooks/use-talenta";
import { PageHeader } from "@/components/shared/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, TrendingUp, Target, Award } from "lucide-react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  Pie,
  PieChart,
} from "recharts";
import { MainLayout } from "@/components/layout";

function TalentAnalyticsPageContent() {
  const { data: analytics, isLoading } = useTalentAnalytics();

  if (isLoading) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <Skeleton className="h-12 w-1/3" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  const chartData = analytics
    ? Object.keys(analytics.distribution).map((key) => ({
        name: key.replaceAll("_", " "),
        count: analytics.distribution[key],
        percentage: analytics.percentages[key],
      }))
    : [];

  const COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#94a3b8", "#e11d48"];

  return (
    <div className="container mx-auto py-6 space-y-6">
      <PageHeader
        title="Analitik Talenta"
        description="Distribusi performa dan potensi SDM unit (9-Box Grid Summary)."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Users className="w-4 h-4" /> Total Pegawai Terpetakan
            </CardDescription>
            <CardTitle className="text-3xl">{analytics?.total || 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Award className="w-4 h-4" /> High Potential
            </CardDescription>
            <CardTitle className="text-3xl text-emerald-600">
              {analytics?.distribution?.HIGH_POTENTIAL || 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <TrendingUp className="w-4 h-4" /> Key Talents
            </CardDescription>
            <CardTitle className="text-3xl text-blue-600">
              {analytics?.distribution?.KEY_TALENT || 0}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Distribusi Kategori Talenta
            </CardTitle>
            <CardDescription>
              Berdasarkan penilaian performa dan potensi terakhir.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical">
                <XAxis type="number" />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={150}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {chartData.map((_entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg text-center">
              Persentase Talenta
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[350px] flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={80}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="count"
                >
                  {chartData.map((_entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2">
              {chartData.map((d, i) => (
                <div key={d.name} className="flex items-center gap-2 text-sm">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: COLORS[i % COLORS.length] }}
                  />
                  <span className="font-medium">{d.percentage}%</span>
                  <span className="text-muted-foreground">{d.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5" /> Implikasi Strategis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
            <div className="space-y-2 p-4 bg-emerald-50 rounded-lg border border-emerald-100">
              <h4 className="font-bold text-emerald-800">
                Growth & Acceleration
              </h4>
              <p className="text-emerald-700">
                Fokus pada pelatihan kepemimpinan dan penugasan proyek strategis
                bagi kategori High Potential dan Key Talent.
              </p>
            </div>
            <div className="space-y-2 p-4 bg-amber-50 rounded-lg border border-amber-100">
              <h4 className="font-bold text-amber-800">
                Support & Development
              </h4>
              <p className="text-amber-700">
                Berikan coaching teknis dan mentoring bagi Emerging Talents
                untuk meningkatkan performa ke tingkat selanjutnya.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function TalentAnalyticsPage() {
  return (
    <MainLayout>
      <TalentAnalyticsPageContent />
    </MainLayout>
  );
}
