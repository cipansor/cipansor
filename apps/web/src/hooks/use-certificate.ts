import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { ApiResponse, PaginatedResponse } from "@/lib/api";
import type {
  CertificateType,
  CertificateVerification,
  DigitalCertificate,
  PublicCertificate,
} from "@cipansor/shared";

/** `decodeURIComponent` that leaves a malformed `%`-sequence untouched. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Types — the DTO and its type union live once, in `@cipansor/shared`, so the
// web picker can no longer offer a certificate type the API rejects.
export type {
  CertificateType,
  CertificateVerification,
  DigitalCertificate,
  PublicCertificate,
};

export interface CertificateTemplate {
  type: CertificateType;
  label: string;
  labelEn: string;
  description: string;
  icon: string;
  color: string;
  fields: {
    key: string;
    label: string;
    type: "text" | "date" | "number" | "select";
    required?: boolean;
    options?: string[];
  }[];
}

export const CERTIFICATE_TEMPLATES: CertificateTemplate[] = [
  {
    type: "GRADUATION",
    label: "Ijazah / Surat Kelulusan",
    labelEn: "Graduation Certificate",
    description:
      "Sertifikat kelulusan untuk santri yang telah menyelesaikan pendidikan",
    icon: "GraduationCap",
    color: "bg-blue-100 text-blue-800",
    fields: [
      {
        key: "graduationYear",
        label: "Tahun Kelulusan",
        type: "number",
        required: true,
      },
      { key: "finalGrade", label: "Nilai Akhir", type: "text" },
      { key: "rank", label: "Peringkat", type: "number" },
      { key: "program", label: "Program Studi", type: "text" },
    ],
  },
  {
    type: "TAHFIDZ",
    label: "Syahadah Tahfidz",
    labelEn: "Quran Memorization Certificate",
    description: "Sertifikat pencapaian hafalan Al-Quran",
    icon: "BookOpen",
    color: "bg-emerald-100 text-emerald-800",
    fields: [
      { key: "juzCount", label: "Jumlah Juz", type: "number", required: true },
      {
        key: "completedJuz",
        label: "Juz yang Dikhatamkan",
        type: "text",
        required: true,
      },
      {
        key: "grade",
        label: "Predikat",
        type: "select",
        options: ["Mumtaz", "Jayyid Jiddan", "Jayyid", "Maqbul"],
        required: true,
      },
      {
        key: "teacherName",
        label: "Nama Musyrif/ah",
        type: "text",
        required: true,
      },
    ],
  },
  {
    type: "ACHIEVEMENT",
    label: "Piagam Penghargaan",
    labelEn: "Achievement Certificate",
    description:
      "Penghargaan untuk prestasi akademik, ekstrakurikuler, atau lainnya",
    icon: "Trophy",
    color: "bg-amber-100 text-amber-800",
    fields: [
      {
        key: "achievementType",
        label: "Jenis Prestasi",
        type: "select",
        options: [
          "Akademik",
          "Ekstrakurikuler",
          "Lomba",
          "Kepribadian",
          "Lainnya",
        ],
        required: true,
      },
      { key: "achievement", label: "Prestasi", type: "text", required: true },
      {
        key: "level",
        label: "Tingkat",
        type: "select",
        options: [
          "Kelas",
          "Sekolah",
          "Kecamatan",
          "Kabupaten/Kota",
          "Provinsi",
          "Nasional",
          "Internasional",
        ],
      },
      { key: "rank", label: "Peringkat/Juara", type: "text" },
    ],
  },
  {
    type: "COURSE_COMPLETION",
    label: "Sertifikat Kursus",
    labelEn: "Course Completion Certificate",
    description: "Sertifikat penyelesaian kursus atau pelatihan",
    icon: "Award",
    color: "bg-purple-100 text-purple-800",
    fields: [
      {
        key: "courseName",
        label: "Nama Kursus/Pelatihan",
        type: "text",
        required: true,
      },
      { key: "duration", label: "Durasi", type: "text", required: true },
      { key: "instructor", label: "Instruktur/Pemateri", type: "text" },
      { key: "score", label: "Nilai", type: "text" },
    ],
  },
  {
    type: "APPRECIATION",
    label: "Surat Penghargaan",
    labelEn: "Letter of Appreciation",
    description: "Surat penghargaan untuk kontribusi atau partisipasi",
    icon: "Heart",
    color: "bg-pink-100 text-pink-800",
    fields: [
      {
        key: "reason",
        label: "Alasan Penghargaan",
        type: "text",
        required: true,
      },
      { key: "event", label: "Kegiatan", type: "text" },
      { key: "role", label: "Peran/Kontribusi", type: "text" },
    ],
  },
];

export interface CertificateFilters {
  studentId?: string;
  certificateType?: string;
  issueDateFrom?: string;
  issueDateTo?: string;
  isPublic?: boolean;
  page?: number;
  limit?: number;
}

export interface CreateCertificateData {
  studentId: string;
  certificateType: string;
  title: string;
  description?: string;
  grade?: string;
  rank?: number;
  issueDate: string;
  signatoryName: string;
  signatoryTitle: string;
  signatureUrl?: string;
  isPublic?: boolean;
}

// Query Keys
export const certificateKeys = {
  all: ["certificates"] as const,
  lists: () => [...certificateKeys.all, "list"] as const,
  list: (filters?: CertificateFilters) =>
    [...certificateKeys.lists(), filters] as const,
  details: () => [...certificateKeys.all, "detail"] as const,
  detail: (id: string) => [...certificateKeys.details(), id] as const,
  byStudent: (studentId: string) =>
    [...certificateKeys.all, "student", studentId] as const,
  verification: (code: string) =>
    [...certificateKeys.all, "verify", code] as const,
};

// Hooks
export function useCertificates(filters?: CertificateFilters) {
  return useQuery({
    queryKey: certificateKeys.list(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          if (value !== undefined && value !== "") {
            params.append(key, String(value));
          }
        });
      }
      const response = await api.get<PaginatedResponse<DigitalCertificate>>(
        `/certificates?${params.toString()}`,
      );
      return response.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useCertificate(id: string) {
  return useQuery({
    queryKey: certificateKeys.detail(id),
    queryFn: async () => {
      const response = await api.get<ApiResponse<DigitalCertificate>>(
        `/certificates/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

export function useStudentCertificates(studentId: string) {
  return useQuery({
    queryKey: certificateKeys.byStudent(studentId),
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<DigitalCertificate>>(
        `/certificates/student/${studentId}`,
      );
      return response.data;
    },
    enabled: !!studentId,
  });
}

export function useVerifyCertificate(code: string) {
  return useQuery({
    queryKey: certificateKeys.verification(code),
    queryFn: async () => {
      // A number may contain slashes (`OTH/09/2026/…`), which must reach the
      // API as a single percent-encoded segment or Express reads each slash as
      // a new path segment and answers "route not found". `useParams()` hands
      // the segment over still encoded, so normalize first — decoding then
      // encoding again is a no-op for an already-encoded value and still
      // correct for a raw one. The guard keeps a stray `%` from throwing.
      const segment = encodeURIComponent(safeDecode(code));
      const response = await api.get<ApiResponse<CertificateVerification>>(
        `/certificates/verify/${segment}`,
      );
      return response.data.data;
    },
    enabled: !!code,
  });
}

export function useCreateCertificate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateCertificateData) => {
      const response = await api.post<ApiResponse<DigitalCertificate>>(
        "/certificates",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: certificateKeys.lists() });
    },
  });
}

export function useUpdateCertificate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreateCertificateData>;
    }) => {
      const response = await api.put<ApiResponse<DigitalCertificate>>(
        `/certificates/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: certificateKeys.detail(variables.id),
      });
      queryClient.invalidateQueries({ queryKey: certificateKeys.lists() });
    },
  });
}

export function useDeleteCertificate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/certificates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: certificateKeys.lists() });
    },
  });
}

/**
 * Download the certificate PDF. The route answers with the file itself, so the
 * caller gets a Blob; the page turns it into an object URL and revokes it after
 * the click (see the download handler). Requesting a JSON body here would put
 * the PDF bytes through the JSON parser and fail.
 */
