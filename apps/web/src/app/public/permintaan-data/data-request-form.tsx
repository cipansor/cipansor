"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LandingNavbar } from "@/components/landing/navbar";
import { LandingFooter } from "@/components/landing/footer";
import {
  TurnstileWidget,
  useTurnstile,
} from "@/components/security/turnstile-widget";
import {
  useSubmitPublicDataSubjectRequest,
  useVerifyPublicDataSubjectRequest,
} from "@/hooks/use-data-subject-requests";
import { dataRequestContentFor } from "@/config/data-request.i18n";
import { dirFor, type Locale } from "@/locales";
import { dateFormatterFor } from "@/lib/locale-format";
import {
  DATA_SUBJECT_REQUEST_TYPES,
  DATA_SUBJECT_REQUEST_TYPE_LABELS,
  type DataSubjectRequestType,
  type PublicDataSubjectRequestCreatedDTO,
  type PublicDataSubjectRequestVerifiedDTO,
} from "@cipansor/shared";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ShieldCheck,
} from "lucide-react";

/**
 * Formulir publik hak subjek data.
 *
 * Dua langkah, dan pemisahan itulah yang penting: langkah pertama TIDAK
 * mengungkap data subjek apa pun — ia hanya menjawab "nomor pendaftaran dan
 * tanggal lahir cocok" — dan nomor permintaan yang keluar darinya adalah
 * satu-satunya hal yang dapat ditanyakan kabarnya. Baru setelah kode yang
 * dikirim ke kontak TERDAFTAR diverifikasi, permintaan itu berstatus
 * `VERIFIED` (Pasal 33: identitas pemohon harus dapat dipastikan).
 *
 * Token Turnstile sekali pakai, jadi `refresh()` dipanggil setelah SETIAP
 * pengiriman — berhasil maupun gagal. Tanpa itu penukaran kedua ditolak
 * Cloudflare dengan `timeout-or-duplicate`, dan formulir yang benar terlihat
 * persis seperti formulir yang rusak.
 */
