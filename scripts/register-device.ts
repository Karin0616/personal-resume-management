import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { checkRegistration, hash } from "../apps/web/src/server/auth";
async function main() {
  const path = process.argv[2],
    recover = process.argv.includes("--recover");
  if (!path || !process.env.DATABASE_URL || !process.env.APP_ORIGIN)
    throw new Error(
      "Usage: pnpm device:register <local-registration.json> [--recover]. DATABASE_URL and APP_ORIGIN required.",
    );
  const proof = checkRegistration(
    JSON.parse(await readFile(path, "utf8")),
    process.env.APP_ORIGIN,
  );
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
  try {
    await sql.begin(async (tx) => {
      await tx`lock table resume.auth_devices in exclusive mode`;
      const active =
        await tx`select id from resume.auth_devices where revoked_at is null`;
      if (active.length && !recover)
        throw new Error(
          "기존 기기가 있습니다. 웹의 새 기기 등록 또는 명시적인 --recover를 사용하세요.",
        );
      if (recover) {
        await tx`update resume.auth_devices set revoked_at=now() where revoked_at is null`;
        await tx`update resume.edit_sessions set revoked_at=now()`;
        await tx`update resume.auth_challenges set consumed_at=now() where consumed_at is null`;
      }
      await tx`insert into resume.auth_devices(name,public_key,fingerprint) values(${proof.name},${proof.public_key},${hash(proof.public_key)}) on conflict(public_key) do update set revoked_at=null,name=excluded.name`;
    });
    console.log(
      `Registered device: ${proof.name}. Private key never leaves the Authenticator.`,
    );
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Device registration failed");
  process.exitCode = 1;
});
