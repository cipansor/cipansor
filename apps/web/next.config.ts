import type { NextConfig } from "next";
import { STATIC_SECURITY_HEADERS } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // Enable React Compiler (experimental - only in development for safety)
  reactCompiler: process.env.NODE_ENV === "development",

  // Standalone output is for the Docker image (the Dockerfile sets
  // BUILD_STANDALONE=1 and runs `node server.js`). For everything else — local
  // dev, `next start`, and the e2e/CI server — leave it unset so `next start`
  // is fully supported (it is not, with output: "standalone").
  output: process.env.BUILD_STANDALONE ? "standalone" : undefined,

  // Production optimizations
  poweredByHeader: false,

  // Enable strict mode for better error catching
  reactStrictMode: true,

  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
    formats: ["image/avif", "image/webp"],
  },

  /**
   * Permanent redirects for renamed public paths.
   *
   * The site is live, indexed, and a Google Ad Grants account depends on
   * landing pages that do not 404 — so a renamed public URL always keeps a 308
   * shipped in the same deploy. Kemendikdasmen replaced PPDB with SPMB from the
   * 2025/2026 intake, but printed materials and search results still carry the
   * old path.
   */
  async redirects() {
    return [
      // The wali's own preferences page asked an API that never existed
      // (`/notifications/preferences/{id}`) and showed nothing; parents now use
      // the one settings page every role has.
      {
        source: "/parent/notifications/preferences",
        destination: "/notifications/settings",
        permanent: true,
      },
      // Broadcasting is one feature, Pengumuman (decisions/siaran-pengumuman.md):
      // the two composers stored rows nobody received, and the wali's own
      // announcements page read a narrower list than the shared board.
      {
        source: "/notifications/quick-send",
        destination: "/announcements",
        permanent: true,
      },
      {
        source: "/notifications/new",
        destination: "/announcements",
        permanent: true,
      },
      {
        source: "/parent/announcements",
        destination: "/announcements",
        permanent: true,
      },
      // No list of everyone's notifications, and no templates (same decision,
      // 5 and 6): "Notifikasi" is the caller's own bell. A notification's old
      // detail address (an id) leads there too; `me`, `settings` and
      // `whatsapp` are pages and are left alone.
      {
        source: "/notifications",
        destination: "/notifications/me",
        permanent: true,
      },
      {
        source: "/notifications/templates/:path*",
        destination: "/announcements",
        permanent: true,
      },
      {
        source:
          "/notifications/:id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
        destination: "/notifications/me",
        permanent: true,
      },
      // A second, unlinked GRC page that asked `/api/api/...` and showed
      // nothing; the yayasan's GRC board is /grc-dashboard.
      {
        source: "/analytics/grc",
        destination: "/grc-dashboard",
        permanent: true,
      },
      {
        source: "/ppdb",
        destination: "/spmb",
        permanent: true,
      },
      {
        source: "/ppdb/:path*",
        destination: "/spmb/:path*",
        permanent: true,
      },
      {
        source: "/psb",
        destination: "/spmb",
        permanent: true,
      },
      {
        source: "/psb/:path*",
        destination: "/spmb/:path*",
        permanent: true,
      },
      {
        source: "/public/ppdb",
        destination: "/public/spmb",
        permanent: true,
      },
      {
        source: "/public/ppdb/:path*",
        destination: "/public/spmb/:path*",
        permanent: true,
      },
      // The waves page under /admissions listed waves with buttons that did
      // nothing. An intake's waves are now entered on its period's page.
      {
        source: "/admissions/waves",
        destination: "/spmb/periods",
        permanent: true,
      },
      // "Wakaf & Infaq" is the term the pesantren uses, and the donation page
      // now lives under that name instead of being a second, differently-named
      // copy of the same thing.
      {
        source: "/public/donation",
        destination: "/wakaf-infaq",
        permanent: true,
      },
      // Letters already in circulation carry a QR printed when verification
      // still lived at /verifikasi/<token>. That page was removed deliberately
      // — a token attests that some letter was signed, never that the document
      // in your hand is that letter, so a forger could keep the genuine QR and
      // edit the body. The redirect does not verify anything; it just stops a
      // printed letter from dead-ending, and sends the reader to the upload
      // form that does bind to the document.
      {
        source: "/verifikasi/:token",
        destination: "/public/verify-letter",
        permanent: true,
      },
      {
        source: "/verifikasi",
        destination: "/public/verify-letter",
        permanent: true,
      },
      // The Mutabaah form follows the "…/new" convention for create pages;
      // its buttons had always pointed there, and /daily-report/new landed
      // on the detail page with "new" taken for an id.
      {
        source: "/daily-report/create",
        destination: "/daily-report/new",
        permanent: true,
      },
      // Manajemen Kinerja diremajakan sebagai /kinerja. Buku penanda dan hasil
      // pencarian lama masih membawa /pkg, dan halaman lamanya sudah dihapus —
      // tanpa pengalihan ini bookmark lama berakhir di 404.
      {
        source: "/pkg",
        destination: "/kinerja",
        permanent: true,
      },
      {
        source: "/pkg/:path*",
        destination: "/kinerja/:path*",
        permanent: true,
      },
      // The gate check belongs to Perizinan: it looks up a permit and records
      // leaving and coming back. Under /reception it had no menu entry at all.
      {
        source: "/reception/gate",
        destination: "/permits/gate",
        permanent: true,
      },
      // One register, one page (decided 2026-09-27): Wali Kelas → Absensi
      // Harian had its own copy of the daily register. The page it opens now
      // starts on the wali kelas's own class.
      {
        source: "/homeroom/attendance",
        destination: "/attendance/record",
        permanent: true,
      },
      // The Kurikulum list had no table and no API behind it; the curriculum
      // in force is Kurikulum Merdeka (removal approved 2026-09-27).
      {
        source: "/curriculum/curriculums",
        destination: "/curriculum/merdeka",
        permanent: true,
      },
      {
        source: "/curriculum/curriculums/:path*",
        destination: "/curriculum/merdeka",
        permanent: true,
      },
      // One daily-report page (decided 2026-09-27): the TK tree and the wali
      // kelas copy answer with the page that serves every unit and role.
      // Specific paths first; `:id` last.
      ...(
        [
          ["/tk/daily-reports", "/daily-report"],
          ["/tk/daily-reports/new", "/daily-report/new"],
          ["/tk/daily-reports/create", "/daily-report/bulk"],
          ["/tk/daily-reports/class", "/daily-report"],
          ["/tk/daily-reports/check-in", "/daily-report/check-in"],
          ["/tk/daily-reports/parent", "/parent/daily-report"],
          ["/tk/daily-reports/:id/edit", "/daily-report/:id/edit"],
          ["/tk/daily-reports/:id", "/daily-report/:id"],
          ["/homeroom/daily-report", "/daily-report/bulk"],
        ] as const
      ).map(([source, destination]) => ({
        source,
        destination,
        permanent: true,
      })),
    ];
  },

  // Security headers
  async headers() {
    return [
      {
        // The service worker script must not be HTTP-cached. The browser's own
        // update check compares the fetched bytes against the installed worker
        // (Chrome ignores cache headers for this), but a shared/intermediary
        // cache in front of the app can still serve a stale `sw.js`, which
        // pins every client to the old worker until that cache expires. A short
        // max-age plus revalidation keeps a deploy discoverable.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/:path*",
        headers: STATIC_SECURITY_HEADERS,
      },
    ];
  },

  // Compression
  compress: true,

  // Logging
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
};

export default nextConfig;
