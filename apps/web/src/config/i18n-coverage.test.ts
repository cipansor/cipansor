import { describe, it, expect } from "vitest";
import { LOCALES, translations, type Locale } from "@/locales";
import { articles } from "./content";
import { homeContentFor } from "./home.i18n";
import { siteTextFor } from "./site.i18n";
import { newsTextFor } from "./news.i18n";
import { pagesContentFor } from "./pages.i18n";
import { donationContentFor } from "./donation.i18n";
import { publicContentFor } from "./content.i18n";
import { accreditationContentFor } from "./accreditation.i18n";
import { spmbContentFor } from "./spmb.i18n";
import { spmbFormContentFor } from "./spmb-form.i18n";
import { announcementContentFor } from "./announcement.i18n";
import { dataRequestContentFor } from "./data-request.i18n";
import { formatNumber } from "@/lib/locale-format";

/**
 * The switcher is visible to every visitor, so a page that offers English and
 * then serves Indonesian is worse than offering no switcher at all. These tests
 * are the thing that notices: they compare each locale against Indonesian and
 * fail when a string was added on one side only, or copied across untranslated.
 *
 * They cannot judge whether a translation is *good* — only that one exists and
 * that the shapes still line up. That is the failure mode that actually
 * happened, twice: content added to the Indonesian source and forgotten in the
 * other two.
 */

const OTHER_LOCALES = LOCALES.filter((l) => l !== "id");

/**
 * Strings that are deliberately identical to the Indonesian, with the reason.
 * Anything not listed here that matches Indonesian is an untranslated string.
 */
const KEPT_VERBATIM: Record<string, string> = {
  // Domain vocabulary the portal uses throughout — translating it on the
  // public site alone would make the two disagree. See content.i18n.ts.
  "en:footer.links.donate":
    "Wakaf and Infaq are the terms the donation flow uses",
  "en:cta.donate.title": "Infaq & Shodaqoh is the campaign's own name",
  "en:programs.public-speaking.title": "Already English in the source",
  "en:programs.entrepreneurship.title": "Already English in the source",
  "en:profileStats[1].label":
    "Santri is kept and glossed, not translated to 'students'",
  "en:activities.rihlah-tarbawi.name":
    "A pesantren term kept, as the brochure prints it; its description glosses it",
  "en:activities.study-tour.name": "Already English in the source",
  "en:contact.emailHeading": "'Email' is the same word in Indonesian",
  "en:contact.whatsappHeading": "A product name",
  // The donation page. Akad names are the terms the donation record stores and
  // the finance module displays, so they are kept and glossed, not translated.
  "en:donationTypes.ZAKAT_MAAL": "Akad name",
  "en:donationTypes.ZAKAT_FITRAH": "Akad name",
  "en:donationTypes.WAKAF": "Akad name",
  "en:donationTypes.SEDEKAH_JARIYAH": "Akad name",
  "en:success.heading":
    "Jazakallahu Khairan is a supplication, not a phrase to render",
  "en:campaigns.targetLabel": "'Target' is the same word in Indonesian",
  "en:form.emailLabel": "'Email' is the same word in Indonesian",
  "en:paymentMethods.QRIS": "Indonesia's national QR payment standard",
  "ar:paymentMethods.QRIS": "Indonesia's national QR payment standard",
  // A format hint showing the shape of an Indonesian mobile number.
  "en:form.phonePlaceholder": "A number format, not prose",
  "ar:form.phonePlaceholder": "A number format, not prose",
  // The public assistant (public.chatbot). "Email" and "WhatsApp" are the same
  // word in all three locales.
  "en:escalation.email": "'Email' is the same word in Indonesian",
  "ar:escalation.email": "'Email' is transliterated identically in Arabic",
  "en:escalation.whatsapp": "A product name",
  "ar:escalation.whatsapp": "A product name",
  // NIK is the Indonesian national identity number; the form keeps the
  // regulatory term in every language rather than inventing a translation.
  "en:documents.ocrField.nationalId":
    "NIK is a regulatory identifier, kept verbatim",
};

