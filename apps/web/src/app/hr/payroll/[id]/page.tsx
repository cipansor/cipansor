"use client";

import { use } from "react";
import { safeFormat } from "@/lib/date";
import { useRouter } from "next/navigation";
import {
  usePayrollPeriod,
  usePayrolls,
  usePayrollPeriodSummary,
  PAYROLL_STATUS_LABELS,
} from "@/hooks/use-hr";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, Download, CheckCircle, Ban } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

import { MainLayout } from "@/components/layout";
// Use standard Next.js 15 'use' pattern for dynamic params
function PayrollDetailPageContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const { data: period, isLoading: periodLoading } = usePayrollPeriod(id);
  const { data: summary } = usePayrollPeriodSummary(id);
  const { data: slips, isLoading: slipsLoading } = usePayrolls({
    periodId: id,
    page: 1,
    limit: 100,
  }); // Pagination simplified for now

  if (periodLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!period) {
    return <div className="text-center py-20">Payroll period not found</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{period.name}</h1>
          <p className="text-muted-foreground">
            {safeFormat(new Date(period.startDate), "MMM d, yyyy")} -{" "}
            {safeFormat(new Date(period.endDate), "MMM d, yyyy")}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {/* Action buttons like Approve All, Pay All could go here */}
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Amount</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {new Intl.NumberFormat("id-ID", {
                style: "currency",
                currency: "IDR",
              }).format(Number(summary?.totalNetSalary || 0))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Employees</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {period._count?.payrolls || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge>{period.status}</Badge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payroll Slips</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Base Salary</TableHead>
                  <TableHead>Earnings</TableHead>
                  <TableHead>Deductions</TableHead>
                  <TableHead>Net Salary</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slipsLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : slips?.data?.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center py-8 text-muted-foreground"
                    >
                      No slips found.
                    </TableCell>
                  </TableRow>
                ) : (
                  slips?.data?.map((slip) => (
                    <TableRow key={slip.id}>
                      <TableCell>
                        <div className="font-medium">
                          {slip.staff?.user?.name ||
                            slip.employeeName ||
                            slip.staff?.fullName ||
                            "Unknown"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {slip.employeeNo || slip.staff?.nip}
                        </div>
                      </TableCell>
                      <TableCell>{slip.department || "-"}</TableCell>
                      <TableCell>
                        {new Intl.NumberFormat("id-ID", {
                          style: "currency",
                          currency: "IDR",
                        }).format(Number(slip.baseSalary))}
                      </TableCell>
                      <TableCell className="text-green-600">
                        {new Intl.NumberFormat("id-ID", {
                          style: "currency",
                          currency: "IDR",
                        }).format(Number(slip.totalAllowances))}
                      </TableCell>
                      <TableCell className="text-red-600">
                        {new Intl.NumberFormat("id-ID", {
                          style: "currency",
                          currency: "IDR",
                        }).format(Number(slip.totalDeductions))}
                      </TableCell>
                      <TableCell className="font-bold">
                        {new Intl.NumberFormat("id-ID", {
                          style: "currency",
                          currency: "IDR",
                        }).format(Number(slip.netSalary))}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {
                            PAYROLL_STATUS_LABELS[
                              slip.status as keyof typeof PAYROLL_STATUS_LABELS
                            ]
                          }
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PayrollDetailPage(
  props: Parameters<typeof PayrollDetailPageContent>[0],
) {
  return (
    <MainLayout>
      <PayrollDetailPageContent {...props} />
    </MainLayout>
  );
}
