import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Mail, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PublicPage } from "@/components/landing/public-page";
import { siteConfig } from "@/config/site";
import { pagesContentFor } from "@/config/pages.i18n";
import { getServerLocale } from "@/lib/server-locale";
import { dateFormatterFor } from "@/lib/locale-format";
import {
  fetchCurrentPrivacyPolicy,
  fetchPrivacyPolicyVersion,
} from "@/lib/privacy-policy.server";
import { galleryPhoto } from "@/config/page-photo";

/**
 * /kebijakan-privasi — the public, versioned Privacy Policy (UU PDP 27/2022
 * Pasal 30, 35).
 *
 * It is the page the SPMB consent checkbox links to: a parent must be able to
 * read the notice before consenting, and the consent records the version this
 * page showed. The text itself lives in the database, published by a Super
 * Admin, not in this file — the foundation decides its controller identity and
 * retention periods, and those change without a deploy.
 *
 * The page resolves even when no version is published (the fetch degrades to
 * `null`): a dead link on the one page the consent points at is worse than an
 * honest "not yet", and the SPMB form refuses to take consent until a version
 * exists anyway.
 */
export async function generateMetadata(): Promise<Metadata> {
  const copy = pagesContentFor(await getServerLocale()).privacy;
  return {
    title: `${copy.title} — ${siteConfig.legalName}`,
    description: copy.metaDescription,
    metadataBase: new URL(siteConfig.url),
    alternates: { canonical: "/kebijakan-privasi" },
  };
}

export default async function KebijakanPrivasiPage({
  searchParams,
}: {
  searchParams: Promise<{ version?: string }>;
}) {
  const locale = await getServerLocale();
  const copy = pagesContentFor(locale).privacy;
  // When the SPMB consent link pins a version (`?version=N`), show exactly that
  // text: the parent then reads, and consents to, the number the form records.
  // Otherwise show the currently-effective version. Either way a version that is
  // not published yet (or a stale link) degrades to `null` → "not yet".
  const { version } = await searchParams;
  const pinnedVersion =
    version && /^\d+$/.test(version) ? Number(version) : null;
  const policy =
    pinnedVersion !== null
      ? await fetchPrivacyPolicyVersion(pinnedVersion)
      : await fetchCurrentPrivacyPolicy();
  // The reader's own language; the policy stores all three. Falls back to
  // Indonesian, which is the language the text is authored in.
  const text = policy?.texts[locale] ?? policy?.texts.id ?? null;
  const effectiveDate = policy
    ? dateFormatterFor(locale).format(new Date(policy.effectiveAt))
    : null;

  return (
    <PublicPage
      title={copy.title}
      lead={copy.lead}
      breadcrumb={[{ label: copy.title, href: "/kebijakan-privasi" }]}
      heroImage={galleryPhoto("fasilitas", 5, locale)}
    >
      <div className="mx-auto max-w-3xl">
        {policy && text ? (
          <>
            <div className="mb-6 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 font-medium text-primary">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                {copy.versionLabel(policy.version)}
              </span>
              {effectiveDate && (
                <span>{copy.effectiveSince(effectiveDate)}</span>
              )}
            </div>

            {/* The body is plain text published by the foundation, rendered
                with preserved line breaks — never `dangerouslySetInnerHTML`.
                The summary is the standfirst above it. */}
            <Card>
              <CardContent className="space-y-4 p-6">
                <p className="text-base font-medium leading-relaxed">
                  {text.summary}
                </p>
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {text.body}
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="p-6">
              <h2 className="font-semibold text-amber-900">
                {copy.notPublishedTitle}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-amber-800">
                {copy.notPublishedBody}
              </p>
            </CardContent>
          </Card>
        )}

        <Card className="mt-6">
          <CardContent className="p-6">
            <h2 className="flex items-center gap-2 font-semibold">
              <Mail className="h-4 w-4" aria-hidden="true" />
              {copy.contactHeading}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {copy.contactBody}
            </p>
            <Button asChild variant="outline" size="sm" className="mt-4">
              <Link href="/kontak">
                {pagesContentFor(locale).contact.title}
              </Link>
            </Button>
            {/*
              The route into the DataSubjectRequest flow (UU PDP 27/2022 Pasal
              30, 40, 43). Until #1111 this page named the right but offered
              only a contact page: a request left no record and no deadline,
              which is the gap the flow closes. `/public/*` is public on the
              apex already (middleware's matcher excludes it), so no host-split
              change is needed.
            */}
            <Button asChild size="sm" className="mt-4 sm:ml-2">
              <Link href="/public/permintaan-data">
                {copy.requestLinkLabel}
              </Link>
            </Button>
          </CardContent>
        </Card>

        <div className="mt-8">
          <Button asChild variant="ghost" size="sm">
            <Link href="/public/spmb">
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
              {copy.backToForm}
            </Link>
          </Button>
        </div>
      </div>
    </PublicPage>
  );
}
