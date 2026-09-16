import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import postgres from "postgres";
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
  try {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(609150001)`;
      await tx`create schema if not exists resume_meta`;
      await tx`revoke all on schema resume_meta from public`;
      await tx`create table if not exists resume_meta.migrations(name text primary key,sha256 text not null,applied_at timestamptz not null default now())`;
      for (const name of (await readdir("supabase/migrations"))
        .filter((n) => n.endsWith(".sql"))
        .sort()) {
        const text = await readFile(`supabase/migrations/${name}`, "utf8"),
          hash = createHash("sha256").update(text).digest("hex");
        const old =
          await tx`select sha256 from resume_meta.migrations where name=${name}`;
        if (old.length) {
          if (old[0].sha256 !== hash)
            throw new Error(`Migration changed: ${name}`);
          continue;
        }
        await tx.unsafe(text);
        await tx`insert into resume_meta.migrations(name,sha256) values(${name},${hash})`;
        console.log(`Applied ${name}`);
      }
      const storage = await tx`select to_regclass('storage.buckets') as name`;
      if (storage[0].name)
        await tx.unsafe(await readFile("supabase/storage.sql", "utf8"));
    });
  } finally {
    await sql.end();
  }
}
main().catch(() => {
  console.error(
    "Migration failed. Check DATABASE_URL, permissions, and migration checksums.",
  );
  process.exitCode = 1;
});
