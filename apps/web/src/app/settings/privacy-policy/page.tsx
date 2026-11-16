"use client";

/**
 * Super-admin settings page for the public, versioned Kebijakan Privasi.
 *
 * `allowedRoles` guards the page the same way the API guards the endpoints: the
 * sidebar shows this link only to SUPER_ADMIN, but the URL is typeable, so the
 * shell enforces it too.
 */

import { MainLayout } from "@/components/layout";
import { PrivacyPolicyEditor } from "@/components/settings/privacy-policy-editor";

export default function PrivacyPolicySettingsPage() {
  return (
    <MainLayout allowedRoles={["SUPER_ADMIN"]}>
      <div className="container mx-auto max-w-3xl space-y-6 py-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Kebijakan Privasi
          </h1>
          <p className="text-muted-foreground">
            Terbitkan teks Kebijakan Privasi yang ditampilkan di situs publik
            dan yang disetujui pendaftar SPMB (UU PDP 27/2022).
          </p>
        </div>
        <PrivacyPolicyEditor />
      </div>
    </MainLayout>
  );
}
