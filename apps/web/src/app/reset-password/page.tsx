"use client";

/**
 * Where the reset link in the e-mail lands.
 *
 * THIS PAGE IS THE OTHER HALF OF A FEATURE THAT SHIPPED WITHOUT IT. The
 * onboarding orchestrator has minted reset tokens for every new santri and wali
 * account for months — `resetTokenHash` and `resetTokenExpiresAt` on `users` —
 * and `auth.service.ts` only ever stripped those columns out of responses.
 * There was no page and no endpoint, so `/reset-password?token=…` fell through
 * the middleware's auth check to `/login?redirect=/reset-password`, dropping the
 * token on the way. Every "set your password" e-mail was a dead end.
 *
 * It must stay in `publicRoutes` in middleware.ts: someone who cannot sign in
 * is precisely who arrives here.
 */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import {
  TurnstileWidget,
  useTurnstile,
} from "@/components/security/turnstile-widget";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, Eye, EyeOff, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { authApi } from "@/lib/api";
import { PASSWORD_HINT, PASSWORD_MIN_LENGTH_WITH_2FA } from "@cipansor/shared";

/**
 * The floor only. Whether 8 characters are enough depends on the account's
 * 2FA, which this signed-out page does not know; the API decides, along with
 * the blocklist, and its reason is shown as the failure. No composition rules
 * (decided 2026-09-28, NIST SP 800-63B-4).
 */
const formSchema = z
  .object({
    newPassword: z
      .string()
      .min(
        PASSWORD_MIN_LENGTH_WITH_2FA,
        `Password minimal ${PASSWORD_MIN_LENGTH_WITH_2FA} karakter`,
      ),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Konfirmasi password tidak sama",
    path: ["confirmPassword"],
  });

type FormValues = z.infer<typeof formSchema>;

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [showPassword, setShowPassword] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const turnstile = useTurnstile();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  const onSubmit = async (values: FormValues) => {
    setFailure(null);
    try {
      await authApi.resetPassword({
        token,
        newPassword: values.newPassword,
        turnstileToken: turnstile.token ?? undefined,
      });
      toast.success("Password berhasil diperbarui. Silakan masuk.");
      router.push("/login");
    } catch {
      // One message for every rejection — expired, already used, never valid.
      // Telling them apart only helps someone guessing.
      setFailure(
        "Tautan ini tidak valid atau sudah kedaluwarsa. Silakan hubungi admin untuk dikirimkan tautan baru.",
      );
      // Token sekali pakai: percobaan berikutnya butuh tantangan baru.
      turnstile.refresh();
    }
  };

  if (!token) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            Tautan reset tidak lengkap. Buka kembali tautan lengkap dari email
            Anda. Jika tautannya sudah kedaluwarsa, hubungi admin untuk
            dikirimkan tautan baru — halaman ini tidak bisa mengirim sendiri.
          </p>
        </div>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Kembali ke halaman masuk</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {failure && (
        <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{failure}</p>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="newPassword">Password baru</Label>
        <div className="relative">
          <Input
            id="newPassword"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            {...register("newPassword")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-label={
              showPassword ? "Sembunyikan password" : "Tampilkan password"
            }
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="text-sm text-muted-foreground">{PASSWORD_HINT}</p>
        {errors.newPassword && (
          <p className="text-sm text-destructive">
            {errors.newPassword.message}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Ulangi password baru</Label>
        <Input
          id="confirmPassword"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          {...register("confirmPassword")}
        />
        {errors.confirmPassword && (
          <p className="text-sm text-destructive">
            {errors.confirmPassword.message}
          </p>
        )}
      </div>

      <TurnstileWidget action="reset-password" {...turnstile.widgetProps} />

      <Button
        type="submit"
        className="w-full"
        disabled={isSubmitting || !turnstile.ready}
      >
        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Simpan password baru
      </Button>

      <Button asChild variant="ghost" className="w-full">
        <Link href="/login">Kembali ke halaman masuk</Link>
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main
      id="main-content"
      className="flex min-h-screen items-center justify-center bg-muted/40 p-4"
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Setel Ulang Password</CardTitle>
          <CardDescription>
            Pilih password baru untuk akun Anda di portal Yayasan Pesantren
            Cipansor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/*
            useSearchParams() forces this subtree to be client-rendered; without
            a Suspense boundary the whole route opts out of prerendering and the
            build warns about it.
          */}
          <Suspense
            fallback={
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <ResetPasswordForm />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
