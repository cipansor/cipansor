"use client";

import Link from "next/link";
import { MapPin, Phone, Mail, MessageCircle, ExternalLink } from "lucide-react";
import { siteConfig, addressLines, educationUnits } from "@/config/site";
import { homeContentFor } from "@/config/home.i18n";
import { siteTextFor } from "@/config/site.i18n";
import { formatNumber } from "@/lib/locale-format";
import { useI18n } from "@/providers/i18n-provider";
import { ChatWidget } from "@/components/chatbot/chat-widget";
import { organizationJsonLd } from "@/config/organization-jsonld";

/**
 * A client component, unlike the landing sections above it. The footer renders
 * inside the SPMB form, which is client-side, so it cannot read the locale
 * cookie through `getServerLocale()` — it takes the locale from the provider
 * instead. Both paths resolve the same strings from the same modules.
 */
export function LandingFooter() {
  const { locale } = useI18n();
  const copy = homeContentFor(locale).footer;
  const site = siteTextFor(locale);

  const quickLinks = [
    { label: copy.links.profile, href: "/profil" },
    { label: copy.links.leadership, href: "/profil/pimpinan" },
    { label: copy.links.legal, href: "/profil/legalitas" },
    { label: copy.links.programs, href: "/program-unggulan" },
    { label: copy.links.units, href: "/unit" },
    { label: copy.links.facilities, href: "/campus" },
    { label: copy.links.activities, href: "/activities" },
    { label: copy.links.news, href: "/berita" },
    // Not in the header nav: the 1024-1279 band has ~36px of slack (see
    // navbar.tsx) and a seventh link overflows it. The footer carries it
    // instead, alongside the link from the homepage gallery block.
    { label: copy.links.gallery, href: "/galeri" },
    { label: copy.links.spmb, href: "/public/spmb" },
    { label: copy.links.donate, href: "/wakaf-infaq" },
    { label: copy.links.contact, href: "/kontak" },
    { label: copy.links.privacy, href: "/kebijakan-privasi" },
  ];

  return (
    <>
      {/* The public assistant is mounted here because `LandingFooter` is
          rendered by every public surface — homepage, /public/spmb and its
          tracker, /wakaf-infaq, and everything wrapped in `PublicPage` — and by
          nothing inside the authenticated app shell. Mounting it here makes the
          public/private boundary structural: the widget cannot follow a visitor
          into a page behind `MainLayout` without someone deliberately importing
          it there. It renders nothing at all unless the API reports the
          assistant as configured. */}
      <ChatWidget />
      {/* Organization structured data, emitted here for the same reason the
          widget is: this footer is rendered by every public surface and by
          nothing inside the app shell. See config/organization-jsonld.ts. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <footer className="bg-muted/30 border-t border-border mt-auto">
        <div className="container mx-auto px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {/* Brand */}
            <div className="space-y-4">
              <h3 className="text-lg font-bold">{siteConfig.name}</h3>
              {/*
              Built as one string rather than interleaved JSX. When text follows
              an expression and then wraps to the next line, JSX trims the
              leading space of that text node — which rendered
              "…Pesantren Cipansoradalah lembaga…" on the live site.
            */}
              <p className="text-sm text-muted-foreground leading-relaxed">
                {copy.blurb(
                  siteConfig.markaz,
                  siteConfig.legalName,
                  formatNumber(locale, siteConfig.establishedYear),
                  site.visi,
                )}
              </p>
              {/*
                Who runs this website, said out loud, on every public page.

                Google for Nonprofits declined the domain a second time because
                they "couldn't confirm its relationship with your registered
                nonprofit organization". Everything needed to confirm it was on
                the site, but the plain sentence asserting it was not: the
                footer named the pesantren without ever saying that this domain
                is the pesantren's own. The structured data in
                config/organization-jsonld.ts makes the same statement for a
                machine; this is the half a person reads.
              */}
              <p className="text-sm leading-relaxed text-muted-foreground">
                {copy.operatedBy(siteConfig.legalName)}
              </p>
            </div>

            {/* Quick Links */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider">
                {copy.linksHeading}
              </h3>
              <ul className="space-y-2">
                {quickLinks.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground hover:text-primary"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Education units */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider">
                {copy.unitsHeading}
              </h3>
              {/* Each unit now has its own page, so these are links rather than
                dead text sitting beside a column of working ones. */}
              <ul className="space-y-2">
                {educationUnits.map((unit) => (
                  <li key={unit.slug}>
                    <Link
                      href={`/unit/${unit.slug}`}
                      className="text-sm text-muted-foreground hover:text-primary"
                    >
                      {unit.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Contact */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider">
                {copy.contactHeading}
              </h3>
              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 text-muted-foreground shrink-0" />
                  {/* The address opens the pesantren's Google Maps listing —
                    visitors planning a kunjungan should not have to retype it. */}
                  <a
                    href={siteConfig.contact.maps.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group text-sm text-muted-foreground hover:text-primary"
                  >
                    <address className="not-italic">
                      {addressLines.map((line) => (
                        <span key={line} className="block">
                          {line}
                        </span>
                      ))}
                      <span className="mt-1 inline-flex items-center gap-1 font-medium text-primary underline-offset-4 group-hover:underline">
                        {copy.viewOnMaps}
                        <ExternalLink
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                      </span>
                    </address>
                  </a>
                </li>
                <li className="flex items-center gap-3">
                  <Phone className="h-5 w-5 text-muted-foreground shrink-0" />
                  <a
                    href={`tel:+${siteConfig.contact.phoneE164}`}
                    className="text-sm text-muted-foreground hover:text-primary"
                  >
                    {siteConfig.contact.phone}
                  </a>
                </li>
                <li className="flex items-center gap-3">
                  <MessageCircle className="h-5 w-5 text-muted-foreground shrink-0" />
                  <a
                    href={siteConfig.contact.whatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-muted-foreground hover:text-primary"
                  >
                    WhatsApp
                  </a>
                </li>
                <li className="flex items-center gap-3">
                  <Mail className="h-5 w-5 text-muted-foreground shrink-0" />
                  <a
                    href={`mailto:${siteConfig.contact.email}`}
                    className="text-sm text-muted-foreground hover:text-primary"
                  >
                    {siteConfig.contact.email}
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-12 border-t border-border pt-8 text-center">
            {/* The rights notice was hardcoded English in every locale. */}
            <p className="text-sm text-muted-foreground">
              &copy; {formatNumber(locale, new Date().getFullYear())}{" "}
              {siteConfig.legalName}. {copy.rights}
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
