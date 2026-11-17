import type { Metadata } from "next";
import { siteConfig } from "@/config/site";
import { getServerLocale } from "@/lib/server-locale";
import { DataRequestForm } from "./data-request-form";

/**
 * Permintaan hak subjek data — permukaan publik (UU 27/2022 Pasal 30, 32, 33,
 * 35, 40, 43).
 *
 * Halaman ini publik karena pemohonnya adalah pendaftar SPMB yang belum punya
 * akun: justru merekalah yang paling perlu memakai haknya, dan teks Kebijakan
 * Privasi hanya menunjuk kontak panitia secara manual sebelum ini.
 *
 * Formulirnya komponen klien (ia memasang Turnstile dan memanggil API), jadi
 * pembungkus peladen ini yang membawa metadata — tanpa itu halaman mewarisi
 * judul root layout dan alamat yang dibuka dari email kebijakan tidak terbaca
 * sebagai halaman hak subjek data.
 */
export const metadata: Metadata = {
  title: `Permintaan Data Pribadi — ${siteConfig.legalName}`,
  description:
    "Ajukan permintaan akses, perbaikan, penghapusan, atau penarikan persetujuan atas data pribadi Anda atau anak Anda (UU Pelindungan Data Pribadi No. 27 Tahun 2022).",
  metadataBase: new URL(siteConfig.url),
  alternates: { canonical: "/public/permintaan-data" },
  robots: { index: false, follow: true },
};

export default async function PublicDataRequestPage() {
  // The locale resolves the form's words and its direction server-side, the
  // same way the SPMB form does — the public site is id/en/ar on every page.
  const locale = await getServerLocale();
  return <DataRequestForm locale={locale} />;
}
