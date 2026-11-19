import { authenticate } from "@/lib/users/service";
import { fieldErrors } from "@/lib/validation/common";
import { loginSchema } from "@/lib/validation/user";
import { homePathFor } from "./rbac";
import { safeRedirectPath } from "./redirect";
import { createSession, type SessionUser } from "./session";

export type LoginState =
  | {
      error?: string;
      fieldErrors?: Record<string, string[]>;
      /** Devolvido para repopular o campo e-mail (nunca a senha). */
      email?: string;
    }
  | undefined;

export type LoginResult =
  | { ok: true; user: SessionUser; token: string; expiresAt: Date; redirectTo: string }
  | { ok: false; state: NonNullable<LoginState> };

export const INVALID_CREDENTIALS_MESSAGE = "E-mail ou senha incorretos";

/**
 * Regra de negócio do login, sem depender de cookies/redirect do Next
 * (a Server Action só traduz o resultado em cookie + redirect).
 */
export async function performLogin(formData: FormData): Promise<LoginResult> {
  const rawEmail = formData.get("email");
  const email = typeof rawEmail === "string" ? rawEmail : "";

  const parsed = loginSchema.safeParse({ email: rawEmail, password: formData.get("password") });
  if (!parsed.success) {
    return { ok: false, state: { fieldErrors: fieldErrors(parsed.error), email } };
  }

  const user = await authenticate(parsed.data);
  if (!user) {
    return { ok: false, state: { error: INVALID_CREDENTIALS_MESSAGE, email } };
  }

  const { token, expiresAt } = await createSession(user.id);
  const redirectTo = safeRedirectPath(formData.get("next"), homePathFor(user.role));
  return { ok: true, user, token, expiresAt, redirectTo };
}
