import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";

/** Verifica se a aplicação está de pé e se consegue falar com o PostgreSQL. */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ status: "ok", database: "up", timestamp: new Date().toISOString() });
  } catch {
    return NextResponse.json(
      { status: "error", database: "down", timestamp: new Date().toISOString() },
      { status: 503 },
    );
  }
}
