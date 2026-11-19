"use server";

import { redirect } from "next/navigation";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "@/lib/auth/cookies";
import { performLogin, type LoginState } from "@/lib/auth/login";
import { deleteSession } from "@/lib/auth/session";

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const result = await performLogin(formData);
  if (!result.ok) return result.state;

  await setSessionCookie(result.token, result.expiresAt);
  redirect(result.redirectTo); // redirect() lança internamente: fica fora de try/catch
}

export async function logoutAction(): Promise<void> {
  const token = await readSessionToken();
  if (token) await deleteSession(token);
  await clearSessionCookie();
  redirect("/login");
}
