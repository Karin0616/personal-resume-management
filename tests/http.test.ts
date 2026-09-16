import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { generateKeyPairSync, sign } from "node:crypto";
import { hash } from "../apps/web/src/server/auth";
import type { DB } from "../apps/web/src/server/db";
const injection = vi.hoisted(() => ({ db: null as DB | null }));
vi.mock("../apps/web/src/server/db", () => ({ getDB: () => injection.db }));
import { GET, POST, PUT } from "../apps/web/src/app/api/v1/[...path]/route";
// Load NextRequest through the web workspace, where next is an explicit dependency.
import { NextRequest } from "../apps/web/node_modules/next/server";
let pg: PGlite;
function wrap(p: any): DB {
  return {
    query: async (s, args = []) => {
      const r = await p.query(s, args);
      return r.rows;
    },
    transaction: (fn) => p.transaction((tx: any) => fn(wrap(tx))),
  };
}
const origin = "https://resume.example";
function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = "",
  csrf = true,
) {
  return new NextRequest(`${origin}/api/v1/${path}`, {
    method,
    headers: {
      origin,
      ...(csrf ? { "x-resume-csrf": "1" } : {}),
      "content-type": "application/json",
      cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function context(path: string) {
  return { params: Promise.resolve({ path: path.split("/") }) };
}
beforeAll(async () => {
  process.env.APP_ORIGIN = origin;
  pg = new PGlite();
  await pg.exec(
    await readFile("supabase/migrations/202609150001_initial.sql", "utf8"),
  );
  injection.db = wrap(pg);
});
afterAll(async () => {
  await pg.close();
});
describe("HTTP authorization boundary", () => {
  it("rejects anonymous management reads and mutations, and CSRF", async () => {
    expect((await GET(request("home"), context("home"))).status).toBe(401);
    expect(
      (
        await POST(
          request("purposes", "POST", { name: "bad" }),
          context("purposes"),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await POST(
          request("purposes", "POST", { name: "bad" }, "", false),
          context("purposes"),
        )
      ).status,
    ).toBe(403);
    expect(
      (await injection.db!.query("select * from resume.purposes")).length,
    ).toBe(0);
  });
  it("issues only a Secure HttpOnly browser-bound cookie after native Ed25519 approval", async () => {
    const keys = generateKeyPairSync("ed25519"),
      key = keys.publicKey
        .export({ format: "der", type: "spki" })
        .subarray(-32)
        .toString("base64");
    await injection.db!.query(
      "insert into resume.auth_devices(name,public_key,fingerprint) values($1,$2,$3)",
      ["HTTP 테스트", key, hash(key)],
    );
    const issued = await POST(
      request("auth/challenges", "POST", {}),
      context("auth/challenges"),
    );
    expect(issued.status).toBe(200);
    const c = await issued.json();
    const binding = issued.headers.get("set-cookie")!.split(";")[0],
      challenge = await (
        await GET(
          request(`auth/challenges/${c.id}`),
          context(`auth/challenges/${c.id}`),
        )
      ).json();
    const signature = sign(
      null,
      Buffer.from(challenge.payload),
      keys.privateKey,
    ).toString("base64");
    const approval = new NextRequest(
      `${origin}/api/v1/auth/challenges/${c.id}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ public_key: key, signature }),
      },
    );
    expect(
      (await POST(approval, context(`auth/challenges/${c.id}/approve`))).status,
    ).toBe(200);
    const done = await POST(
      request(`auth/challenges/${c.id}/complete`, "POST", {}, binding),
      context(`auth/challenges/${c.id}/complete`),
    );
    expect(done.headers.get("set-cookie")).toContain("HttpOnly");
    expect(done.headers.get("set-cookie")).toContain("Secure");
    expect(done.headers.get("set-cookie")).toContain("SameSite=strict");
    const session = done.cookies.get("__Host-resume-session")!.value,
      cookie = `__Host-resume-session=${session}`;
    const purpose = await POST(
      request("purposes", "POST", { name: "API 직무" }, cookie),
      context("purposes"),
    );
    expect(purpose.status).toBe(200);
    const p = await purpose.json();
    const created = await (
      await POST(
        request(
          "resumes",
          "POST",
          { purpose_id: p.id, title: "API 이력서" },
          cookie,
        ),
        context("resumes"),
      )
    ).json();
    const v = await (
      await GET(
        request(`versions/${created.version.id}`, "GET", undefined, cookie),
        context(`versions/${created.version.id}`),
      )
    ).json();
    v.document.sections[0].items[0].fields.name = "HTTP 더미";
    const saved = await PUT(
      request(
        `versions/${v.id}/data`,
        "PUT",
        { revision: 0, document: v.document },
        cookie,
      ),
      context(`versions/${v.id}/data`),
    );
    expect(saved.status).toBe(200);
    const replay = await POST(
      request(`auth/challenges/${c.id}/complete`, "POST", {}, binding),
      context(`auth/challenges/${c.id}/complete`),
    );
    expect(replay.status).toBe(404);
  });
});
