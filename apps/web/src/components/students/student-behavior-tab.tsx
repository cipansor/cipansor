import { AlertTriangle, Star } from "lucide-react";
import { safeFormat } from "@/lib/date";
import { useStudentBehaviorStats } from "@/hooks/use-students";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface StudentBehaviorTabProps {
  studentId: string;
}

const SEVERITY_LABELS: Record<string, string> = {
  MINOR: "Ringan",
  MODERATE: "Sedang",
  MAJOR: "Berat",
};

/**
 * Shown instead of the figures when a summary could not be read. Without it a
 * refused or failed request read as "0" and "Belum ada pelanggaran", a clean
 * record the santri may not have.
 */
function LoadError() {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        Catatan perilaku santri ini gagal dimuat. Muat ulang halaman, atau
        hubungi admin bila tetap gagal.
      </p>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-8">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

export function StudentBehaviorTab({ studentId }: StudentBehaviorTabProps) {
  const {
    data: stats,
    isLoading,
    isError,
  } = useStudentBehaviorStats(studentId);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Ringkasan Perilaku</CardTitle>
          <CardDescription>
            Pelanggaran dan penghargaan yang tercatat untuk santri ini
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Spinner />
          ) : isError ? (
            <LoadError />
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Poin pelanggaran
                  </p>
                  <h3 className="text-2xl font-bold text-destructive">
                    {stats?.violationPoints ?? 0}
                  </h3>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Pelanggaran
                  </p>
                  <h3 className="text-2xl font-bold">
                    {stats?.totalViolations ?? 0}
                  </h3>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Poin penghargaan
                  </p>
                  <h3 className="text-2xl font-bold text-primary">
                    {stats?.rewardPoints ?? 0}
                  </h3>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Penghargaan
                  </p>
                  <h3 className="text-2xl font-bold">
                    {stats?.totalRewards ?? 0}
                  </h3>
                </div>
              </div>
              <div>
                <h4 className="mb-2 text-sm font-semibold">
                  Pelanggaran terakhir
                </h4>
                {stats?.recentViolations?.length ? (
                  <div className="space-y-2">
                    {stats.recentViolations.map((v) => (
                      <div
                        key={v.id}
                        className="flex items-center justify-between rounded-lg border p-2"
                      >
                        <div>
                          <p className="text-sm font-medium">{v.category}</p>
                          <p className="text-xs text-muted-foreground">
                            {safeFormat(new Date(v.occurredAt), "dd MMM yyyy")}{" "}
                            · {v.points} poin
                          </p>
                        </div>
                        <Badge variant="destructive">
                          {SEVERITY_LABELS[v.type] ?? v.type}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Belum ada pelanggaran tercatat.
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Penghargaan</CardTitle>
          <CardDescription>Penghargaan terakhir yang diterima</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Spinner />
          ) : isError ? (
            <LoadError />
          ) : stats?.recentRewards?.length ? (
            <div className="space-y-2">
              {stats.recentRewards.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-lg border p-2 bg-green-50 dark:bg-green-900/10"
                >
                  <div>
                    <p className="text-sm font-medium">{r.category}</p>
                    <p className="text-xs text-muted-foreground">
                      {safeFormat(new Date(r.givenAt), "dd MMM yyyy")} ·{" "}
                      {r.points} poin
                    </p>
                  </div>
                  <Star className="h-4 w-4 text-yellow-500" />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Star className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p>Belum ada penghargaan tercatat.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
