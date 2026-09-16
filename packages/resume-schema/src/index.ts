import { z } from "zod";

export const kinds = [
  "profile",
  "introduction",
  "timeline",
  "projects",
  "experience",
  "skills",
  "education",
  "training",
  "awards",
  "certification",
] as const;
export type Kind = (typeof kinds)[number];
export const titles: Record<Kind, string> = {
  profile: "Profile / Header",
  introduction: "Introduction",
  timeline: "Timeline",
  projects: "Projects",
  experience: "Experience",
  skills: "Skills",
  education: "Education",
  training: "Relevant Training",
  awards: "Awards / Activities",
  certification: "Certification / Language",
};
export const fieldLabels: Record<string, string> = {
  name: "이름 / 제목",
  role: "직무 / 역할",
  phone: "연락처",
  email: "이메일",
  github: "GitHub",
  blog: "Blog",
  summary: "한 줄 설명",
  start: "시작 (YYYY-MM)",
  end: "종료 (YYYY-MM / 현재)",
  team_size: "팀 규모",
  abstracts: "Abstract (한 줄에 하나)",
  links: "관련 링크 (한 줄에 하나)",
  category: "분류",
  tools: "기술 / 도구 (한 줄에 하나)",
  major_courses: "전공 과목",
  elective_courses: "교양 과목",
  reason: "선택 이유",
  issuer: "기관",
  level: "등급",
  reference_id: "연결할 항목 ID",
  body: "상세 내용",
};
const text = z.string().max(12000);
const short = z.string().max(300);
const date = z.string().regex(/^$|^\d{4}-(0[1-9]|1[0-2])$|^현재$/);
export const safeUrl = z
  .string()
  .max(2000)
  .refine((s) => {
    try {
      return ["https:", "http:"].includes(new URL(s).protocol);
    } catch {
      return false;
    }
  }, "http/https 링크만 사용할 수 있습니다.");