export function DataRequestForm({ locale }: { locale: Locale }) {
  const t = dataRequestContentFor(locale);
  const dir = dirFor(locale);
  const turnstile = useTurnstile();
  const submit = useSubmitPublicDataSubjectRequest();
  const verify = useVerifyPublicDataSubjectRequest();

  const [activeTab, setActiveTab] = useState("submit");

  const [type, setType] = useState<DataSubjectRequestType>("ACCESS");
  const [registrationNo, setRegistrationNo] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [requesterContact, setRequesterContact] = useState("");
  const [requesterRelation, setRequesterRelation] = useState("");
  const [detail, setDetail] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [created, setCreated] =
    useState<PublicDataSubjectRequestCreatedDTO | null>(null);

  const [verifyRequestNo, setVerifyRequestNo] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyFailure, setVerifyFailure] = useState<string | null>(null);
  const [verified, setVerified] =
    useState<PublicDataSubjectRequestVerifiedDTO | null>(null);

  const formatDay = (iso: string) =>
    dateFormatterFor(locale).format(new Date(iso));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFailure(null);
    if (!birthDate) {
      setFailure(t.errors.generic);
      return;
    }
    try {
      const result = await submit.mutateAsync({
        payload: {
          type,
          registrationNo,
          birthDate: new Date(birthDate),
          requesterName,
          requesterContact,
          ...(requesterRelation.trim()
            ? { requesterRelation: requesterRelation.trim() }
            : {}),
          detail,
        },
        turnstileToken: turnstile.token,
      });
      setCreated(result);
      setVerifyRequestNo(result.requestNo);
    } catch (err) {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ?? t.errors.generic;
      setFailure(message);
    } finally {
      // Sekali pakai: tantangan berikutnya harus baru, baik kirimannya
      // berhasil maupun gagal.
      turnstile.refresh();
    }
  };

  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    setVerifyFailure(null);
    try {
      const result = await verify.mutateAsync({
        requestNo: verifyRequestNo,
        code: verifyCode,
      });
      setVerified(result);
    } catch (err) {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ?? t.errors.generic;
      setVerifyFailure(message);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <LandingNavbar />

      <section className="border-b border-border bg-white pt-16">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            {t.hero.title}
          </h1>
          <p className="mt-4 text-lg text-muted-foreground text-pretty">
            {t.hero.intro}
          </p>
        </div>
      </section>

      <main
        id="main-content"
        className="mx-auto w-full max-w-3xl flex-1 px-4 py-8"
      >
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldCheck
                className="h-5 w-5 text-primary"
                aria-hidden="true"
              />
              {t.rights.heading}
            </CardTitle>
            <CardDescription>{t.rights.intro}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>{t.rights.access}</p>
            <p>{t.rights.rectification}</p>
            <p>{t.rights.consentWithdrawal}</p>
            <p>{t.rights.erasure}</p>
            <p className="pt-2 font-medium text-foreground">
              {t.rights.deadline}
            </p>
          </CardContent>
        </Card>

        {/* Radix sets its own `dir="ltr"` unless told otherwise. */}
        <Tabs dir={dir} value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="submit">{t.tabs.submit}</TabsTrigger>
            <TabsTrigger value="verify">{t.tabs.verify}</TabsTrigger>
          </TabsList>

          <TabsContent value="submit" className="mt-6">
            {created ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <CheckCircle2
                      className="h-5 w-5 text-green-600"
                      aria-hidden="true"
                    />
                    {t.submitted.heading}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p>
                    <span className="text-muted-foreground">
                      {t.submitted.requestNo}:{" "}
                    </span>
                    <strong className="font-mono">{created.requestNo}</strong>
                  </p>
                  <p>
                    <span className="text-muted-foreground">
                      {t.submitted.dueAt}:{" "}
                    </span>
                    {formatDay(created.dueAt)}
                  </p>
                  <p>{t.submitted.sentTo(created.verificationSentTo)}</p>
                  <p className="text-muted-foreground">
                    {t.submitted.nextStep}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setVerifyRequestNo(created.requestNo);
                      setActiveTab("verify");
                    }}
                  >
                    {t.submitted.goVerify}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t.form.heading}</CardTitle>
                  <CardDescription>{t.form.intro}</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="dsr-type">{t.form.type}</Label>
                      <Select
                        value={type}
                        onValueChange={(v) =>
                          setType(v as DataSubjectRequestType)
                        }
                      >
                        <SelectTrigger id="dsr-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DATA_SUBJECT_REQUEST_TYPES.map((value) => (
                            <SelectItem key={value} value={value}>
                              {DATA_SUBJECT_REQUEST_TYPE_LABELS[value]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="dsr-registrationNo">
                        {t.form.registrationNo}
                      </Label>
                      <Input
                        id="dsr-registrationNo"
                        value={registrationNo}
                        onChange={(e) => setRegistrationNo(e.target.value)}
                        placeholder={t.form.registrationNoPlaceholder}
                        required
                        minLength={3}
                        maxLength={50}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="dsr-birthDate">{t.form.birthDate}</Label>
                      <Input
                        id="dsr-birthDate"
                        type="date"
                        value={birthDate}
                        onChange={(e) => setBirthDate(e.target.value)}
                        required
                      />
                      <p className="text-xs text-muted-foreground">
                        {t.form.birthDateHint}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="dsr-requesterName">
                        {t.form.requesterName}
                      </Label>
                      <Input
                        id="dsr-requesterName"
                        value={requesterName}
                        onChange={(e) => setRequesterName(e.target.value)}
                        required
                        minLength={3}
                        maxLength={150}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="dsr-requesterContact">
                        {t.form.requesterContact}
                      </Label>
                      <Input
                        id="dsr-requesterContact"
                        value={requesterContact}
                        onChange={(e) => setRequesterContact(e.target.value)}
                        required
                        minLength={5}
                        maxLength={255}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t.form.requesterContactHint}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="dsr-requesterRelation">
                        {t.form.requesterRelation}
                      </Label>
                      <Input
                        id="dsr-requesterRelation"
                        value={requesterRelation}
                        onChange={(e) => setRequesterRelation(e.target.value)}
                        placeholder={t.form.requesterRelationPlaceholder}
                        maxLength={50}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="dsr-detail">{t.form.detail}</Label>
                      <Textarea
                        id="dsr-detail"
                        value={detail}
                        onChange={(e) => setDetail(e.target.value)}
                        placeholder={t.form.detailPlaceholder}
                        required
                        minLength={10}
                        maxLength={5000}
                        rows={5}
                      />
                    </div>

                    {/*
                      `action` is a literal, not a constant: the contract test
                      (apps/api/src/middleware/turnstile-actions.contract.test.ts)
                      reads this JSX from source and matches
                      `requireTurnstile('pdp-permintaan-data')` in the routes
                      file. A variable would compile and then fail that test.
                    */}
                    <TurnstileWidget
                      action="pdp-permintaan-data"
                      {...turnstile.widgetProps}
                    />

                    {turnstile.blocked && (
                      <p className="text-sm text-muted-foreground">
                        {t.form.gateBlocked}
                      </p>
                    )}

                    {failure && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                        <AlertDescription>{failure}</AlertDescription>
                      </Alert>
                    )}

                    <div className="flex flex-col gap-3">
                      <Button
                        type="submit"
                        disabled={submit.isPending || !turnstile.ready}
                        className="w-full"
                      >
                        {submit.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {t.form.submitting}
                          </>
                        ) : (
                          t.form.submit
                        )}
                      </Button>
                      {!turnstile.ready && !turnstile.blocked && (
                        <p className="text-center text-xs text-muted-foreground">
                          {t.form.gateWaiting}
                        </p>
                      )}
                      <Link
                        href="/kebijakan-privasi"
                        className="text-center text-sm text-primary underline underline-offset-4"
                      >
                        {t.form.privacyLink}
                      </Link>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="verify" className="mt-6">
            {verified ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <CheckCircle2
                      className="h-5 w-5 text-green-600"
                      aria-hidden="true"
                    />
                    {t.verify.successHeading}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p>
                    {t.verify.successBody(
                      verified.requestNo,
                      formatDay(verified.dueAt),
                    )}
                  </p>
                  <p className="text-muted-foreground">{t.verify.nextStep}</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t.verify.heading}</CardTitle>
                  <CardDescription>{t.verify.intro}</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleVerify} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="dsr-verifyRequestNo">
                        {t.verify.requestNo}
                      </Label>
                      <Input
                        id="dsr-verifyRequestNo"
                        value={verifyRequestNo}
                        onChange={(e) => setVerifyRequestNo(e.target.value)}
                        required
                        minLength={3}
                        maxLength={50}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="dsr-verifyCode">{t.verify.code}</Label>
                      <Input
                        id="dsr-verifyCode"
                        value={verifyCode}
                        onChange={(e) => setVerifyCode(e.target.value)}
                        inputMode="numeric"
                        pattern="\d{6}"
                        maxLength={6}
                        required
                      />
                      <p className="text-xs text-muted-foreground">
                        {t.verify.codeHint}
                      </p>
                    </div>

                    {verifyFailure && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                        <AlertDescription>{verifyFailure}</AlertDescription>
                      </Alert>
                    )}

                    <Button
                      type="submit"
                      disabled={verify.isPending}
                      className="w-full"
                    >
                      {verify.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {t.verify.submitting}
                        </>
                      ) : (
                        t.verify.submit
                      )}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </main>

      <LandingFooter />
    </div>
  );
}
