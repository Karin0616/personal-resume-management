import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { generateKeyPairSync, sign, randomBytes } from "node:crypto";
import {
  blankResume,
  blankFields,
  parseResume,
  previewImport,
  publicSnapshot,
  richText,
  importJsonSchema,
} from "../packages/resume-schema/src";
import { ResumeService } from "../apps/web/src/server/resume-service";
import { AuthService, hash } from "../apps/web/src/server/auth";
import { SaveQueue } from "../apps/web/src/features/editor/save-queue";
import type { DB } from "../apps/web/src/server/db";
let pg: PGlite, db: DB, service: ResumeService;
function wrap(pg: any): DB {
  return {
    query: async (s, p = []) => {
      const result = await pg.query(s, p);
      return result.rows;
    },
    transaction: (fn) => pg.transaction((tx: any) => fn(wrap(tx))),
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
afterAll(async () => {
  await pg.close();
});
describe("Resume invariants", () => {
  it("validates all sections and rejects unknown fields, duplicate IDs and unsafe rich text", () => {
    const doc = blankResume();
    for (const s of doc.sections)
      if (!s.items.length)
        s.items.push({
          id: crypto.randomUUID(),
          visible: true,
          fields: blankFields(s.kind),
        });
    expect(parseResume(doc).sections).toHaveLength(10);
    expect(importJsonSchema().oneOf).toHaveLength(10);
    doc.sections[0].items[0].fields.injected = "bad";
    expect(() => parseResume(doc)).toThrow();
    delete doc.sections[0].items[0].fields.injected;
    doc.sections[1].items[0].fields.body = {
      type: "doc",
      content: [
        {
          type: "text",
          text: "x",
          marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
        },
      ],
    };
    expect(() => parseResume(doc)).toThrow();
  });
  it("clones freely, keeps numbers monotonic, saves without version creation, protects publication and deletion scope", async () => {
    const p = await service.purpose("더미 직무"),
      other = await service.purpose("다른 용도");
    const { resume, version } = await service.createResume({
      purpose_id: p.id,
      title: "더미 이력서",
    });
    const v = await service.version(version.id),
      doc = v.document;
    doc.sections[0].items[0].fields.name = "공개 더미";
    doc.sections[1].items[0].visible = false;
    doc.sections[1].items[0].fields.body = richText("숨긴 내용");
    expect((await service.save(v.id, 0, doc)).revision).toBe(1);
    expect(await service.versions(resume.id)).toHaveLength(1);
    const pub = await service.publish(v.id, 1);
    expect(
      JSON.stringify(await service.publicDocument(pub.token)),
    ).not.toContain("숨긴 내용");
    doc.sections[0].items[0].fields.name = "미공개 변경";
    await service.save(v.id, 1, doc);
    expect(JSON.stringify(await service.publicDocument(pub.token))).toContain(
      "공개 더미",
    );
    doc.sections[0].items[0].fields.name = "충돌";
    await expect(service.save(v.id, 0, doc)).rejects.toMatchObject({
      status: 409,
    });
    const clone = await service.createResume({
      purpose_id: other.id,
      title: "복제본",
      source_id: v.id,
    });
    expect(
      (await service.version(clone.version.id)).document.sections[0].items[0]
        .fields.name,
    ).toBe("미공개 변경");
    const next = await service.createVersion(resume.id, "major", v.id);
    expect([next.major, next.minor]).toEqual([2, 0]);
    const summary = await service.deleteSummary("versions", next.id);
    await service.remove("versions", next.id, "", summary.fingerprint);
    const nextAgain = await service.createVersion(resume.id, "minor", v.id);
    expect([nextAgain.major, nextAgain.minor]).toEqual([2, 1]);
    const stale = await service.deleteSummary("purposes", p.id);
    await service.createResume({ purpose_id: p.id, title: "추가" });
    await expect(
      service.remove("purposes", p.id, "삭제", stale.fingerprint),
    ).rejects.toMatchObject({ status: 409 });
    const fresh = await service.deleteSummary("purposes", p.id);
    await expect(
      service.remove("purposes", p.id, "yes", fresh.fingerprint),
    ).rejects.toMatchObject({ status: 422 });
    await service.remove("purposes", p.id, "삭제", fresh.fingerprint);
    const survived = await service.version(clone.version.id);
    expect(survived.source_id).toBeNull();
    expect(survived.source_snapshot.title).toBe("더미 이력서");
    await expect(service.publicDocument(pub.token)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("imports only allowed changes and keeps hidden references out of public snapshots", () => {
    const doc = blankResume();
    const project = {
      id: "demo",
      visible: false,
      fields: { ...blankFields("projects"), name: "비공개 프로젝트" },
    };
    doc.sections[3].items = [project];
    doc.sections[2].items = [
      {
        id: "line",
        visible: true,
        fields: { name: "연혁", start: "", end: "", reference_id: "demo" },
      },
    ];
    const payload = {
      schema_version: "1.0",
      target: { section: "projects", item_id: "demo" },
      changes: { summary: "새 설명" },
    };
    expect(previewImport(payload, doc).diff[0].after).toBe("새 설명");
    expect(doc.sections[3].items[0].fields.summary).toBe("");
    expect(() =>
      previewImport({ ...payload, changes: { visible: false } }, doc),
    ).toThrow();
    expect(() =>
      previewImport(
        { ...payload, target: { section: "projects", item_id: "missing" } },
        doc,
      ),
    ).toThrow();
    expect(
      publicSnapshot(doc).sections.find((s) => s.kind === "timeline")?.items,
    ).toHaveLength(0);
  });
});
describe("Ed25519 sessions", () => {
  it("binds completion to initiating browser, rejects replay and idle/revoked sessions", async () => {
    const pair = generateKeyPairSync("ed25519"),
      key = pair.publicKey
        .export({ format: "der", type: "spki" })
        .subarray(-32)
        .toString("base64");
    const device = (
      await db.query(
        "insert into resume.auth_devices(name,public_key,fingerprint) values($1,$2,$3) returning *",
        ["테스트 기기", key, hash(key)],
      )
    )[0];
    const auth = new AuthService(db, "https://resume.example"),
      binding = randomBytes(32).toString("hex"),
      c = await auth.challenge(binding),
      info = await auth.inspect(c.id);
    await expect(auth.approve(c.id, key, "invalid")).rejects.toMatchObject({
      status: 401,
    });
    await auth.approve(
      c.id,
      key,
      sign(null, Buffer.from(info.payload), pair.privateKey).toString("base64"),
    );
    await expect(
      auth.complete(c.id, "different-browser"),
    ).rejects.toMatchObject({ status: 404 });
    const result = await auth.complete(c.id, binding);
    expect("token" in result).toBe(true);
    const token = "token" in result ? result.token! : "";
    expect((await auth.session(token)).device_id).toBe(device.id);
    await expect(auth.complete(c.id, binding)).rejects.toMatchObject({
      status: 404,
    });
    await db.query(
      "update resume.edit_sessions set expires_at=now()-interval '1 second' where token_hash=$1",
      [hash(token)],
    );
    await expect(auth.session(token, true)).rejects.toMatchObject({
      status: 401,
    });
    await auth.revoke(device.id);
    await expect(auth.session(token)).rejects.toMatchObject({ status: 401 });
  });
});
describe("autosave queue", () => {
  it("serializes edits that arrive during a write", async () => {
    let unblock: () => void = () => {};
    const gate = new Promise<void>((r) => {
        unblock = r;
      }),
      writes: any[] = [];
    const q = new SaveQueue({ name: "" }, 0, async (doc, revision) => {
      writes.push({ doc, revision });
      if (writes.length === 1) await gate;
      return { revision: revision + 1 };
    });
    q.change({ name: "one" });
    const saving = q.flush();
    q.change({ name: "two" });
    unblock();
    await saving;
    expect(writes).toEqual([
      { doc: { name: "one" }, revision: 0 },
      { doc: { name: "two" }, revision: 1 },
    ]);
    expect(q.dirty).toBe(false);
    q.dispose();
  });
  it("retains local edits after failure and retries explicitly", async () => {
    let fail = true;
    const q = new SaveQueue("initial", 0, async () => {
      if (fail) throw new Error("offline");
      return { revision: 1 };
    });
    q.change("mine");
    await expect(q.flush()).rejects.toThrow("offline");
    q.change("newest");
    expect(q.document).toBe("newest");
    expect(q.state).toBe("error");
    fail = false;
    await q.retry();
    expect(q.dirty).toBe(false);
    q.dispose();
  });
});
