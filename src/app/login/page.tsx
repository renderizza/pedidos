import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/guards";
import { homePathFor } from "@/lib/auth/rbac";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar — Sistema de Pedidos" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? safeRedirectPath(next, "") : "";

  const user = await getCurrentUser();
  if (user) redirect(nextPath || homePathFor(user.role));

  return (
    <main className="mx-auto max-w-sm p-4 sm:p-8">
      <h1 className="mb-6 text-2xl font-bold">Entrar</h1>
      <LoginForm next={nextPath || undefined} />
    </main>
  );
}