/**
 * Not prose, so being identical across locales is correct: `type` is the
 * ContentBlock discriminator ("p" / "h2" / "ul"), and `value` is a figure.
 * Arabic digit shaping is asserted separately at the bottom of this file.
 */
const STRUCTURAL = /\.(type|value)$/;

/** Placeholder arguments for the interpolating strings, e.g. `about.body`. */
const ARGS = ["«a»", "«b»", "«c»", "«d»"];

/** Flatten to dot-path → rendered string, calling functions with placeholders. */
function flatten(
  value: unknown,
  prefix = "",
  out: Record<string, string> = {},
) {
  if (typeof value === "string") {
    out[prefix] = value;
  } else if (value === null) {
    // A deliberate "nothing to show here" — recorded rather than skipped, so a
    // key that is null in one locale and a string in another still lines up.
    out[prefix] = "∅";
  } else if (typeof value === "function") {
    out[prefix] = String((value as (...a: string[]) => string)(...ARGS));
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

const SURFACES: Array<{ name: string; of: (l: Locale) => unknown }> = [
  { name: "home", of: homeContentFor },
  { name: "site", of: siteTextFor },
  { name: "pages", of: pagesContentFor },
  { name: "donation", of: donationContentFor },
  { name: "profile/legal", of: publicContentFor },
  { name: "accreditation", of: accreditationContentFor },
  { name: "spmb", of: spmbContentFor },
  { name: "spmb form", of: spmbFormContentFor },
  { name: "announcement", of: announcementContentFor },
  // Permintaan hak subjek data (UU PDP). It is a public page like the others,
  // so the rule is id/en/ar on it too — and the two it broke without this
  // entry are the ones a family reads while exercising a legal right.
  { name: "data request", of: dataRequestContentFor },
  // The public assistant's own strings. They are not a `config/*.i18n.ts`
  // surface — the widget reads them straight off the locale tree — so this is
  // what notices when the greeting or a suggestion is added in one language
  // only. It is on the public site, where the rule is id/en/ar on every page.
  { name: "public chatbot", of: (l) => translations[l].public.chatbot },
];

describe.each(SURFACES)("$name content", ({ of }) => {
  const indonesian = flatten(of("id"));

  it.each(OTHER_LOCALES)(
    "%s has every key Indonesian has, and no extras",
    (locale) => {
      expect(Object.keys(flatten(of(locale))).sort()).toEqual(
        Object.keys(indonesian).sort(),
      );
    },
  );

  it.each(OTHER_LOCALES)(
    "%s leaves nothing in Indonesian by accident",
    (locale) => {
      const translated = flatten(of(locale));
      const untranslated = Object.keys(indonesian).filter(
        (path) =>
          translated[path] === indonesian[path] &&
          !STRUCTURAL.test(path) &&
          !KEPT_VERBATIM[`${locale}:${path}`],
      );
      expect(untranslated).toEqual([]);
    },
  );
});

describe("news headlines", () => {
  it.each(OTHER_LOCALES)("%s covers every published article", (locale) => {
    for (const article of articles) {
      const text = newsTextFor(locale, article.slug);
      expect(text, `no ${locale} headline for ${article.slug}`).toBeDefined();
      expect(text?.title).not.toBe(article.title);
      expect(text?.excerpt).not.toBe(article.excerpt);
    }
  });

  it("falls back to Indonesian rather than dropping an untranslated article", () => {
    // A newly published article must still appear on the English homepage.
    expect(newsTextFor("en", articles[0].slug)).toBeDefined();
    expect(newsTextFor("en", "an-article-added-tomorrow")).toBeUndefined();
  });
});

describe("figures inside prose", () => {
  it("renders years in the reader's own digits", () => {
    expect(formatNumber("id", 1911)).toBe("1911");
    expect(formatNumber("en", 1911)).toBe("1911");
    // Arabic prose on the site is written with Arabic-Indic digits; a Latin
    // "1911" beside "١٩١١" in the next card is the tell that one was missed.
    expect(formatNumber("ar", 1911)).toBe("١٩١١");
  });

  it("does not group a year into a quantity", () => {
    expect(formatNumber("en", 1911)).not.toContain(",");
    expect(formatNumber("ar", 1911)).not.toContain("٬");
  });
});
