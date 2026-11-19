import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-8">
      <h1 className="text-3xl font-bold">Acesso negado</h1>
      <p className="mt-4 text-slate-600">Você não tem permissão para acessar esta página.</p>
      <Link href="/" className="mt-6 inline-block text-emerald-700 hover:underline">
        Voltar para a página inicial
      </Link>
    </main>
  );
}
