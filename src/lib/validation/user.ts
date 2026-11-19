import { z } from "zod";
import { USER_ROLES } from "@/lib/auth/roles";
import { requiredText } from "./common";

export const emailSchema = z
  .string({ error: "E-mail é obrigatório" })
  .trim()
  .toLowerCase()
  .min(1, "E-mail é obrigatório")
  .max(254, "E-mail deve ter no máximo 254 caracteres")
  .pipe(z.email("E-mail inválido"));

export const passwordSchema = z
  .string({ error: "Senha é obrigatória" })
  .min(8, "Senha deve ter ao menos 8 caracteres")
  .max(128, "Senha deve ter no máximo 128 caracteres");

export const userRoleSchema = z.enum(USER_ROLES, { error: "Perfil de acesso inválido" });

export const createUserSchema = z.object({
  name: requiredText("Nome", 2, 120),
  email: emailSchema,
  password: passwordSchema,
  role: userRoleSchema.default("CLIENTE"),
});

/** No login só exigimos que a senha exista — regras de força valem apenas no cadastro. */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ error: "Senha é obrigatória" }).min(1, "Senha é obrigatória").max(128),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
