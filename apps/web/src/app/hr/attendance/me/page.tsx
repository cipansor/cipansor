"use client";

import { useState } from "react";
import { MainLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  SelfieCapture,
  type GeoPoint,
  type PhotoSource,
} from "@/components/hr/SelfieCapture";
import {
  useMyAttendanceToday,
  useSelfCheckIn,
  useSelfCheckOut,
  useUploadPunchPhoto,
  STAFF_ATTENDANCE_STATUS_LABELS,
} from "@/hooks";
import { safeFormat } from "@/lib/date";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileImage,
  Info,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  UserX,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Absen Saya — the employee clocks themselves in and out.
 *
 * The policy is enforced by the API (selfie/location may be required, and a
 * position outside every geofence may be rejected); the page shows what the
 * unit asks for before the button is pressed, and the server's own reason when
 * a punch is refused.
 */
export default function SelfAttendancePage() {
  const { data, isLoading } = useMyAttendanceToday();
  const checkIn = useSelfCheckIn();
  const checkOut = useSelfCheckOut();
  const uploadPhoto = useUploadPunchPhoto();
  const attendance = data?.attendance ?? null;
  const required = data?.requirements;

  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoSource, setPhotoSource] = useState<PhotoSource | null>(null);
  const [geo, setGeo] = useState<GeoPoint | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const missing: string[] = [];
  if (required?.requireSelfie && !photoBlob) missing.push("swafoto");
  if (required?.requireLocation && !geo) missing.push("lokasi");

  const submit = async (kind: "in" | "out") => {
    setSubmitting(true);
    try {
      const photo = photoBlob ? await uploadPhoto.mutateAsync(photoBlob) : null;
      const payload = {
        photoRef: photo?.photoRef,
        photoSource: photo ? (photoSource ?? "CAMERA") : undefined,
        latitude: geo?.latitude,
        longitude: geo?.longitude,
        accuracyMeters: geo?.accuracyMeters,
        deviceInfo:
          typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      };
      if (kind === "in") {
        const result = await checkIn.mutateAsync(payload);
        toast.success(
          result.lateMinutes > 0
            ? `Absen masuk tercatat, terlambat ${result.lateMinutes} menit`
            : "Absen masuk tercatat",
        );
      } else {
        await checkOut.mutateAsync(payload);
        toast.success("Absen pulang tercatat");
      }
      setPhotoBlob(null);
      setPhotoSource(null);
    } catch {
      // The API client already shows the server's reason (a required selfie, a
      // photo already used, outside the site…). A second, generic "failed"
      // toast on top of it only buried that reason.
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel = attendance
    ? STAFF_ATTENDANCE_STATUS_LABELS[attendance.status]
    : null;

  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Absen Saya</h1>
          <p className="text-muted-foreground">
            Catat jam masuk dan pulang Anda hari ini
          </p>
        </div>

        {data && !data.hasProfile ? (
          <Card>
            <CardContent className="flex items-start gap-3 pt-6 text-sm">
              <UserX className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="space-y-1">
                <p className="font-medium">
                  Data kepegawaian Anda belum dibuat
                </p>
                <p className="text-muted-foreground">
                  Absen hanya bisa dicatat untuk akun yang punya data pegawai.
                  Minta admin unit Anda menambahkannya, lalu buka halaman ini
                  lagi.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {data?.isExempt ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                Anda dikecualikan dari absensi harian menurut kebijakan
                kepegawaian, jadi tombol absen dimatikan.
              </div>
            ) : data && !data.isWorkDay ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                Hari ini bukan hari kerja untuk unit Anda, dan Anda tidak punya
                jadwal shift hari ini.
              </div>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Status Hari Ini</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : attendance ? (
                    <>
                      <div className="flex items-center gap-2">
                        <Badge>{statusLabel}</Badge>
                        {attendance.lateMinutes ? (
                          <span className="text-sm text-amber-700 dark:text-amber-400">
                            Terlambat {attendance.lateMinutes} menit
                          </span>
                        ) : null}
                      </div>
                      <dl className="grid grid-cols-2 gap-2 text-sm">
                        <dt className="text-muted-foreground">Jam masuk</dt>
                        <dd>
                          {attendance.checkIn
                            ? safeFormat(new Date(attendance.checkIn), "HH:mm")
                            : "—"}
                        </dd>
                        <dt className="text-muted-foreground">Jam pulang</dt>
                        <dd>
                          {attendance.checkOut
                            ? safeFormat(new Date(attendance.checkOut), "HH:mm")
                            : "—"}
                        </dd>
                        {attendance.shift && (
                          <>
                            <dt className="text-muted-foreground">Shift</dt>
                            <dd>
                              {attendance.shift.name} (
                              {attendance.shift.startTime}–
                              {attendance.shift.endTime})
                            </dd>
                          </>
                        )}
                      </dl>
                      <div className="flex flex-wrap gap-2">
                        {attendance.records.map((record) => (
                          <div
                            key={record.id}
                            className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs"
                          >
                            {record.kind === "CHECK_IN" ? (
                              <LogIn className="h-3 w-3" aria-label="Masuk" />
                            ) : (
                              <LogOut className="h-3 w-3" aria-label="Pulang" />
                            )}
                            {record.isWithinRadius === false ? (
                              <AlertTriangle className="h-3 w-3 text-amber-600" />
                            ) : record.isWithinRadius === true ? (
                              <MapPin className="h-3 w-3 text-green-600" />
                            ) : null}
                            <span>
                              {record.distanceMeters !== undefined &&
                              record.distanceMeters !== null
                                ? `${record.distanceMeters} m dari lokasi absen`
                                : "lokasi tidak dicatat"}
                            </span>
                            {record.photoSource === "FILE" && (
                              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                                <FileImage className="h-3 w-3" />
                                foto dari berkas
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      Belum ada absen hari ini.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Bukti Kehadiran</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {required && (
                    <p className="text-sm text-muted-foreground">
                      {required.requireSelfie && required.requireLocation
                        ? "Unit Anda mewajibkan swafoto dan lokasi."
                        : required.requireSelfie
                          ? "Unit Anda mewajibkan swafoto."
                          : required.requireLocation
                            ? "Unit Anda mewajibkan lokasi."
                            : "Unit Anda belum mewajibkan swafoto maupun lokasi; keduanya boleh dilewati."}
                    </p>
                  )}
                  <SelfieCapture
                    photoBlob={photoBlob}
                    photoSource={photoSource}
                    onPhoto={(blob, source) => {
                      setPhotoBlob(blob);
                      setPhotoSource(source);
                    }}
                    geo={geo}
                    onGeo={setGeo}
                    readLocationOnOpen={Boolean(required?.requireLocation)}
                  />
                  {missing.length > 0 && (
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                      Lengkapi {missing.join(" dan ")} sebelum absen.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => submit("in")}
                      disabled={
                        submitting || !data?.canCheckIn || missing.length > 0
                      }
                    >
                      {submitting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      Absen Masuk
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => submit("out")}
                      disabled={
                        submitting || !data?.canCheckOut || missing.length > 0
                      }
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      Absen Pulang
                    </Button>
                  </div>
                  {required && (
                    <div className="flex gap-2 rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
                      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <p>
                        Swafoto dan lokasi hanya dipakai untuk membuktikan
                        kehadiran Anda. Yang dapat melihatnya: Anda sendiri dan
                        admin unit Anda; setiap pembukaan swafoto dicatat.
                        Swafoto dihapus otomatis sesudah{" "}
                        {required.photoRetentionDays} hari; catatan jam hadir
                        disimpan 10 tahun sebagai dasar penggajian.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </MainLayout>
  );
}