const optionalUrl = z.union([z.literal(""), safeUrl]);
export type RichNode = {
  type: string;
  text?: string;
  attrs?: { start?: number; type?: string | null };
  content?: RichNode[];
  marks?: {
    type: string;
    attrs?: {
      href: string;
      target?: string | null;
      rel?: string | null;
      class?: string | null;
    };
  }[];
};
const node: z.ZodType<RichNode> = z.lazy(() =>
  z
    .object({
      type: z.enum([
        "doc",
        "paragraph",
        "text",
        "bulletList",
        "orderedList",
        "listItem",
        "hardBreak",
      ]),
      text: text.optional(),
      content: z.array(node).max(2000).optional(),
      attrs: z
        .object({
          start: z.number().int().min(1).max(10000).optional(),
          type: z.string().nullable().optional(),
        })
        .strict()
        .optional(),
      marks: z
        .array(
          z
            .object({
              type: z.enum(["bold", "italic", "strike", "code", "link"]),
              attrs: z
                .object({
                  href: safeUrl,
                  target: z.string().nullable().optional(),
                  rel: z.string().nullable().optional(),
                  class: z.string().nullable().optional(),
                })
                .strict()
                .optional(),
            })
            .strict(),
        )
        .max(10)
        .optional(),
    })
    .strict(),
);
export const richSchema = node.refine(
  (n) => n.type === "doc",
  "doc 노드가 필요합니다.",
);
export const emptyRich = (): RichNode => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});
export const richText = (s: string): RichNode => ({
  type: "doc",
  content: s
    .split("\n")
    .map((t) => ({
      type: "paragraph",
      ...(t ? { content: [{ type: "text", text: t }] } : {}),
    })),
});
export const fields = {
  profile: z.object({
    name: short,
    role: short,
    phone: short,
    email: z.union([z.literal(""), z.email()]),
    github: optionalUrl,
    blog: optionalUrl,
    photo_asset_id: z.uuid().nullable(),
  }),
  introduction: z.object({ body: richSchema }),
  timeline: z.object({
    name: short,
    start: date,
    end: date,
    reference_id: z.string().max(100),
  }),
  projects: z.object({
    name: short,
    summary: text,
    start: date,
    end: date,
    team_size: short,
    role: short,
    abstracts: z.array(text).max(20),
    links: z.array(safeUrl).max(20),
  }),
  experience: z.object({
    name: short,
    role: short,
    start: date,
    end: date,
    body: richSchema,
  }),
  skills: z.object({ category: short, tools: z.array(short).max(100) }),
  education: z.object({
    name: short,
    start: date,
    end: date,
    major_courses: text,
    elective_courses: text,
    reason: text,
  }),
  training: z.object({ name: short, start: date, end: date, body: richSchema }),
  awards: z.object({
    name: short,
    category: z.enum(["수상", "활동"]),
    start: date,
    end: date,
    body: richSchema,
  }),
  certification: z.object({
    name: short,
    category: z.enum(["자격증", "외국어"]),
    issuer: short,
    level: short,
    start: date,
  }),
} satisfies Record<Kind, z.ZodObject>;
export type Item = {
  id: string;
  visible: boolean;
  fields: Record<string, any>;
};
export type Section = {
  id: string;
  kind: Kind;
  visible: boolean;
  items: Item[];
};
export type ResumeData = { schema_version: "1.0"; sections: Section[] };
export const resumeSchema = z
  .object({
    schema_version: z.literal("1.0"),
    sections: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            kind: z.enum(kinds),
            visible: z.boolean(),
            items: z
              .array(
                z
                  .object({
                    id: z.string().min(1).max(100),
                    visible: z.boolean(),
                    fields: z.record(z.string(), z.unknown()),
                  })
                  .strict(),
              )
              .max(500),
          })
          .strict(),
      )
      .max(10),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const ids = new Set<string>(),
      seen = new Set<Kind>();
    doc.sections.forEach((s, i) => {
      if (seen.has(s.kind) || ids.has(s.id))
        ctx.addIssue({
          code: "custom",
          message: "섹션 종류와 ID는 중복될 수 없습니다.",
          path: ["sections", i],
        });
      seen.add(s.kind);
      ids.add(s.id);
      if (["profile", "introduction"].includes(s.kind) && s.items.length > 1)
        ctx.addIssue({
          code: "custom",
          message: "단일 항목 섹션입니다.",
          path: ["sections", i],
        });
      s.items.forEach((item, j) => {
        if (ids.has(item.id))
          ctx.addIssue({
            code: "custom",
            message: "ID 중복",
            path: ["sections", i, "items", j],
          });
        ids.add(item.id);
        const result = fields[s.kind].strict().safeParse(item.fields);
        if (!result.success)
          result.error.issues.forEach((issue) =>
            ctx.addIssue({
              ...issue,
              path: ["sections", i, "items", j, "fields", ...issue.path],
            }),
          );
      });
    });
  });