export function useDownloadCertificate() {
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.get(`/certificates/${id}/download`, {
        responseType: "blob",
      });
      return response.data as Blob;
    },
  });
}

/**
 * Download a *public* certificate by its printed verification number.
 *
 * Distinct from `useDownloadCertificate`, which is the authenticated,
 * id-keyed, scope-checked route: a visitor on the public verification page
 * holds only a number, so this hits `/certificates/public/{code}/download`,
 * which the API answers without a session and only for a certificate marked
 * `isPublic`. A private number gets the same 404 as an unknown one.
 */
export function useDownloadPublicCertificate() {
  return useMutation({
    mutationFn: async (code: string) => {
      const response = await api.get(
        `/certificates/public/${encodeURIComponent(code)}/download`,
        { responseType: "blob" },
      );
      return response.data as Blob;
    },
  });
}

// Generate certificate number
export function generateCertificateNumber(
  type: CertificateType,
  unitCode: string = "CPN",
): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");

  // Use rejection sampling to avoid modulo bias when generating 0..9999
  const maxUnbiasedValue = 60000; // largest multiple of 10000 less than 65536
  let value: number;
  do {
    value = globalThis.crypto.getRandomValues(new Uint16Array(1))[0];
  } while (value >= maxUnbiasedValue);

  const random = (value % 10000).toString().padStart(4, "0");
  const typeCode = type.substring(0, 3).toUpperCase();
  return `${unitCode}/${typeCode}/${year}${month}/${random}`;
}

