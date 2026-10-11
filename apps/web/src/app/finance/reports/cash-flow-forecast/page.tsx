"use client";

import { useState } from "react";
import { useCashFlowForecast } from "@/hooks/use-finance-enhancement";
import { useUnits } from "@/hooks/use-units";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/shared/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";
import { formatCurrency } from "@/lib/utils";
import { AlertCircle, TrendingUp, TrendingDown, Wallet } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { MainLayout } from "@/components/layout";

function CashFlowForecastPageContent() {
  const { user } = useAuth();
  // The forecast is always computed for one unit, and a SUPER_ADMIN has no
  // `unitId` of their own — reading `user.unitId` left the query permanently
  // disabled and rendered the error branch on a page that has data. Default to
  // the user's own unit, then the first available one, and let them switch.
  const { data: units } = useUnits();
  const [selectedUnitId, setSelectedUnitId] = useState<string | undefined>(
    user?.unitId ?? undefined,
  );
  const unitId = selectedUnitId ?? units?.[0]?.id;
  const { data, isLoading, error } = useCashFlowForecast(unitId);

  if (isLoading) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <PageHeader
          title="Proyeksi Arus Kas"
          description="Memuat data proyeksi..."
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container mx-auto py-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            Gagal memuat data proyeksi arus kas. Pastikan Anda memiliki akses
            yang cukup.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { initialBalance, forecast } = data;
  const latestBalance = forecast[forecast.length - 1]?.balance || 0;
  const isHealthy = latestBalance >= initialBalance;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <PageHeader
        title="Proyeksi Arus Kas"
        description="Estimasi pergerakan kas berdasarkan tagihan piutang dan rencana pengeluaran 6 bulan ke depan."
      />

      <div className="flex justify-end">
        <Select value={unitId ?? ""} onValueChange={setSelectedUnitId}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Pilih Unit" />
          </SelectTrigger>
          <SelectContent>
            {(units ?? []).map((unit) => (
              <SelectItem key={unit.id} value={unit.id}>
                {unit.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Saldo Kas Saat Ini
            </CardDescription>
            <CardTitle className="text-2xl font-bold">
              {formatCurrency(initialBalance)}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" /> Estimasi Saldo
              Akhir (6 bln)
            </CardDescription>
            <CardTitle
              className={`text-2xl font-bold ${isHealthy ? "text-green-600" : "text-red-600"}`}
            >
              {formatCurrency(latestBalance)}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              {isHealthy ? (
                <TrendingUp className="h-4 w-4 text-green-500" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-500" />
              )}
              Net Perubahan Kas
            </CardDescription>
            <CardTitle
              className={`text-2xl font-bold ${isHealthy ? "text-green-600" : "text-red-600"}`}
            >
              {formatCurrency(latestBalance - initialBalance)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Inflow vs Outflow Bulanan</CardTitle>
            <CardDescription>
              Perbandingan estimasi pendapatan dan pengeluaran
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={forecast}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" />
                  <YAxis tickFormatter={(val) => `Rp ${val / 1000000}jt`} />
                  <Tooltip
                    formatter={(val: any) => formatCurrency(val)}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "none",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                    }}
                  />
                  <Legend />
                  <Bar
                    dataKey="income"
                    name="Pendapatan (Tagihan)"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="expense"
                    name="Pengeluaran (PR/Budget)"
                    fill="#ef4444"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Proyeksi Saldo Kas</CardTitle>
            <CardDescription>
              Tren akumulasi saldo kas di masa depan
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={forecast}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" />
                  <YAxis tickFormatter={(val) => `Rp ${val / 1000000}jt`} />
                  <Tooltip
                    formatter={(val: any) => formatCurrency(val)}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "none",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="balance"
                    name="Saldo Kas"
                    stroke="#3b82f6"
                    strokeWidth={3}
                    dot={{ r: 4, fill: "#3b82f6" }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detail Data Proyeksi</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative w-full overflow-auto">
            <table className="w-full caption-bottom text-sm">
              <thead className="[&_tr]:border-b">
                <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                    Bulan
                  </th>
                  <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                    Estimasi Pendapatan
                  </th>
                  <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                    Estimasi Pengeluaran
                  </th>
                  <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                    Net Cash Flow
                  </th>
                  <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                    Proyeksi Saldo
                  </th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {forecast.map((row: any, i: number) => (
                  <tr
                    key={i}
                    className="border-b transition-colors hover:bg-muted/50"
                  >
                    <td className="p-4 align-middle font-medium">
                      {row.month}
                    </td>
                    <td className="p-4 align-middle text-right text-green-600">
                      {formatCurrency(row.income)}
                    </td>
                    <td className="p-4 align-middle text-right text-red-600">
                      {formatCurrency(row.expense)}
                    </td>
                    <td
                      className={`p-4 align-middle text-right font-medium ${row.netFlow >= 0 ? "text-green-600" : "text-red-600"}`}
                    >
                      {formatCurrency(row.netFlow)}
                    </td>
                    <td className="p-4 align-middle text-right font-bold">
                      {formatCurrency(row.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CashFlowForecastPage() {
  return (
    <MainLayout>
      <CashFlowForecastPageContent />
    </MainLayout>
  );
}