export function parseResume(value: unknown): ResumeData {
  return resumeSchema.parse(value) as ResumeData;
}
export function blankFields(kind: Kind): Record<string, any> {
  const period = { start: "", end: "" };
  const map = {
    profile: {
      name: "",
      role: "",
      phone: "",
      email: "",
      github: "",
      blog: "",
      photo_asset_id: null,
    },
    introduction: { body: emptyRich() },
    timeline: { name: "", ...period, reference_id: "" },
    projects: {
      name: "",
      summary: "",
      ...period,
      team_size: "",
      role: "",
      abstracts: [],
      links: [],
    },
    experience: { name: "", role: "", ...period, body: emptyRich() },
    skills: { category: "", tools: [] },
    education: {
      name: "",
      ...period,
      major_courses: "",
      elective_courses: "",
      reason: "",
    },
    training: { name: "", ...period, body: emptyRich() },
    awards: { name: "", category: "활동", ...period, body: emptyRich() },
    certification: {
      name: "",
      category: "자격증",
      issuer: "",
      level: "",
      start: "",
    },
  };
  return map[kind];
}
export function blankResume(): ResumeData {
  return {
    schema_version: "1.0",
    sections: kinds.map((kind) => ({
      id: kind,
      kind,
      visible: true,
      items: ["profile", "introduction"].includes(kind)
        ? [
            {
              id: crypto.randomUUID(),
              visible: true,
              fields: blankFields(kind),
            },
          ]
        : [],
    })),
  };
}
export function assetIds(doc: ResumeData): string[] {
  return [
    ...new Set(
      doc.sections.flatMap((s) =>
        s.kind === "profile"
          ? s.items.flatMap((i) =>
              i.fields.photo_asset_id
                ? [i.fields.photo_asset_id as string]
                : [],
            )
          : [],
      ),
    ),
  ];
}
export function publicSnapshot(input: ResumeData): ResumeData {
  const doc = structuredClone(parseResume(input));
  const visibleItems = new Map(
    doc.sections
      .filter((s) => s.visible)
      .flatMap((s) =>
        s.items.filter((i) => i.visible).map((i) => [i.id, i] as const),
      ),
  );
  doc.sections = doc.sections
    .filter((s) => s.visible)
    .map((s) => ({
      ...s,
      items: s.items
        .filter((i) => i.visible)
        .flatMap((i) => {
          if (s.kind !== "timeline" || !i.fields.reference_id) return [i];
          const source = visibleItems.get(i.fields.reference_id);
          if (!source) return [];
          return [
            {
              ...i,
              fields: {
                name: source.fields.name ?? "",
                start: source.fields.start ?? "",
                end: source.fields.end ?? "",
                reference_id: "",
              },
            },
          ];
        }),
    }));
  return doc;
}
export const importSchema = z
  .object({
    schema_version: z.literal("1.0"),
    target: z
      .object({
        section: z.enum(kinds),
        item_id: z.string().min(1).max(100).optional(),
      })
      .strict(),
    changes: z.record(z.string(), z.unknown()),
  })
  .strict();
export function previewImport(input: unknown, current: ResumeData) {
  const payload = importSchema.parse(input),
    doc = structuredClone(current);
  const section = doc.sections.find((s) => s.kind === payload.target.section);
  const item = payload.target.item_id
    ? section?.items.find((i) => i.id === payload.target.item_id)
    : ["profile", "introduction"].includes(payload.target.section)
      ? section?.items[0]
      : undefined;
  if (!section || !item) throw new Error("대상 섹션/항목을 찾을 수 없습니다.");
  if (!Object.keys(payload.changes).length)
    throw new Error("변경할 필드가 없습니다.");
  if ("photo_asset_id" in payload.changes || "reference_id" in payload.changes)
    throw new Error("사진/연결 참조는 앱에서 변경하세요.");
  const changes = fields[section.kind]
    .partial()
    .strict()
    .parse(payload.changes);
  const diff = Object.entries(changes).map(([field, after]) => ({
    field,
    before: item.fields[field],
    after,
  }));
  item.fields = { ...item.fields, ...changes };
  return { document: parseResume(doc), diff };
}
export function importJsonSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    oneOf: kinds.map((kind) => ({
      type: "object",
      additionalProperties: false,
      required: ["schema_version", "target", "changes"],
      properties: {
        schema_version: { const: "1.0" },
        target: {
          type: "object",
          additionalProperties: false,
          required: [
            "section",
            ...(["profile", "introduction"].includes(kind) ? [] : ["item_id"]),
          ],
          properties: { section: { const: kind }, item_id: { type: "string" } },
        },
        changes: z.toJSONSchema(
          (fields[kind] as z.ZodObject)
            .omit(
              kind === "profile"
                ? { photo_asset_id: true }
                : kind === "timeline"
                  ? { reference_id: true }
                  : {},
            )
            .partial()
            .strict(),
        ),
      },
    })),
  };
}
