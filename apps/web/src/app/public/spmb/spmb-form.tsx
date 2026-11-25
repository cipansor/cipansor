"use client";

import Image from "next/image";
import Link from "next/link";
import { siteConfig } from "@/config/site";
import { LandingNavbar } from "@/components/landing/navbar";
import { LandingFooter } from "@/components/landing/footer";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  usePublicIntakes,
  useCreateRegistration,
  Gender,
} from "@/hooks/use-admissions";
import { usePrivacyPolicyCurrent } from "@/hooks/use-privacy-policy";
import { PublicIntakes } from "@/components/admissions/public-intakes";
import { formatRupiah } from "@/lib/admission-intake";
import { checkNik, QURAN_ABILITIES } from "@cipansor/shared";
import type { Locale } from "@/locales";
import {
  TurnstileWidget,
  useTurnstile,
} from "@/components/security/turnstile-widget";
import { RegistrationTracker } from "@/components/admissions/registration-tracker";
import { DocumentCaptureField } from "@/components/admissions/document-capture-field";
import {
  CheckCircle2,
  User,
  Users,
  MapPin,
  Phone,
  Mail,
  BookOpen,
  Upload,
  ChevronRight,
  ChevronLeft,
  AlertCircle,
  Info,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { differenceInDays } from "date-fns";
import { spmbFormContentFor } from "@/config/spmb-form.i18n";
import { dateFormatterFor, formatNumber } from "@/lib/locale-format";
import { dirFor } from "@/locales";
import { api } from "@/lib/api";

interface FormData {
  // Student info
  fullName: string;
  nickname: string;
  gender: Gender | "";
  birthPlace: string;
  birthDate: string;
  nationalId: string;
  familyCardNumber: string;

  // Previous school
  previousSchool: string;
  previousSchoolAddress: string;
  graduationYear: string;

  // Parent info
  fatherName: string;
  fatherOccupation: string;
  fatherPhone: string;
  fatherEmail: string;
  motherName: string;
  motherOccupation: string;
  motherPhone: string;

  // Address
  address: string;
  village: string;
  district: string;
  city: string;
  province: string;
  postalCode: string;

  // Quran
  quranAbility: string;
  memorizedJuz: string;

  // Unit; its open intake decides the period.
  unitId: string;
  source?: string;
  campaignId?: string;
}

const initialFormData: FormData = {
  fullName: "",
  nickname: "",
  gender: "",
  birthPlace: "",
  birthDate: "",
  nationalId: "",
  familyCardNumber: "",
  previousSchool: "",
  previousSchoolAddress: "",
  graduationYear: "",
  fatherName: "",
  fatherOccupation: "",
  fatherPhone: "",
  fatherEmail: "",
  motherName: "",
  motherOccupation: "",
  motherPhone: "",
  address: "",
  village: "",
  district: "",
  city: "",
  province: "",
  postalCode: "",
  quranAbility: "",
  memorizedJuz: "",
  unitId: "",
};

/**
 * The page used to branch on the mere existence of a period, so an expired one
 * rendered the green "Gelombang pendaftaran aktif hingga 31 Mei 2024" banner
 * and the full six-step form. The countdown's `Math.max(0, …)` then displayed
 * "0 Hari" instead of a negative number — the contradiction was on screen but
 * never acted on.
 *
 * The API does reject late submissions (`admissions.controller.ts` re-checks
 * the window server-side), but only at submit: a parent filled in their
 * child's name, NIK, address and documents before being told, in English,
 * "Admission period is not open for registration". The window has to be
 * checked before the form is offered, not after it is completed.
 */
export function SpmbForm({
  photo,
  locale,
}: {
  /**
   * A photograph of the santri a prospective parent is being asked to join.
   *
   * This is the page every advertisement points at, and it showed nothing of
   * the pesantren at all. Resolved on the server so the alt text follows the
   * visitor's locale.
   */
  photo: { src: string; alt: string };
  /** The reader's locale: the form's words, its dates and its direction. */
  locale: Locale;
}) {
  const t = spmbFormContentFor(locale);
  const dir = dirFor(locale);
  const formatDay = (moment: string | Date) =>
    dateFormatterFor(locale).format(new Date(moment));
  // Punctuation follows the script: Arabic writes its own comma.
  const comma = dir === "rtl" ? "، " : ", ";
  // Each unit's intake. A registration goes to the period of the unit the
  // applicant chooses; the page used to read one "active period" for the whole
  // yayasan and filed every registration under it, whatever unit was picked.
  const { data: intakes = [], isLoading: intakesLoading } = usePublicIntakes();
  const createRegistration = useCreateRegistration();
  const turnstile = useTurnstile();
  const searchParams = useSearchParams();

  // `window` follows the waves: between two of them, or with every wave full,
  // an intake is shut although its period runs on, because the API refuses a
  // registration then. `opensAt` and `closesAt` are the days that changes.
  const openIntakes = intakes.filter((i) => i.period.window === "open");
  const nextIntake = [...intakes]
    .filter((i) => i.period.window === "upcoming" && i.period.opensAt)
    .sort((a, b) => a.period.opensAt!.localeCompare(b.period.opensAt!))[0];
  const periodWindow = intakesLoading
    ? "loading"
    : openIntakes.length
      ? "open"
      : nextIntake
        ? "upcoming"
        : intakes.length
          ? "closed"
          : "none";

  const [activeTab, setActiveTab] = useState("info");
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  // A NIK under 16 digits is "not finished yet", not "wrong": the message waits
  // for the field to lose focus or for the registrant to try to move on, so it
  // does not shout at someone who is still typing the 16th digit.
  const [nikTouched, setNikTouched] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successData, setSuccessData] = useState<{
    registrationNumber: string;
    name: string;
  } | null>(null);
  const chosenIntake = openIntakes.find((i) => i.unit.id === formData.unitId);
  // What the banner and the countdown speak of: the chosen unit's intake, or
  // the open one that closes first — at the end of its running wave, when the
  // wave's discount goes with it, not at the end of the period.
  const closesOf = (i: (typeof intakes)[number]) =>
    i.period.closesAt ?? i.period.endDate;
  const bannerIntake =
    chosenIntake ??
    [...openIntakes].sort((a, b) => closesOf(a).localeCompare(closesOf(b)))[0];
  const bannerCloses = bannerIntake ? closesOf(bannerIntake) : null;
  const bannerWave = bannerIntake?.waves.find(
    (w) => w.window === "open" && w.endDate === bannerCloses,
  );
  const openUnits = openIntakes.map((i) => i.unit.name).join(comma);

  // Capture source/campaign from URL
  useEffect(() => {
    const source = searchParams.get("source");
    const campaignId = searchParams.get("campaign_id");

    if (source || campaignId) {
      setFormData((prev) => ({
        ...prev,
        source: source || undefined,
        campaignId: campaignId || undefined,
      }));
    }
  }, [searchParams]);

  const [files, setFiles] = useState<{
    photo: File | null;
    birthCertificate: File | null;
    familyCard: File | null;
    ktp: File | null;
  }>({
    photo: null,
    birthCertificate: null,
    familyCard: null,
    ktp: null,
  });

  const [ocrResults, setOcrResults] = useState<
    Record<
      string,
      { status: "WARNING" | "MISMATCH"; notes: string[]; sha256?: string }
    >
  >({});
  // A null result means the field no longer holds a scanned image (the
  // applicant replaced it with a PDF), so its verdict must be dropped.
  const setOcrResult =
    (key: string) =>
    (
      res: {
        status: "WARNING" | "MISMATCH";
        notes: string[];
        sha256?: string;
      } | null,
    ) =>
      setOcrResults((prev) => {
        const next = { ...prev };
        if (res) next[key] = res;
        else delete next[key];
        return next;
      });
  const [activeRegistration, setActiveRegistration] = useState<{
    registrantId: string;
    registrationToken: string;
    registrationNo: string;
  } | null>(null);
  /**
   * UU PDP 27/2022 Pasal 20 dan 25: the parent/guardian consents before the
   * child's data is sent. The checkbox starts unchecked — a pre-ticked consent
   * is not a consent — and the API refuses a submission without it.
   */
  const [consent, setConsent] = useState(false);
  // The version the guardian actually ticked, frozen at that moment. If the
  // foundation publishes a new version while the form is open, the live value
  // changes but the consent still names the text the guardian read — the
  // evidence may not point at text that was never on their screen.
  const [consentedVersion, setConsentedVersion] = useState<number | null>(null);
  // The policy version the visitor is consenting to. Fetched so the recorded
  // consent names the text actually read, and so the form can explain when the
  // foundation has not published one yet (the API would refuse anyway).
  const { data: privacyPolicy } = usePrivacyPolicyCurrent();

  const steps = [
    { id: "student", title: t.steps.student, icon: User },
    { id: "parent", title: t.steps.parent, icon: Users },
    { id: "address", title: t.steps.address, icon: MapPin },
    { id: "quran", title: t.steps.quran, icon: BookOpen },
    { id: "documents", title: t.steps.documents, icon: Upload },
    { id: "confirm", title: t.steps.confirm, icon: CheckCircle2 },
  ];

  const handlePrev = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  /**
   * The NIK carries its own birth date and sex (Dukcapil: digits 7–12 are
   * DD MM YY, +40 for girls), so a typo there is caught without reading any
   * image. `null` means "nothing to complain about" — an empty NIK included.
   */
  const nikProblem = (() => {
    const check = checkNik({
      nationalId: formData.nationalId,
      birthDate: formData.birthDate,
      gender: formData.gender,
    });
    if (check.status === "invalid-format") return "format" as const;
    if (check.status === "invalid-date") return "date" as const;
    if (check.status === "mismatch")
      return check.fields.includes("birthDate")
        ? ("birthDate" as const)
        : ("gender" as const);
    return null;
  })();

  const handleNext = () => {
    // Validation per step
    if (currentStep === 0) {
      setNikTouched(true);
      if (
        !formData.fullName ||
        !formData.gender ||
        !formData.birthPlace ||
        !formData.birthDate ||
        !formData.unitId
      ) {
        toast.error(t.toasts.studentIncomplete);
        return;
      }
      // A filled NIK must agree with the birth date and sex above it, or the
      // form moves on with a typo nobody catches until the unit files the
      // santri's data months later.
      if (nikProblem) {
        toast.error(t.student.nikError(nikProblem));
        return;
      }
    }
    if (currentStep === 1) {
      if (
        !formData.fatherName ||
        !formData.motherName ||
        !formData.fatherPhone
      ) {
        toast.error(t.toasts.parentIncomplete);
        return;
      }
    }
    if (currentStep === 2) {
      if (!formData.address || !formData.city || !formData.province) {
        toast.error(t.toasts.addressIncomplete);
        return;
      }
    }
    // Quran step (3) is optional or has defaults

    setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1));
  };

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    field: keyof typeof files,
  ) => {
    if (e.target.files && e.target.files[0]) {
      setFiles((prev) => ({ ...prev, [field]: e.target.files![0] }));
    }
  };

  const uploadSelectedDocuments = async (
    registrantId: string,
    registrationToken?: string,
  ) => {
    const fileEntries: {
      key: keyof typeof files;
      file: File | null;
      type: string;
      label: string;
    }[] = [
      {
        key: "photo",
        file: files.photo,
        type: "PHOTO",
        label: t.documents.photo,
      },
      {
        key: "ktp",
        file: files.ktp,
        type: "ID_CARD",
        label: t.documents.idCard,
      },
      {
        key: "familyCard",
        file: files.familyCard,
        type: "FAMILY_CARD",
        label: t.documents.familyCard,
      },
      {
        key: "birthCertificate",
        file: files.birthCertificate,
        type: "BIRTH_CERTIFICATE",
        label: t.documents.birthCertificate,
      },
    ];

    const failedKeys: (keyof typeof files)[] = [];
    const failedLabels: string[] = [];

    for (const { key, file, type, label } of fileEntries) {
      if (!file) continue;

      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = (err) => reject(err);
          reader.readAsDataURL(file);
        });

        const ocr = ocrResults[key];
        await api.post(
          `/admissions/public/registrants/${registrantId}/documents`,
          {
            type,
            base64,
            fileName: file.name,
            registrationToken,
            ocrNotes: ocr?.notes,
            ocrStatus: ocr?.status,
            ocrSha256: ocr?.sha256,
          },
        );
      } catch (err: any) {
        failedKeys.push(key);
        failedLabels.push(label);
        console.error(`Failed to upload ${type} document:`, err);
      }
    }

    return { failedKeys, failedLabels };
  };

  const handleRetryUpload = async () => {
    if (!activeRegistration) return;
    setIsSubmitting(true);
    try {
      const { failedKeys, failedLabels } = await uploadSelectedDocuments(
        activeRegistration.registrantId,
        activeRegistration.registrationToken,
      );

      setFiles((prev) => {
        const next = { ...prev };
        if (!failedKeys.includes("photo")) next.photo = null;
        if (!failedKeys.includes("ktp")) next.ktp = null;
        if (!failedKeys.includes("familyCard")) next.familyCard = null;
        if (!failedKeys.includes("birthCertificate"))
          next.birthCertificate = null;
        return next;
      });

      if (failedLabels.length === 0) {
        toast.success(t.toasts.uploadsDone);
        setSuccessData({
          registrationNumber: activeRegistration.registrationNo,
          name: formData.fullName,
        });
        setActiveRegistration(null);
        setFormData(initialFormData);
        // The consent covered THIS child. Clearing it here — and not while
        // uploads are still retrying, which is the same registration — keeps a
        // second child from inheriting a tick the guardian never gave.
        setConsent(false);
        setConsentedVersion(null);
        setCurrentStep(0);
      } else {
        toast.error(t.toasts.uploadsStillFailing(failedLabels.join(comma)));
      }
    } catch (err) {
      toast.error(t.toasts.retryFailed);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (activeRegistration) {
      return handleRetryUpload();
    }
    if (!turnstile.ready) return;
    // UU PDP 27/2022 Pasal 20 dan 25: without the guardian's consent there is
    // no lawful basis to send a child's data, so the form stops here rather
    // than letting the API answer 400. The API enforces the same rule; this is
    // the message the parent can act on.
    if (!consent) {
      toast.error(t.confirm.consentRequired);
      return;
    }
    // No published policy version means there is no text to consent to. The API
    // refuses such a submission, so say why here instead.
    if (!privacyPolicy) {
      toast.error(t.confirm.consentUnavailable);
      return;
    }
    setIsSubmitting(true);
    try {
      const admissionPeriodId = chosenIntake?.period.id;
      if (!admissionPeriodId) {
        toast.error(t.toasts.unitNotOpen);
        setIsSubmitting(false);
        return;
      }

      const birthDateIso = formData.birthDate
        ? new Date(`${formData.birthDate}T00:00:00.000Z`).toISOString()
        : "";

      const payload: Record<string, unknown> = {
        admissionPeriodId,
        fullName: formData.fullName,
        gender: formData.gender,
        birthPlace: formData.birthPlace,
        birthDate: birthDateIso,
        address: formData.address,
        fatherName: formData.fatherName,
        motherName: formData.motherName,
      };

      if (formData.nickname) payload.nickname = formData.nickname;
      if (formData.nationalId) payload.nationalId = formData.nationalId;
      if (formData.familyCardNumber)
        payload.familyCardNumber = formData.familyCardNumber;
      if (formData.village) payload.village = formData.village;
      if (formData.district) payload.district = formData.district;
      if (formData.city) payload.city = formData.city;
      if (formData.province) payload.province = formData.province;
      if (formData.postalCode) payload.postalCode = formData.postalCode;
      if (formData.previousSchool)
        payload.previousSchool = formData.previousSchool;
      if (formData.previousSchoolAddress)
        payload.previousSchoolAddress = formData.previousSchoolAddress;
      if (formData.graduationYear)
        payload.graduationYear = Number(formData.graduationYear);
      if (formData.fatherOccupation)
        payload.fatherOccupation = formData.fatherOccupation;
      if (formData.fatherPhone) payload.fatherPhone = formData.fatherPhone;
      if (formData.fatherEmail) payload.fatherEmail = formData.fatherEmail;
      if (formData.motherOccupation)
        payload.motherOccupation = formData.motherOccupation;
      if (formData.motherPhone) payload.motherPhone = formData.motherPhone;
      if (formData.quranAbility) payload.quranAbility = formData.quranAbility;
      if (formData.memorizedJuz)
        payload.memorizedJuz = Number(formData.memorizedJuz);
      if (formData.source) payload.source = formData.source;
      if (formData.campaignId) payload.campaignId = formData.campaignId;

      if (turnstile.token) payload.turnstileToken = turnstile.token;

      // The guardian's consent, with the policy version they read (UU PDP
      // 27/2022 Pasal 20, 25). The API records the time and the caller's IP
      // itself; the version has to come from here because only the browser saw
      // which text was on screen.
      payload.consent = true;
      // The version frozen when the guardian ticked the box, not the live one:
      // a republication mid-form must not silently re-point the consent.
      payload.consentVersion = consentedVersion ?? privacyPolicy.version;

      // POST /admissions/public/registrants answers with the registrant's id,
      // number and upload token. The page used to fall back to a number of
      // its own ("PSB-" + the time), which no record holds and the tracker
      // could never find.
      const result = await createRegistration.mutateAsync(payload);
      const createdRegistrantId: string = result.id;
      const registrationToken: string = result.registrationToken;
      const registrationNo: string = result.registrationNo;

      if (createdRegistrantId) {
        const { failedKeys, failedLabels } = await uploadSelectedDocuments(
          createdRegistrantId,
          registrationToken,
        );

        setFiles((prev) => {
          const next = { ...prev };
          if (!failedKeys.includes("photo")) next.photo = null;
          if (!failedKeys.includes("ktp")) next.ktp = null;
          if (!failedKeys.includes("familyCard")) next.familyCard = null;
          if (!failedKeys.includes("birthCertificate"))
            next.birthCertificate = null;
          return next;
        });

        if (failedLabels.length > 0) {
          toast.error(
            t.toasts.savedButUploadsFailed(
              registrationNo,
              failedLabels.join(comma),
            ),
          );
          setActiveRegistration({
            registrantId: createdRegistrantId,
            registrationToken,
            registrationNo,
          });
          return;
        }
      }

      setSuccessData({
        registrationNumber: registrationNo,
        name: formData.fullName,
      });

      // Reset form on full success. The guardian's consent goes with it: the
      // next child on this page must be ticked for afresh, or the record would
      // show a consent the guardian never gave for that child.
      setActiveRegistration(null);
      setFormData(initialFormData);
      setConsent(false);
      setConsentedVersion(null);
      setCurrentStep(0);
    } catch (error: any) {
      // The API's own reason (a full wave, a closed period) is in Indonesian;
      // it follows the reader's own sentence rather than replacing it.
      const reason =
        error?.response?.data?.error?.message ?? error?.response?.data?.message;
      toast.error(
        reason ? `${t.toasts.submitFailed} (${reason})` : t.toasts.submitFailed,
      );
      // Token sekali pakai; percobaan berikutnya butuh tantangan baru.
      turnstile.refresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <LandingNavbar />

      {/*
        The page had no <h1> and only ~650 characters — the thinnest page on the
        site, and the one every ad would point at. Its own header also read
        "PSB Online": Kemendikdasmen replaced PPDB/PSB with SPMB from the
        2025/2026 intake, so the page contradicted the rest of the site.
      */}
      <section className="border-b border-border bg-white pt-16">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            {t.hero.title(siteConfig.name)}
          </h1>
          <p className="mt-4 text-lg text-muted-foreground text-pretty">
            {/*
              This used to end "...dan tidak dipungut biaya." The active period
              in the record carries a registrationFee of Rp 350.000, so the page
              asserted free registration while the system charged for it. Fee
              and unit are period-scoped: they are now stated from the period
              itself, in the banner below, and not fixed here.
            */}
            {t.hero.intro}
          </p>
          <p className="mt-3 text-muted-foreground">
            {t.hero.fillIn} <strong>{t.tabs.info}</strong>
            {t.hero.thenSave} <strong>{t.tabs.check}</strong>
            {t.hero.askUs}{" "}
            {/* A number reads left to right in every language. */}
            <a
              href={`tel:+${siteConfig.contact.phoneE164}`}
              dir="ltr"
              className="font-medium text-primary underline underline-offset-4"
            >
              {siteConfig.contact.phone}
            </a>{" "}
            {t.hero.or}{" "}
            <a
              href={siteConfig.contact.whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline underline-offset-4"
            >
              WhatsApp
            </a>
            .
          </p>

          <figure className="mt-8">
            <div className="relative aspect-[16/7] overflow-hidden rounded-xl border border-border shadow-lg">
              <Image
                src={photo.src}
                alt={photo.alt}
                fill
                sizes="(max-width: 768px) 100vw, 768px"
                className="object-cover"
                priority
              />
            </div>
            <figcaption className="mt-2 text-sm text-muted-foreground">
              {photo.alt}
            </figcaption>
          </figure>
        </div>
      </section>

      <main
        id="main-content"
        className="flex-1 max-w-3xl mx-auto px-4 py-8 w-full"
      >
        {/* Radix sets its own `dir="ltr"` unless told otherwise
            (lessons/radix-direction-defaults-ltr). */}
        <Tabs
          dir={dir}
          value={activeTab}
          onValueChange={setActiveTab}
          className="space-y-6"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="info">{t.tabs.info}</TabsTrigger>
            <TabsTrigger value="check">{t.tabs.check}</TabsTrigger>
          </TabsList>

          {/* Info & Registration Tab */}
          <TabsContent value="info" className="space-y-6">
            <PublicIntakes
              locale={locale}
              intakes={intakes}
              onRegister={(unitId) => {
                setFormData((prev) => ({ ...prev, unitId }));
                setCurrentStep(0);
                document
                  .getElementById("spmb-form-start")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            />
            {periodWindow === "loading" ? null : periodWindow !== "open" ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <div className="w-16 h-16 bg-gray-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                    <Calendar
                      className="h-8 w-8 text-gray-400"
                      aria-hidden="true"
                    />
                  </div>
                  {/* h2, matching the period-name heading in the open state:
                      this card replaces it, so the outline stays h1 -> h2 -> h3
                      whichever branch renders. */}
                  <h2 className="text-lg font-semibold">
                    {periodWindow === "closed"
                      ? t.shut.closedTitle
                      : t.shut.upcomingTitle}
                  </h2>
                  <p className="mx-auto mt-2 max-w-md text-muted-foreground text-pretty">
                    {periodWindow === "upcoming" && nextIntake
                      ? t.shut.upcomingBody(
                          nextIntake.unit.name,
                          formatDay(nextIntake.period.opensAt!),
                        )
                      : periodWindow === "closed"
                        ? t.shut.closedBody
                        : t.shut.noneBody}
                  </p>
                  {/*
                    No contact buttons here. A closed form needs to offer a way
                    through, but the "Butuh Bantuan?" card below is outside the
                    tabs and always visible with the same number and address —
                    repeating them put the identical pair twice on one screen.
                  */}
                </CardContent>
              </Card>
            ) : (
              <>
                <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
                  <CardContent className="pt-6">
                    <div className="flex flex-col md:flex-row justify-between gap-4">
                      {/* Clear of the fixed navbar when "Daftar ke unit
                          ini" scrolls here. */}
                      <div id="spmb-form-start" className="scroll-mt-32">
                        <h2 className="text-2xl font-bold text-green-900">
                          {t.banner.title}
                        </h2>
                        <p className="text-green-700 mt-1">
                          {chosenIntake
                            ? bannerWave
                              ? t.banner.chosen(
                                  chosenIntake.period.name,
                                  bannerWave.name,
                                  formatDay(bannerCloses!),
                                )
                              : t.banner.chosenNoWave(
                                  chosenIntake.period.name,
                                  formatDay(bannerCloses!),
                                )
                            : bannerWave
                              ? t.banner.open(
                                  openUnits,
                                  bannerWave.name,
                                  formatDay(bannerCloses!),
                                )
                              : t.banner.openNoWave(
                                  openUnits,
                                  formatDay(bannerCloses!),
                                )}
                        </p>
                        {/*
                          Which unit this period admits to, and what it costs.
                          Both are period-scoped in the data, so stating either
                          as fixed page copy contradicts the record as soon as
                          a different period becomes current.
                        */}
                        {chosenIntake && (
                          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-green-800">
                            <span>
                              {t.banner.unit}:{" "}
                              <strong>{chosenIntake.unit.name}</strong>
                            </span>
                            {/* What is billed on registering. With no fee
                                billed, "Gratis" only where the unit has no
                                fee table above that could say otherwise. */}
                            {(Number(chosenIntake.period.registrationFee) > 0 ||
                              chosenIntake.fees.length === 0) && (
                              <span data-testid="spmb-registration-fee">
                                {t.banner.registrationFee}:{" "}
                                <strong>
                                  {Number(chosenIntake.period.registrationFee) >
                                  0
                                    ? formatRupiah(
                                        chosenIntake.period.registrationFee,
                                      )
                                    : t.banner.free}
                                </strong>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="bg-white/50 p-3 rounded-lg border border-green-100 backdrop-blur-sm self-start">
                        <div className="text-sm text-green-800 font-medium">
                          {t.banner.timeLeft}
                        </div>
                        {/*
                          No `Math.max(0, …)` clamp here any more. This branch
                          only renders while the window is open, so the value
                          cannot be negative; clamping it was what let an
                          expired period display a reassuring "0 Hari".
                        */}
                        <div className="text-2xl font-bold text-green-600">
                          {t.banner.days(
                            formatNumber(
                              locale,
                              differenceInDays(
                                new Date(bannerCloses!),
                                new Date(),
                              ),
                            ),
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Progress Steps */}
                <div className="relative">
                  <div className="absolute top-1/2 start-0 w-full h-0.5 bg-gray-200 -z-10" />
                  <div className="flex justify-between">
                    {steps.map((step, index) => {
                      const Icon = step.icon;
                      const isActive = index === currentStep;
                      const isCompleted = index < currentStep;

                      return (
                        <div
                          key={step.id}
                          className="flex flex-col items-center gap-2 bg-gray-50 px-2"
                        >
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                              isActive
                                ? "bg-green-600 text-white ring-4 ring-green-100"
                                : isCompleted
                                  ? "bg-green-100 text-green-600"
                                  : "bg-gray-200 text-gray-400"
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                          </div>
                          <span
                            className={`text-xs font-medium hidden sm:block ${isActive ? "text-green-600" : "text-gray-500"}`}
                          >
                            {step.title}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Form Content */}
                <Card>
                  <CardHeader>
                    <CardTitle>{steps[currentStep].title}</CardTitle>
                    <CardDescription>{t.stepHint}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Step 1: Student Data */}
                    {currentStep === 0 && (
                      <div className="grid gap-4">
                        <div className="space-y-2">
                          <Label>{t.student.unit}</Label>
                          <Select
                            dir={dir}
                            value={formData.unitId}
                            onValueChange={(v) =>
                              setFormData({ ...formData, unitId: v })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue
                                placeholder={t.student.unitPlaceholder}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {/* Every unit with an intake; only an open one
                                  can be chosen. */}
                              {intakes.map((i) => (
                                <SelectItem
                                  key={i.unit.id}
                                  value={i.unit.id}
                                  disabled={i.period.window !== "open"}
                                >
                                  {i.unit.officialName ?? i.unit.name}
                                  {i.period.window === "upcoming"
                                    ? ` (${t.student.notOpenYet})`
                                    : i.period.window === "closed"
                                      ? ` (${t.student.closed})`
                                      : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>{t.student.fullName}</Label>
                            <Input
                              value={formData.fullName}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  fullName: e.target.value,
                                })
                              }
                              placeholder={t.student.fullNamePlaceholder}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>{t.student.nickname}</Label>
                            <Input
                              value={formData.nickname}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  nickname: e.target.value,
                                })
                              }
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>{t.student.birthPlace}</Label>
                            <Input
                              value={formData.birthPlace}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  birthPlace: e.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>{t.student.birthDate}</Label>
                            <Input
                              type="date"
                              value={formData.birthDate}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  birthDate: e.target.value,
                                })
                              }
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label>{t.student.gender}</Label>
                          <Select
                            dir={dir}
                            value={formData.gender}
                            onValueChange={(v) =>
                              setFormData({ ...formData, gender: v as Gender })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue
                                placeholder={t.student.genderPlaceholder}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="MALE">
                                {t.student.male}
                              </SelectItem>
                              <SelectItem value="FEMALE">
                                {t.student.female}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>{t.student.nationalId}</Label>
                            <Input
                              value={formData.nationalId}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  nationalId: e.target.value,
                                })
                              }
                              maxLength={16}
                              inputMode="numeric"
                              onBlur={() => setNikTouched(true)}
                              aria-invalid={nikTouched && nikProblem !== null}
                              aria-describedby={
                                nikTouched && nikProblem
                                  ? "spmb-nik-error"
                                  : undefined
                              }
                            />
                            {nikTouched && nikProblem && (
                              <p
                                id="spmb-nik-error"
                                data-testid="spmb-nik-error"
                                className="text-sm text-destructive"
                              >
                                {t.student.nikError(nikProblem)}
                              </p>
                            )}
                          </div>
                          <div className="space-y-2">
                            <Label>{t.student.familyCard}</Label>
                            <Input
                              value={formData.familyCardNumber}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  familyCardNumber: e.target.value,
                                })
                              }
                              maxLength={16}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Step 2: Parent Data */}
                    {currentStep === 1 && (
                      <div className="space-y-6">
                        <div className="space-y-4">
                          <h4 className="font-semibold flex items-center gap-2">
                            <User className="h-4 w-4" />{" "}
                            {t.parent.fatherHeading}
                          </h4>
                          <div className="grid gap-4">
                            <div className="space-y-2">
                              <Label>{t.parent.fatherName}</Label>
                              <Input
                                value={formData.fatherName}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    fatherName: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label>{t.parent.occupation}</Label>
                                <Input
                                  value={formData.fatherOccupation}
                                  onChange={(e) =>
                                    setFormData({
                                      ...formData,
                                      fatherOccupation: e.target.value,
                                    })
                                  }
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>{t.parent.whatsapp}</Label>
                                <Input
                                  value={formData.fatherPhone}
                                  onChange={(e) =>
                                    setFormData({
                                      ...formData,
                                      fatherPhone: e.target.value,
                                    })
                                  }
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <h4 className="font-semibold flex items-center gap-2">
                            <User className="h-4 w-4" />{" "}
                            {t.parent.motherHeading}
                          </h4>
                          <div className="grid gap-4">
                            <div className="space-y-2">
                              <Label>{t.parent.motherName}</Label>
                              <Input
                                value={formData.motherName}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    motherName: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label>{t.parent.occupation}</Label>
                                <Input
                                  value={formData.motherOccupation}
                                  onChange={(e) =>
                                    setFormData({
                                      ...formData,
                                      motherOccupation: e.target.value,
                                    })
                                  }
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>{t.parent.whatsapp}</Label>
                                <Input
                                  value={formData.motherPhone}
                                  onChange={(e) =>
                                    setFormData({
                                      ...formData,
                                      motherPhone: e.target.value,
                                    })
                                  }
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Step 3: Address */}
                    {currentStep === 2 && (
                      <div className="grid gap-4">
                        <div className="space-y-2">
                          <Label>{t.address.street}</Label>
                          <Textarea
                            value={formData.address}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                address: e.target.value,
                              })
                            }
                            rows={3}
                          />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>{t.address.village}</Label>
                            <Input
                              value={formData.village}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  village: e.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>{t.address.district}</Label>
                            <Input
                              value={formData.district}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  district: e.target.value,
                                })
                              }
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label>{t.address.city}</Label>
                            <Input
                              value={formData.city}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  city: e.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>{t.address.province}</Label>
                            <Input
                              value={formData.province}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  province: e.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>{t.address.postalCode}</Label>
                            <Input
                              value={formData.postalCode}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  postalCode: e.target.value,
                                })
                              }
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Step 4: Quran Ability */}
                    {currentStep === 3 && (
                      <>
                        <div className="space-y-2">
                          <Label>{t.quran.ability}</Label>
                          <Select
                            dir={dir}
                            value={formData.quranAbility}
                            onValueChange={(v) =>
                              setFormData({ ...formData, quranAbility: v })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue
                                placeholder={t.quran.abilityPlaceholder}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {QURAN_ABILITIES.map((ability) => (
                                <SelectItem key={ability} value={ability}>
                                  {t.quran.abilities[ability]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label>{t.quran.juz}</Label>
                          <Input
                            type="number"
                            value={formData.memorizedJuz}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                memorizedJuz: e.target.value,
                              })
                            }
                            placeholder={t.quran.juzPlaceholder}
                            min={0}
                            max={30}
                          />
                          <p className="text-xs text-muted-foreground">
                            {t.quran.juzHint}
                          </p>
                        </div>

                        <Card className="bg-amber-50 border-amber-200">
                          <CardContent className="pt-4">
                            <div className="flex items-start gap-3">
                              <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                              <div className="text-sm">
                                <p className="font-medium text-amber-800">
                                  {t.quran.noteTitle}
                                </p>
                                <p className="text-amber-700">{t.quran.note}</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </>
                    )}

                    {/* Step 5: Documents */}
                    {currentStep === 4 && (
                      <div className="space-y-6">
                        {activeRegistration && (
                          <Card className="bg-amber-50 border-amber-300">
                            <CardContent className="pt-4">
                              <div className="flex items-start gap-3">
                                <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                                <div className="text-sm">
                                  <p className="font-medium text-amber-900">
                                    {t.documents.savedTitle(
                                      activeRegistration.registrationNo,
                                    )}
                                  </p>
                                  <p className="text-amber-800">
                                    {t.documents.savedBody}
                                  </p>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        <Card className="bg-blue-50 border-blue-200">
                          <CardContent className="pt-4">
                            <div className="flex items-start gap-3">
                              <Info className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                              <div className="text-sm">
                                <p className="font-medium text-blue-800">
                                  {t.documents.instructionsTitle}
                                </p>
                                <p className="text-blue-700">
                                  {t.documents.instructions}
                                </p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>

                        <div className="space-y-4">
                          <DocumentCaptureField
                            label={t.documents.photo}
                            content={t.documents}
                            documentType="foto"
                            file={files.photo}
                            onFileSelect={(f) =>
                              setFiles((prev) => ({ ...prev, photo: f }))
                            }
                            onOcrResult={setOcrResult("photo")}
                          />

                          <DocumentCaptureField
                            label={t.documents.idCard}
                            content={t.documents}
                            documentType="ktp"
                            file={files.ktp}
                            userInputData={{
                              fullName:
                                formData.fatherName || formData.motherName,
                              // The KTP may belong to either parent; a name that
                              // matches either is a match, not a mismatch.
                              fullNameCandidates: [
                                formData.fatherName,
                                formData.motherName,
                              ].filter((name): name is string => Boolean(name)),
                            }}
                            onFileSelect={(f) =>
                              setFiles((prev) => ({ ...prev, ktp: f }))
                            }
                            onOcrResult={setOcrResult("ktp")}
                          />

                          <DocumentCaptureField
                            label={t.documents.familyCard}
                            content={t.documents}
                            documentType="kk"
                            file={files.familyCard}
                            userInputData={{
                              fullName: formData.fullName,
                              nationalId: formData.nationalId,
                              familyCardNumber: formData.familyCardNumber,
                              birthPlace: formData.birthPlace,
                              birthDate: formData.birthDate,
                            }}
                            onFileSelect={(f) =>
                              setFiles((prev) => ({ ...prev, familyCard: f }))
                            }
                            onOcrExtracted={(ext) => {
                              if (
                                ext.familyCardNumber &&
                                !formData.familyCardNumber
                              ) {
                                setFormData((prev) => ({
                                  ...prev,
                                  familyCardNumber: ext.familyCardNumber!,
                                }));
                              }
                            }}
                            onOcrResult={setOcrResult("familyCard")}
                          />

                          <DocumentCaptureField
                            label={t.documents.birthCertificate}
                            content={t.documents}
                            documentType="akta"
                            file={files.birthCertificate}
                            userInputData={{
                              fullName: formData.fullName,
                              birthPlace: formData.birthPlace,
                              birthDate: formData.birthDate,
                            }}
                            onFileSelect={(f) =>
                              setFiles((prev) => ({
                                ...prev,
                                birthCertificate: f,
                              }))
                            }
                            onOcrResult={setOcrResult("birthCertificate")}
                          />
                        </div>
                      </div>
                    )}

                    {/* Step 6: Confirmation */}
                    {currentStep === 5 && (
                      <div className="space-y-4">
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-base">
                              {t.confirm.studentHeading}
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="text-sm space-y-1">
                            <p>
                              <strong>{t.confirm.name}:</strong>{" "}
                              {formData.fullName}
                            </p>
                            <p>
                              <strong>{t.confirm.gender}:</strong>{" "}
                              {formData.gender === "MALE"
                                ? t.student.male
                                : t.student.female}
                            </p>
                            <p>
                              <strong>{t.confirm.born}:</strong>{" "}
                              {formData.birthPlace}
                              {comma}
                              {/* The day as typed, at noon WIB so no timezone
                                  can move it to the day before. */}
                              {formData.birthDate &&
                                formatDay(
                                  `${formData.birthDate}T12:00:00+07:00`,
                                )}
                            </p>
                            <p>
                              <strong>{t.confirm.unit}:</strong>{" "}
                              {chosenIntake?.unit.officialName ??
                                chosenIntake?.unit.name}
                            </p>
                          </CardContent>
                        </Card>

                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-base">
                              {t.confirm.parentHeading}
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="text-sm space-y-1">
                            <p>
                              <strong>{t.confirm.father}:</strong>{" "}
                              {formData.fatherName} (
                              <span dir="ltr">{formData.fatherPhone}</span>)
                            </p>
                            <p>
                              <strong>{t.confirm.mother}:</strong>{" "}
                              {formData.motherName}
                            </p>
                          </CardContent>
                        </Card>

                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-base">
                              {t.confirm.addressHeading}
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="text-sm">
                            <p>{formData.address}</p>
                            <p>
                              {[formData.village, formData.district]
                                .filter(Boolean)
                                .join(comma)}
                            </p>
                            <p>
                              {[formData.city, formData.province]
                                .filter(Boolean)
                                .join(comma)}{" "}
                              {formData.postalCode}
                            </p>
                          </CardContent>
                        </Card>

                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-base">
                              {t.confirm.documentsHeading}
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="text-sm space-y-1">
                            {/* All four the documents step asks for; the KTP
                                was missing from this summary. */}
                            {(
                              [
                                ["photo", t.documents.photo],
                                ["ktp", t.documents.idCard],
                                ["familyCard", t.documents.familyCard],
                                [
                                  "birthCertificate",
                                  t.documents.birthCertificate,
                                ],
                              ] as const
                            ).map(([key, label]) => (
                              <p key={key} className="flex items-center gap-2">
                                {files[key] ? (
                                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                                ) : (
                                  <AlertCircle className="h-4 w-4 text-gray-400" />
                                )}
                                {label}:{" "}
                                {files[key]
                                  ? t.confirm.uploaded
                                  : t.confirm.notUploaded}
                              </p>
                            ))}
                          </CardContent>
                        </Card>

                        <Card className="bg-blue-50 border-blue-200">
                          <CardContent className="pt-4">
                            <div className="flex items-start gap-3">
                              <CheckCircle2 className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                              <div className="text-sm">
                                <p className="font-medium text-blue-800">
                                  {t.confirm.statementTitle}
                                </p>
                                <p className="text-blue-700">
                                  {t.confirm.statement}
                                </p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>

                        {/* UU PDP 27/2022 Pasal 20 dan 25: persetujuan wali.
                            The checkbox is the lawful basis, not a formality —
                            the API refuses the submission without it. The
                            sentence is split into before/link/after so each
                            language places the anchor where its grammar puts
                            it. */}
                        <Card
                          className={
                            privacyPolicy
                              ? "border-primary/40"
                              : "border-amber-300 bg-amber-50"
                          }
                        >
                          <CardContent className="pt-4">
                            {privacyPolicy ? (
                              <div className="flex items-start gap-3">
                                <Checkbox
                                  id="spmb-consent"
                                  checked={consent}
                                  onCheckedChange={(value) => {
                                    const checked = value === true;
                                    setConsent(checked);
                                    // Freeze the version the guardian consents
                                    // to; clearing the box clears it too.
                                    setConsentedVersion(
                                      checked ? privacyPolicy.version : null,
                                    );
                                  }}
                                  className="mt-0.5"
                                />
                                <Label
                                  htmlFor="spmb-consent"
                                  className="text-sm font-normal leading-relaxed cursor-pointer"
                                >
                                  {t.confirm.consentBefore}{" "}
                                  <Link
                                    href={`/kebijakan-privasi?version=${privacyPolicy.version}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-medium text-primary underline underline-offset-2"
                                  >
                                    {t.confirm.consentLink}
                                  </Link>
                                  {t.confirm.consentAfter}
                                </Label>
                              </div>
                            ) : (
                              <div className="flex items-start gap-3 text-sm">
                                <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                                <p className="text-amber-800">
                                  {t.confirm.consentUnavailable}
                                </p>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </div>
                    )}
                  </CardContent>
                  {currentStep === steps.length - 1 && (
                    <div className="px-6 pb-2">
                      <TurnstileWidget
                        action="spmb-daftar"
                        {...turnstile.widgetProps}
                      />
                    </div>
                  )}
                  <CardFooter className="flex justify-between">
                    <Button
                      variant="outline"
                      onClick={handlePrev}
                      disabled={currentStep === 0}
                    >
                      <ChevronLeft className="h-4 w-4 me-2 rtl:rotate-180" />
                      {t.actions.previous}
                    </Button>
                    {currentStep < steps.length - 1 ? (
                      <Button onClick={handleNext}>
                        {t.actions.next}
                        <ChevronRight className="h-4 w-4 ms-2 rtl:rotate-180" />
                      </Button>
                    ) : (
                      <Button
                        onClick={handleSubmit}
                        disabled={isSubmitting || !turnstile.ready}
                      >
                        {isSubmitting ? t.actions.submitting : t.actions.submit}
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              </>
            )}
          </TabsContent>

          {/*
            Check Status Tab.

            This was an unbound <Input> beside a <Button> with no onClick — the
            page instructs parents to track their registration here, and the
            button did nothing when pressed. It also promised the registration
            number would arrive "via SMS/WhatsApp", which nothing in the system
            sends; the number is shown once, in the confirmation dialog after
            submitting.
          */}
          <TabsContent value="check">
            <h2 className="mb-1 text-xl font-semibold">{t.checkTab.heading}</h2>
            <p className="mb-6 text-sm text-muted-foreground">
              {t.checkTab.body}
            </p>
            <RegistrationTracker locale={locale} />
          </TabsContent>
        </Tabs>

        {/* Contact */}
        <Card className="mt-8 mb-12">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div>
                {/* h3, not h4: the preceding heading is an h2, and skipping a
                    level breaks the document outline for screen readers. */}
                <h3 className="font-semibold text-lg mb-2">{t.help.heading}</h3>
                <p className="text-muted-foreground">{t.help.body}</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-4">
                <a
                  href={`tel:+${siteConfig.contact.phoneE164}`}
                  className="flex items-center gap-2 text-blue-600 hover:underline"
                >
                  <Phone className="h-4 w-4" />
                  <span dir="ltr">{siteConfig.contact.phone}</span>
                </a>
                <a
                  href={`mailto:${siteConfig.contact.email}`}
                  className="flex items-center gap-2 text-blue-600 hover:underline"
                >
                  <Mail className="h-4 w-4" />
                  {siteConfig.contact.email}
                </a>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Shared site footer. The bespoke one here carried
          "© 2024 Yayasan Pendidikan Islam CIPANSOR" — a stale year and the
          wrong legal name (it is Yayasan Pesantren Cipansor). */}
      <LandingFooter />

      {/* Success Dialog */}
      <Dialog open={!!successData} onOpenChange={() => setSuccessData(null)}>
        <DialogContent className="sm:max-w-md text-center">
          <div className="py-6">
            <div className="w-16 h-16 bg-green-100 rounded-full mx-auto mb-4 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="text-xl font-semibold mb-2">{t.success.heading}</h3>
            <p className="text-muted-foreground mb-4">
              {t.success.thanks(successData?.name ?? "")}
            </p>
            <Card className="bg-blue-50 mb-4">
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">
                  {t.success.numberLabel}
                </p>
                <p className="text-2xl font-mono font-bold text-blue-600">
                  {successData?.registrationNumber}
                </p>
              </CardContent>
            </Card>
            {/* It used to promise news "via WhatsApp/SMS", which nothing in
                the system sends; the tracker is how a parent follows up. */}
            <p className="text-sm text-muted-foreground mb-6">
              {t.success.keepNumber}
            </p>
            <Button onClick={() => setSuccessData(null)} className="w-full">
              {t.success.close}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
