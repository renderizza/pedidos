/**
 * Substitutos mínimos de `next/headers` e `next/navigation` para testar guards e
 * Server Actions fora do runtime do Next. Só as bordas são simuladas: banco, sessões,
 * Zod e regras de RBAC rodam de verdade.
 */
export const cookieJar = new Map<string, string>();
export const cookieOptions = new Map<string, Record<string, unknown>>();

export class RedirectError extends Error {
  constructor(public readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super("NEXT_FORBIDDEN");
  }
}

/** Caminhos passados a revalidatePath() desde o último reset. */
export const revalidatedPaths: string[] = [];

export function resetNextMocks() {
  cookieJar.clear();
  cookieOptions.clear();
  revalidatedPaths.length = 0;
}

export const nextHeadersMock = {
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    has: (name: string) => cookieJar.has(name),
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      cookieJar.set(name, value);
      cookieOptions.set(name, options);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
      cookieOptions.delete(name);
    },
  }),
};

export class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}

export const nextCacheMock = {
  revalidatePath: (path: string) => {
    revalidatedPaths.push(path);
  },
};

export const nextNavigationMock = {
  notFound: (): never => {
    throw new NotFoundError();
  },
  redirect: (url: string): never => {
    throw new RedirectError(url);
  },
  forbidden: (): never => {
    throw new ForbiddenError();
  },
};
