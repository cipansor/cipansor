"use client";

import { ShieldAlert } from "lucide-react";
import { MainLayout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";

/**
 * What a staff attendance admin page shows to someone who may open its URL but
 * not run it (see `canManageStaffAttendance`): who does run it, instead of an
 * empty form whose every request is refused.
 */
export function StaffAttendanceAdminOnly({ title }: { title: string }) {
  return (
    <MainLayout>
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <Card>
          <CardContent className="flex items-start gap-3 pt-6 text-sm">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium">
                Halaman ini dikelola super admin dan admin unit
              </p>
              <p className="text-muted-foreground">
                Absensi pegawai dan pengaturannya dijalankan oleh admin unit
                masing-masing.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
