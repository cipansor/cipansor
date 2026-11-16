import type { MetadataRoute } from "next";
import { educationUnits } from "@/config/site";
import { articles } from "@/config/content";

/**
 * Sitemap for the publicly reachable pages only.
 *
 * Everything else in this app sits behind `middleware.ts` and redirects
 * anonymous visitors to /login, so listing those would just feed Google a pile
 * of redirects. Google Ad Grants requires the landing pages behind ads to be
 * crawlable and working — those are exactly the URLs below.
 *
 * Keep this in step with `publicPrefixes` in `middleware.ts`: a URL listed here
 * but not exempted there would be crawled straight into the login screen.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cipansor.or.id";

/**
 * `satisfies` rather than a plain array: it keeps `changeFrequency` narrowed to
 * the literal union `MetadataRoute.Sitemap` requires instead of widening to
 * `string`.
 */
const STATIC_PAGES = [
  { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
  { url: `${SITE_URL}/profil`, changeFrequency: "monthly", priority: 0.8 },
  {
    url: `${SITE_URL}/profil/pimpinan`,
    changeFrequency: "monthly",
    priority: 0.6,
  },
  {
    url: `${SITE_URL}/profil/legalitas`,
    changeFrequency: "yearly",
    priority: 0.6,
  },
  {
    url: `${SITE_URL}/program-unggulan`,
    changeFrequency: "monthly",
    priority: 0.8,
  },
  { url: `${SITE_URL}/unit`, changeFrequency: "monthly", priority: 0.8 },
  { url: `${SITE_URL}/campus`, changeFrequency: "monthly", priority: 0.8 },
  { url: `${SITE_URL}/activities`, changeFrequency: "monthly", priority: 0.8 },
  { url: `${SITE_URL}/berita`, changeFrequency: "weekly", priority: 0.9 },
  { url: `${SITE_URL}/galeri`, changeFrequency: "monthly", priority: 0.7 },
  { url: `${SITE_URL}/wakaf-infaq`, changeFrequency: "weekly", priority: 0.9 },
  { url: `${SITE_URL}/kontak`, changeFrequency: "yearly", priority: 0.6 },
  {
    url: `${SITE_URL}/kebijakan-privasi`,
    changeFrequency: "yearly",
    priority: 0.5,
  },
  { url: `${SITE_URL}/public/spmb`, changeFrequency: "weekly", priority: 0.9 },
  {
    url: `${SITE_URL}/public/spmb/track`,
    changeFrequency: "monthly",
    priority: 0.5,
  },
  {
    url: `${SITE_URL}/public/verify-sanad`,
    changeFrequency: "monthly",
    priority: 0.5,
  },
] satisfies MetadataRoute.Sitemap;

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  const unitPages = educationUnits.map((unit) => ({
    url: `${SITE_URL}/unit/${unit.slug}`,
    lastModified,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  const articlePages = articles.map((article) => ({
    url: `${SITE_URL}/berita/${article.slug}`,
    // An article's own publication date is a truer lastmod than "now".
    lastModified: new Date(article.date),
    changeFrequency: "yearly" as const,
    priority: 0.7,
  }));

  return [
    ...STATIC_PAGES.map((entry) => ({ ...entry, lastModified })),
    ...unitPages,
    ...articlePages,
  ];
}
