import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { generateKeyPairSync, sign, randomBytes } from "node:crypto";
import { ResumeService } from "../apps/web/src/server/resume-service";
import {
  AuthService,
  hash,
  registrationMessage,
  type Registration,
} from "../apps/web/src/server/auth";
import { SaveQueue } from "../apps/web/src/features/editor/save-queue";
import { parseResume } from "../packages/resume-schema/src";
import type { DB } from "../apps/web/src/server/db";
let pg: PGlite, db: DB, service: ResumeService;
function wrap(p: any): DB {
  return {
    query: async (s, a = []) => {
      const r = await p.query(s, a);
      return r.rows;
    },
    transaction: (fn) => p.transaction((t: any) => fn(wrap(t))),
  };
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(
    await readFile("supabase/migrations/202609150001_initial.sql", "utf8"),
  );
  db = wrap(pg);
  service = new ResumeService(db);
});
afterAll(() => pg.close());
describe("edge cases", () => {
  it("retains only 100 history rows and treats lost-response retries as no-ops", async () => {
    const purpose = await service.purpose("History 테스트"),
      { resume, version } = await service.createResume({
        purpose_id: purpose.id,
        title: "History 더미",
      }),
      v = await service.version(version.id);
    for (let n = 0; n < 103; n++) {
      v.document.sections[0].items[0].fields.name = `변경 ${n}`;
      await service.save(v.id, n, v.document);
    }
    expect(await service.history(v.id)).toHaveLength(100);
    expect((await service.versions(resume.id)).length).toBe(1);
    const retry = await service.save(v.id, 102, v.document);
    expect(retry.revision).toBe(103);
    expect((await service.history(v.id)).length).toBe(100);
    const preview = await service.importPreview(v.id, {
      schema_version: "1.0",
      target: { section: "profile" },
      changes: { role: "새 역할" },
    });
    v.document.sections[0].items[0].fields.name = "다른 기기";
    await service.save(v.id, 103, v.document);
    await expect(
      service.importApply(v.id, preview.revision, {
        schema_version: "1.0",
        target: { section: "profile" },
        changes: { role: "새 역할" },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("keeps photo references across clones and public snapshots", async () => {
    const asset = crypto.randomUUID();
    await db.query(
      "insert into resume.assets(id,path,mime,size) values($1,$2,$3,$4)",
      [asset, `fixture/${asset}`, "image/png", 10],
    );
    const p = await service.purpose("사진 테스트"),
      original = await service.createResume({
        purpose_id: p.id,
        title: "사진 원본",
      }),
      v = await service.version(original.version.id);
    v.document.sections[0].items[0].fields.photo_asset_id = asset;
    await service.save(v.id, 0, v.document);
    await service.publish(v.id, 1);
    const clone = await service.createResume({
      purpose_id: p.id,
      title: "사진 복제",
      source_id: v.id,
    });
    v.document.sections[0].items[0].fields.photo_asset_id = null;
    await service.save(v.id, 1, v.document);
    expect(
      await db.query(
        "select * from resume.publication_assets where asset_id=$1",
        [asset],
      ),
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          "select * from resume.version_assets where asset_id=$1",
          [asset],
        )
      )[0].version_id,
    ).toBe(clone.version.id);
    await expect(
      db.query("delete from resume.assets where id=$1", [asset]),
    ).rejects.toMatchObject({ code: "23503" });
  });
  it("allocates unique version numbers for simultaneous requests and preserves an empty resume", async () => {
    const p = await service.purpose("동시 생성"),
      { resume, version } = await service.createResume({
        purpose_id: p.id,
        title: "동시 테스트",
      });
    const versions = await Promise.all([
      service.createVersion(resume.id, "minor", version.id),
      service.createVersion(resume.id, "minor", version.id),
    ]);
    expect(versions.map((v) => v.minor).sort()).toEqual([1, 2]);
    for (const v of await service.versions(resume.id)) {
      const summary = await service.deleteSummary("versions", v.id);
      await service.remove("versions", v.id, "", summary.fingerprint);
    }
    expect((await service.home()).resumes.some((r) => r.id === resume.id)).toBe(
      true,
    );
    expect(await service.versions(resume.id)).toHaveLength(0);
    expect((await service.createVersion(resume.id, "minor")).minor).toBe(3);
  });
  it("requires two key proofs for registration and consumes authorization once", async () => {
    const existing = generateKeyPairSync("ed25519"),
      added = generateKeyPairSync("ed25519");
    const publicKey = (pair: typeof existing) =>
      pair.publicKey
        .export({ format: "der", type: "spki" })
        .subarray(-32)
        .toString("base64");
    const oldKey = publicKey(existing);
    await db.query(
      "insert into resume.auth_devices(name,public_key,fingerprint) values($1,$2,$3)",
      ["기존", oldKey, hash(oldKey)],
    );
    const auth = new AuthService(db, "https://resume.example");
    const proof: Registration = {
      name: "새 기기",
      public_key: publicKey(added),
      origin: "https://resume.example",
      nonce: randomBytes(32).toString("hex"),
      expires_at: new Date(Date.now() + 600000).toISOString(),
      signature: "",
    };
    proof.signature = sign(
      null,
      Buffer.from(registrationMessage(proof)),
      added.privateKey,
    ).toString("base64");
    await expect(
      auth.challenge("binding", { ...proof, public_key: oldKey }),
    ).rejects.toMatchObject({ status: 422 });
    const c = await auth.challenge("binding", proof),
      info = await auth.inspect(c.id);
    await auth.approve(
      c.id,
      oldKey,
      sign(null, Buffer.from(info.payload), existing.privateKey).toString(
        "base64",
      ),
    );
    const results = await Promise.allSettled([
      auth.complete(c.id, "binding"),
      auth.complete(c.id, "binding"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (await auth.devices()).filter((d) => d.public_key === publicKey(added)),
    ).toHaveLength(0); // Listing exposes fingerprints, never key material.
    expect(
      await db.query("select id from resume.auth_devices where public_key=$1", [
        publicKey(added),
      ]),
    ).toHaveLength(1);
    const expired = await auth.challenge("expired");
    await db.query(
      "update resume.auth_challenges set expires_at=now()-interval '1 second' where id=$1",
      [expired.id],
    );
    await expect(auth.inspect(expired.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("resumes autosaving once invalid input is corrected", async () => {
    const q = new SaveQueue("", 0, async (s) => {
      if (s === "bad") parseResume({});
      return { revision: 1 };
    });
    q.change("bad");
    await expect(q.flush()).rejects.toThrow();
    q.change("corrected");
    await q.flush();
    expect(q.state).toBe("saved");
    q.dispose();
  });
  it("does not grant anonymous SQL access", async () => {
    await db.query("create role test_anonymous");
    await db.query("set role test_anonymous");
    try {
      await expect(
        db.query("select * from resume.resume_documents"),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await db.query("reset role");
    }
  });
});
