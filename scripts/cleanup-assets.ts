import postgres from "postgres";
import { storage } from "../apps/web/src/server/assets";
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
  try {
    const candidates =
      await sql`select id from resume.assets a where a.created_at<now()-interval '1 day' and not exists(select 1 from resume.version_assets v where v.asset_id=a.id) and not exists(select 1 from resume.publication_assets p where p.asset_id=a.id)`;
    for (const c of candidates)
      await sql.begin(async (tx) => {
        const rows =
          await tx`select id,path from resume.assets where id=${c.id} for update`;
        if (!rows.length) return;
        const refs =
          await tx`select asset_id from resume.version_assets where asset_id=${c.id} union all select asset_id from resume.publication_assets where asset_id=${c.id}`;
        if (refs.length) return;
        const result = await storage().remove([rows[0].path]);
        if (result.error) return;
        await tx`delete from resume.assets where id=${c.id}`;
      });
    console.log(
      "Unreferenced assets checked. Failed deletions remain retryable.",
    );
  } finally {
    await sql.end();
  }
}
main().catch(() => {
  console.error("Asset cleanup failed; check server configuration.");
  process.exitCode = 1;
});