/** The `YYYYMM` bucket `generateCertificateNumber` embeds in a number. */
function currentMonthBucket(now: Date = new Date()): string {
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Milliseconds from `now` until the next calendar month begins.
 *
 * Computed by constructing the 1st of the following month rather than adding a
 * fixed 30 days, so months of different lengths (and DST shifts) still land on
 * the real boundary.
 */
function msUntilNextMonth(now: Date = new Date()): number {
  const nextMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    1,
    0,
    0,
    0,
    0,
  );
  return nextMonth.getTime() - now.getTime();
}

// `setTimeout` treats a delay above the signed 32-bit maximum as an overflow and
// fires after ~1ms instead, so a timer aimed at the next month from the 1st of
// a 31-day month (2.68e9 ms) would fire at once, find the bucket unchanged, and
// never re-arm — the rollover would be silently lost. Clamping keeps the timer
// honest: it fires a little early, then re-arms for the remainder.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Shown until the client has mounted, in place of a certificate number.
 *
 * The number is random and must not be drawn during render: the page is a
 * Client Component but Next still renders it on the server and hydrates it in
 * the browser, and two independent `generateCertificateNumber` calls produce
 * two different numbers — a hydration mismatch. This placeholder is itself the
 * initial state on both sides, so the first client render matches the server's
 * byte for byte, and the real number is minted in an effect after mount.
 *
 * It cannot be mistaken for a number the student received: it is not
 * `unit/type/YYYYMM/NNNN`, and the page suppresses printing until the number
 * is available.
 */
export const PENDING_CERTIFICATE_NUMBER = "Memuat nomor...";

interface CertificateNumber {
  /** `null` until the post-mount effect mints a number. */
  value: string | null;
  /** The localised `YYYYMM` segment of `value`, or `null` while pending. */
  monthBucket: string | null;
}

