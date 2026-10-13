"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePunchPhoto, type AttendanceEvidence } from "@/hooks";
import { objectUrlForBlob, releaseObjectUrl } from "@/lib/files";
import { safeFormat } from "@/lib/date";
import { id as localeId } from "date-fns/locale";
import {
  AlertTriangle,
  Camera,
  FileImage,
  Loader2,
  MapPin,
} from "lucide-react";

const KIND_LABEL = { CHECK_IN: "Masuk", CHECK_OUT: "Pulang" } as const;

/**
 * What a punch carried, for the unit admin: whether it was outside the site,
 * whether its photo came from a file rather than the camera (both are review
 * prompts, not verdicts — a browser cannot tell a faked position from a real
 * one), where it was taken, and the selfie itself, fetched only when opened
 * because every opening is recorded. A punch with neither photo nor location
 * says so in words instead of showing a button that does nothing.
 */
export function PunchEvidence({
  name,
  records,
}: {
  name: string;
  records: AttendanceEvidence[];
}) {
  const [open, setOpen] = useState<AttendanceEvidence | null>(null);

  if (!records.length) return <span className="text-muted-foreground">-</span>;

  return (
    <div className="flex flex-wrap gap-1">
      {records.map((record) => {
        const outside = record.isWithinRadius === false;
        const fromFile = record.photoSource === "FILE";
        const located = record.latitude != null && record.longitude != null;
        if (!record.hasPhoto && !located) {
          return (
            <span
              key={record.id}
              className="inline-flex h-7 items-center rounded-md border border-dashed px-2 text-xs text-muted-foreground"
            >
              {KIND_LABEL[record.kind]}: tanpa bukti
            </span>
          );
        }
        return (
          <Button
            key={record.id}
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setOpen(record)}
            aria-label={`Bukti ${KIND_LABEL[record.kind]} ${name}`}
          >
            {KIND_LABEL[record.kind]}
            {record.hasPhoto && <Camera className="h-3 w-3" aria-hidden />}
            {located && <MapPin className="h-3 w-3" aria-hidden />}
            {outside && (
              <AlertTriangle
                className="h-3 w-3 text-amber-600"
                aria-label="di luar lokasi absen"
              />
            )}
            {fromFile && (
              <FileImage
                className="h-3 w-3 text-amber-600"
                aria-label="foto dari berkas"
              />
            )}
          </Button>
        );
      })}
      <Dialog open={open !== null} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-md">
          {open && <PhotoView name={name} record={open} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PhotoView({
  name,
  record,
}: {
  name: string;
  record: AttendanceEvidence;
}) {
  const { data, isLoading, isError } = usePunchPhoto(
    record.hasPhoto ? record.id : null,
  );
  const url = useMemo(() => (data ? objectUrlForBlob(data) : null), [data]);
  useEffect(() => () => releaseObjectUrl(url), [url]);

  const notes: string[] = [];
  if (record.isWithinRadius === false) {
    notes.push(
      record.distanceMeters != null
        ? `Di luar lokasi absen (${record.distanceMeters} m dari lokasi terdekat)`
        : "Di luar lokasi absen",
    );
  }
  if (record.photoSource === "FILE") {
    notes.push("Foto dipilih dari berkas karena kamera tidak dapat dibuka");
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Bukti {KIND_LABEL[record.kind]} — {name}
        </DialogTitle>
        <DialogDescription>
          {safeFormat(new Date(record.capturedAt), "d MMMM yyyy, HH:mm", {
            locale: localeId,
          })}
          .
          {record.hasPhoto
            ? " Pembukaan swafoto ini dicatat."
            : " Absen ini tanpa swafoto."}
        </DialogDescription>
      </DialogHeader>
      {record.hasPhoto && (
        <div className="overflow-hidden rounded-md border bg-muted">
          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : isError || !url ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              Swafoto tidak dapat dibuka.
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={`Swafoto ${name}`}
              className="max-h-96 w-full object-contain"
            />
          )}
        </div>
      )}
      {record.latitude != null && record.longitude != null && (
        <p className="flex gap-2 text-sm text-muted-foreground">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Lokasi {record.latitude.toFixed(5)}, {record.longitude.toFixed(5)}
            {record.isWithinRadius === true &&
              (record.distanceMeters != null
                ? `, di dalam lokasi absen (${record.distanceMeters} m dari titiknya)`
                : ", di dalam lokasi absen")}
          </span>
        </p>
      )}
      {notes.length > 0 && (
        <ul className="space-y-1 text-sm text-amber-700 dark:text-amber-400">
          {notes.map((n) => (
            <li key={n} className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {n}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
