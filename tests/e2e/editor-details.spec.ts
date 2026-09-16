import { test, expect } from "@playwright/test";
import {
  blankResume,
  blankFields,
  richText,
  parseResume,
  type ResumeData,
} from "../../packages/resume-schema/src";

function fixture(): ResumeData {
  const doc = blankResume();
  Object.assign(doc.sections[0].items[0].fields, {
    name: "테스트 지원자",
    role: "서비스 기획",
    email: "applicant@example.test",
    github: "https://example.test/portfolio",
  });
  doc.sections[1].items[0].fields.body = richText(
    "이 문서는 출력 검증을 위한 가상의 이력서입니다. 사용자 경험을 관찰하고 작은 실험으로 개선하는 과정을 소개합니다.\n여러 분야의 경험을 직무에 맞게 정리합니다.",
  );
  for (const s of doc.sections.slice(2)) {
    const f = blankFields(s.kind);
    Object.assign(
      f,
      Object.fromEntries(
        Object.keys(f)
          .filter((k) =>
            [
              "name",
              "role",
              "category",
              "issuer",
              "level",
              "major_courses",
              "elective_courses",
              "reason",
              "summary",
              "team_size",
            ].includes(k),
          )
          .map((k) => [
            k,
            k === "category"
              ? s.kind === "awards"
                ? "활동"
                : s.kind === "certification"
                  ? "외국어"
                  : "기획 도구"
              : k === "name"
                ? `${s.kind} 더미 항목`
                : k === "team_size"
                  ? "4명"
                  : "더미 설명",
          ]),
      ),
    );
    if ("start" in f) f.start = "2024-01";
    if ("end" in f) f.end = "2025-12";
    if ("body" in f)
      f.body = richText(
        "목표를 정의하고 협업을 통해 개선한 과정을 간결하게 설명합니다.",
      );
    if ("tools" in f) f.tools = ["Figma", "SQL", "Notion"];
    if ("abstracts" in f)
      f.abstracts = [
        "사용자 문제를 정리하고 개선 방향을 제안했습니다.",
        "팀의 역할과 실행 범위를 정리했습니다.",
        "작은 실험으로 결과를 확인했습니다.",
      ];
    if ("links" in f) f.links = ["https://example.test/portfolio"];
    s.items = [{ id: crypto.randomUUID(), visible: true, fields: f }];
  }
  const timeline = doc.sections[2];
  timeline.items = Array.from({ length: 4 }, (_, i) => ({
    id: crypto.randomUUID(),
    visible: true,
    fields: {
      name: `연혁 ${i + 1}`,
      start: `202${5 - i}-01`,
      end: `202${5 - i}-12`,
      reference_id: "",
    },
  }));
  return parseResume(doc);
}
test("all sections, long items and Korean type paginate naturally", async ({
  page,
}, info) => {
  const doc = fixture();
  doc.sections[3].items = Array.from({ length: 5 }, (_, i) => ({
    id: crypto.randomUUID(),
    visible: true,
    fields: {
      ...blankFields("projects"),
      name: `검증 프로젝트 ${i + 1}`,
      summary: "실제 성과가 아닌 인쇄 테스트용 예시입니다.",
      start: "2023-01",
      end: "2024-12",
      role: "기획",
      team_size: "4명",
      abstracts: Array.from(
        { length: i === 2 ? 40 : 3 },
        (_, j) =>
          `항목 ${j + 1}. 문제를 발견하고 협업으로 해결한 과정을 설명합니다. 한 페이지보다 긴 항목도 잘리지 않고 다음 페이지로 자연스럽게 이어져야 합니다.`,
      ),
      links: ["https://example.test/portfolio"],
    },
  }));
  const id = crypto.randomUUID();
  await page.route(`**/api/v1/versions/${id}/data`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id, document: doc, revision: 0 }),
    }),
  );
  await page.goto(`/print/${id}`);
  await expect(
    page.getByRole("heading", { name: "테스트 지원자" }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-tools")).toBeHidden();
  await page.pdf({
    path: info.outputPath("all-sections-a4.pdf"),
    format: "A4",
    preferCSSPageSize: true,
    printBackground: true,
  });
  await page.screenshot({
    path: info.outputPath("all-sections.png"),
    fullPage: true,
  });
});
test("section editing, rich text, visibility and keyboard reordering persist", async ({
  page,
}) => {
  const id = crypto.randomUUID();
  let document = fixture(),
    revision = 0;
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (req.method() === "PUT") {
      const payload = req.postDataJSON();
      document = parseResume(payload.document);
      revision++;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ revision, document }),
      });
    }
    const body = path.endsWith("/activity")
      ? { ok: true }
      : {
          id,
          resume_id: crypto.randomUUID(),
          title: "상세 편집 검증",
          major: 1,
          minor: 0,
          document,
          revision,
        };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto(`/editor/${id}`);
  await expect(
    page.getByRole("heading", { name: "테스트 지원자" }),
  ).toBeVisible();
  await page.locator('[data-edit-section="introduction"]').click();
  const rich = page.locator('[contenteditable="true"]');
  await rich.fill("수정한 자기소개입니다.");
  await page.getByRole("button", { name: "목록", exact: true }).click();
  await page.locator(".paper-caption").click();
  await expect(page.getByText("저장 완료", { exact: true })).toBeVisible();
  expect(JSON.stringify(document.sections[1].items[0].fields.body)).toContain(
    "bulletList",
  );
  await page.locator('[data-edit-section="projects"]').click();
  await page
    .locator('[data-edit-section="projects"]')
    .getByRole("button", { name: "항목 숨기기", exact: true })
    .click();
  await page.locator(".paper-caption").click();
  await expect(page.getByText("저장 완료", { exact: true })).toBeVisible();
  expect(document.sections[3].items[0].visible).toBe(false);
  const handle = page.getByRole("button", {
    name: "Introduction 순서 변경",
    exact: true,
  });
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowDown");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "over droppable area timeline" }),
  ).toBeAttached();
  await page.keyboard.press("Space");
  await expect(page.getByText("저장 완료", { exact: true })).toBeVisible();
  await expect
    .poll(() => document.sections.map((s) => s.kind).indexOf("introduction"))
    .toBe(2);
  await page.reload();
  await expect(
    page.getByText("수정한 자기소개입니다.", { exact: true }),
  ).toBeVisible();
});