/**
 * A certificate number that is stable for a given identity and calendar month.
 *
 * `generateCertificateNumber` is random, so calling it during render gave a
 * different value on the server and on the client (`generateCertificateNumber`
 * is not pure), and a different one again on every re-render — React reports a
 * hydration mismatch and an unrelated state update redrew the printed
 * certificate under a number the student never received.
 *
 * The initial state is therefore `null` on both server and client, so the two
 * renders agree; the number is minted from an effect once mounted, and then
 * tied to `type`, `unitCode`, `identityKey` and the current month, changing
 * only when one of those genuinely changes.
 *
 * `identityKey` is the caller's stable identifier for whatever the number
 * belongs to (the page passes the student id). `type`/`unitCode` alone do not
 * identify a *document*: two students receiving the same certificate type share
 * both, so without the key, selecting a different student would reuse the
 * number minted for the previous one. Pass the student id, never the display
 * name — a name is neither stable nor unique.
 *
 * `value` reports the minted number only while it belongs to the identity
 * passed in *this* render. An identity change is not visible to render until
 * the re-render it triggers, and the mint effect that draws the new number runs
 * after that render commits — so for one render the old number would otherwise
 * still be truthy. During that window `value` is `null` (pending), which is
 * exactly what the page gates printing on, so a new student/template can never
 * be printed under the previous identity's number.
 *
 * The month is part of the identity because the number embeds a `YYYYMM`
 * segment: a page left open across midnight on the last day of a month would
 * otherwise keep issuing a number stamped with the old month. One self-arming
 * timeout fires at the next month boundary to advance the bucket; it is cleared
 * on unmount and re-armed when the identity changes, so there is never more
 * than one pending timer and none leaks. The timer is scheduled from an effect,
 * so no browser API is touched during render.
 *
 * NOTHING RECORDS THIS NUMBER. It is drawn in the browser and printed, and no
 * table, endpoint or log keeps it, so a printed certificate cannot be looked up
 * or verified by it and two certificates can share one (1 in 10,000 per type
 * per month). Treat it as a display label until issuance is recorded
 * server-side.
 */
export function useCertificateNumber(
  type: CertificateType,
  unitCode: string = "CPN",
  identityKey: string = "",
): CertificateNumber {
  // `value` is paired with the identity it was minted for, so render can tell
  // whether it belongs to the `type`/`unitCode`/`identityKey` currently in
  // flight. Both are state — not a ref — because reading a ref during render is
  // disallowed.
  const [minted, setMinted] = useState<{
    value: string | null;
    identity: string | null;
  }>({ value: null, identity: null });
  // The bucket the current value was minted in, so a rollover is detected by
  // comparison rather than by reading a second piece of state. Read only from
  // effects, so a ref is safe here.
  const monthBucketRef = useRef(currentMonthBucket());
  const identity = `${type}\u0000${unitCode}\u0000${identityKey}`;

  // Mint the initial number after mount. Reading the clock and the random
  // source here (not during render) is what removes the divergence.
  //
  // StrictMode runs this effect twice on mount (setup → cleanup → setup).
  // Re-minting on the second pass is intentional: the first number must be
  // discarded, because the first cleanup also tore down its rollover timer.
  useEffect(() => {
    monthBucketRef.current = currentMonthBucket();
    setMinted({ value: generateCertificateNumber(type, unitCode), identity });
  }, [type, unitCode, identity]);

  useEffect(() => {
    // A chain that has already fired can still be queued when the identity
    // changes; without this flag its callback would re-arm *after* cleanup and
    // leave a second, orphaned timer running alongside the new chain.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      timer = setTimeout(
        () => {
          if (cancelled) return;
          const next = currentMonthBucket();
          if (monthBucketRef.current !== next) {
            monthBucketRef.current = next;
            // Re-mint so the displayed number carries the new `YYYYMM` segment;
            // this runs only at a real boundary, not on unrelated re-renders.
            setMinted({
              value: generateCertificateNumber(type, unitCode),
              identity,
            });
          }
          // Same bucket after an early (clamped) wake-up: keep the value, but
          // re-arm so the real boundary is still reached.
          arm();
        },
        Math.min(msUntilNextMonth(), MAX_TIMEOUT_MS),
      );
    };
    arm();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `type`/`unitCode`/`identity` re-arm the chain on an identity change (the
    // identity state is re-aligned by the mint effect above); the bucket is not
    // a dependency because the chain re-arms itself.
  }, [type, unitCode, identity]);

  return useMemo(() => {
    // `value` is only offered once it was minted for the identity in flight.
    // On the render after an identity change the stored identity still names
    // the old pair, so this reports `null` (pending) instead of the stale
    // number; the mint effect then stamps the new identity. Any value minted
    // for a different identity is hidden, never printed.
    const current = minted.identity === identity ? minted.value : null;
    return {
      value: current,
      // Derived from the value itself, so the two can never disagree.
      monthBucket: current === null ? null : current.split("/")[2],
    };
  }, [minted, identity]);
}
