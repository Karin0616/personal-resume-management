import { test, expect } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { ResumeService } from "../../apps/web/src/server/resume-service";
import type { DB } from "../../apps/web/src/server/db";
function wrap(pg: any): DB {
  return {
    query: async (s, p = []) => {
      const r = await pg.query(s, p);
      return r.rows;
    },
    transaction: (fn) => pg.transaction((tx: any) => fn(wrap(tx))),
  };
}
test("cloud service slice: create, edit, autosave, import preview, version, PDF", async ({
  page,
}, info) => {
  const pg = new PGlite();
  await pg.exec(
    await readFile("supabase/migrations/202609150001_initial.sql", "utf8"),
  );
  const service = new ResumeService(wrap(pg));
  // Browser-only HTTP test adapter backed by the real PostgreSQL service. No application auth bypass.
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(),
      parts = new URL(req.url()).pathname.split("/").slice(3),
      [r, id, a, b] = parts,
      m = req.method(),
      body = req.postDataJSON() ?? {};
    try {
      let result: any;
      if (r === "home") result = await service.home();
      else if (r === "purposes" && m === "POST")
        result = await service.purpose(body.name);
      else if (r === "resumes" && m === "POST")
        result =
          a === "versions"
            ? await service.createVersion(id, body.kind, body.source_id)
            : await service.createResume(body);
      else if (r === "resumes" && a === "versions")
        result = await service.versions(id);
      else if (r === "versions") {
        if (a === "activity") result = await service.activity(id);
        else if (a === "data" && m === "PUT")
          result = await service.save(id, body.revision, body.document);
        else if (a === "import")
          result =
            b === "preview"
              ? await service.importPreview(id, body.payload)
              : await service.importApply(id, body.revision, body.payload);
        else result = await service.version(id);
      } else if (r === "auth") result = { ok: true };
      if (result === undefined) throw new Error("Unhandled test request");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(result),
      });
    } catch (e) {
      await route.fulfill({
        status: (e as any).status ?? 500,
        contentType: "application/json",
        body: JSON.stringify({ message: (e as Error).message }),
      });
    }
  });
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "새 직무/용도", exact: true })
      .click();
    await page.getByLabel("직무/용도 이름").fill("테스트 기획");
    await page.getByRole("button", { name: "만들기", exact: true }).click();
    await page
      .getByRole("button", { name: "새 이력서", exact: true })
      .first()
      .click();
    await page.getByLabel("이력서 이름").fill("더미 공통본");
    await page.getByRole("button", { name: "만들기", exact: true }).click();
    await expect(page).toHaveURL(/editor/);
    await page.locator('[data-edit-section="profile"]').click();
    await page.getByPlaceholder("이름 / 제목").fill("홍길동 테스트");
    await page.getByPlaceholder("직무 / 역할").fill("서비스 기획자");
    await page.locator(".paper-caption").click();
    await expect(page.getByText("저장 완료", { exact: true })).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "홍길동 테스트" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "GPT 가져오기" }).click();
    await page
      .getByLabel("GPT JSON")
      .fill(
        JSON.stringify({
          schema_version: "1.0",
          target: { section: "profile" },
          changes: { role: "프로덕트 기획자" },
        }),
      );
    await page.getByRole("button", { name: "변경 미리보기" }).click();
    await expect(page.locator(".diff")).toContainText("프로덕트 기획자");
    await page.getByRole("button", { name: "현재 버전에 적용" }).click();
    await expect(page.locator(".profile-role")).toContainText(
      "프로덕트 기획자",
    );
    await page.getByRole("button", { name: "버전", exact: true }).click();
    await page.getByRole("button", { name: "새 Minor 버전" }).click();
    await expect(page.locator(".editor-toolbar")).toContainText("v1.1");
    await page.getByRole("button", { name: "PDF 출력" }).click();
    await expect(
      page.getByRole("heading", { name: "홍길동 테스트" }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: info.outputPath("resume-a4.pdf"),
      format: "A4",
      preferCSSPageSize: true,
      printBackground: true,
    });
    await page.screenshot({
      path: info.outputPath("resume.png"),
      fullPage: true,
    });
  } finally {
    await pg.close();
  }
});
test("anonymous home requires device authentication", async ({ page }) => {
  await page.route("**/api/v1/home", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "인증 필요", code: "SESSION_EXPIRED" }),
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "편집 인증 시작" }),
  ).toBeVisible();
});
