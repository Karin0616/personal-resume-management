import { randomBytes, createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  assetIds,
  blankResume,
  parseResume,
  previewImport,
  publicSnapshot,
  type ResumeData,
} from "@resume/schema";
import type { DB } from "./db";
import { AppError, required } from "./errors";

// All SQL stays in this persistence-facing service. HTTP and React never receive a DB client.
export class ResumeService {
  constructor(private db: DB) {}
  async home() {
    const [purposes, resumes, versions, state] = await Promise.all([
      this.db.query("select * from resume.purposes order by created_at"),
      this.db.query("select * from resume.resumes order by updated_at desc"),
      this.db.query(
        "select * from resume.resume_versions order by major desc,minor desc",
      ),
      this.db.query("select * from resume.workspace_state"),
    ]);
    return {
      purposes,
      resumes,
      versions,
      recent_version_id: state[0]?.version_id ?? null,
    };
  }
  async purpose(name: string, id?: string) {
    return required(
      (
        await this.db.query(
          id
            ? "update resume.purposes set name=$1,updated_at=now() where id=$2 returning *"
            : "insert into resume.purposes(name) values($1) returning *",
          id ? [name, id] : [name],
        )
      )[0],
    );
  }
  async renameResume(id: string, title: string, company: string | null) {
    return required(
      (
        await this.db.query(
          "update resume.resumes set title=$2,company=$3,updated_at=now() where id=$1 returning *",
          [id, title, company],
        )
      )[0],
    );
  }
  async createResume(input: {
    purpose_id: string;
    title: string;
    company?: string | null;
    source_id?: string;
  }) {
    return this.db.transaction(async (tx) => {
      await tx.query("select id from resume.purposes where id=$1 for update", [
        input.purpose_id,
      ]);
      const r = (
        await tx.query(
          "insert into resume.resumes(purpose_id,title,company) values($1,$2,$3) returning *",
          [input.purpose_id, input.title, input.company ?? null],
        )
      )[0];
      const v = await new ResumeService(tx).allocate(
        r.id,
        "minor",
        input.source_id,
      );
      return { resume: r, version: v };
    });
  }
  async version(id: string) {
    return required(
      (
        await this.db.query(
          "select v.*,d.document,d.revision,r.title,r.company,r.purpose_id from resume.resume_versions v join resume.resume_documents d on d.version_id=v.id join resume.resumes r on r.id=v.resume_id where v.id=$1",
          [id],
        )
      )[0],
    );
  }
  async versions(resumeId: string) {
    return this.db.query(
      "select * from resume.resume_versions where resume_id=$1 order by major desc,minor desc",
      [resumeId],
    );
  }
  async createVersion(
    resumeId: string,
    kind: "major" | "minor",
    sourceId?: string,
    document?: unknown,
  ) {
    return this.db.transaction((tx) =>
      new ResumeService(tx).allocate(resumeId, kind, sourceId, document),
    );
  }
  private async allocate(
    resumeId: string,
    kind: "major" | "minor",
    sourceId?: string,
    override?: unknown,
  ) {
    // Lock the purpose before the resume, also serializing scope deletion and creation.
    const owner = required(
      (
        await this.db.query(
          "select purpose_id from resume.resumes where id=$1",
          [resumeId],
        )
      )[0],
    );
    await this.db.query(
      "select id from resume.purposes where id=$1 for update",
      [owner.purpose_id],
    );
    const r = required(
      (
        await this.db.query(
          "select * from resume.resumes where id=$1 for update",
          [resumeId],
        )
      )[0],
    );
    const source = sourceId ? await this.version(sourceId) : null;
    const document = override
      ? parseResume(override)
      : source
        ? parseResume(source.document)
        : blankResume();
    const major =
      r.last_major === 0
        ? 1
        : kind === "major"
          ? r.last_major + 1
          : r.last_major;
    const minor = r.last_major === 0 || kind === "major" ? 0 : r.last_minor + 1;
    const provenance = source
      ? {
          purpose_id: source.purpose_id,
          title: source.title,
          company: source.company,
          major: source.major,
          minor: source.minor,
        }
      : null;
    if (source) {
      const p = (
        await this.db.query("select name from resume.purposes where id=$1", [
          source.purpose_id,
        ])
      )[0];
      Object.assign(provenance!, { purpose_name: p?.name });
    }
    const v = (
      await this.db.query(
        "insert into resume.resume_versions(resume_id,major,minor,source_id,source_snapshot) values($1,$2,$3,$4,$5) returning *",
        [
          resumeId,
          major,
          minor,
          sourceId ?? null,
          provenance ? JSON.stringify(provenance) : null,
        ],
      )
    )[0];
    await this.db.query(
      "insert into resume.resume_documents(version_id,document) values($1,$2)",
      [v.id, JSON.stringify(document)],
    );
    await this.syncAssets(v.id, document);
    await this.db.query(
      "update resume.resumes set last_major=$2,last_minor=$3,updated_at=now() where id=$1",
      [resumeId, major, minor],
    );
    await this.activity(v.id);
    return v;
  }
  async save(id: string, revision: number, input: unknown, kind = "edit") {
    const document = parseResume(input);
    return this.db.transaction(async (tx) => {
      const old = required(
        (
          await tx.query(
            "select * from resume.resume_documents where version_id=$1 for update",
            [id],
          )
        )[0],
      );
      // A response can be lost after commit: identical retry is an acknowledged no-op.
      if (isDeepStrictEqual(old.document, document))
        return { revision: old.revision, document: old.document };
      if (old.revision !== revision)
        throw new AppError(
          409,
          "REVISION_CONFLICT",
          "다른 기기에서 변경됐습니다. 서버본을 확인하거나 내 편집본을 새 버전으로 보존하세요.",
        );
      const next = revision + 1;
      await tx.query(
        "update resume.resume_documents set document=$2,revision=$3 where version_id=$1",
        [id, JSON.stringify(document), next],
      );
      await new ResumeService(tx).syncAssets(id, document);
      const areas = document.sections
        .filter(
          (s) =>
            JSON.stringify(s) !==
            JSON.stringify(
              old.document.sections.find((o: any) => o.id === s.id),
            ),
        )
        .map((s) => s.kind);
      if (
        JSON.stringify(old.document.sections.map((s: any) => s.id)) !==
        JSON.stringify(document.sections.map((s) => s.id))
      )
        areas.push("section-order" as any);
      await tx.query(
        "insert into resume.resume_history(version_id,revision,kind,areas) values($1,$2,$3,$4)",
        [id, next, kind, JSON.stringify(areas)],
      );
      await tx.query(
        "delete from resume.resume_history where version_id=$1 and id not in (select id from resume.resume_history where version_id=$1 order by id desc limit 100)",
        [id],
      );
      await tx.query(
        "update resume.resume_versions set updated_at=now() where id=$1",
        [id],
      );
      await tx.query(
        "update resume.resumes set updated_at=now() where id=(select resume_id from resume.resume_versions where id=$1)",
        [id],
      );
      await new ResumeService(tx).activity(id);
      return { revision: next, document };
    });
  }
  private async syncAssets(id: string, doc: ResumeData, publication = false) {
    const table = publication ? "publication_assets" : "version_assets";
    await this.db.query(`delete from resume.${table} where version_id=$1`, [
      id,
    ]);
    for (const asset of assetIds(doc))
      await this.db.query(
        `insert into resume.${table}(version_id,asset_id) values($1,$2)`,
        [id, asset],
      );
  }
  async label(id: string, label: string) {
    return required(
      (
        await this.db.query(
          "update resume.resume_versions set label=$2,updated_at=now() where id=$1 returning *",
          [id, label],
        )
      )[0],
    );
  }
  async activity(id: string) {
    await this.db.query(
      "update resume.workspace_state set version_id=$1,active_at=now() where id=true",
      [id],
    );
    return { ok: true };
  }
  async history(id: string) {
    return this.db.query(
      "select revision,kind,areas,created_at from resume.resume_history where version_id=$1 order by id desc limit 100",
      [id],
    );
  }
  private validateImport(payload: unknown, document: ResumeData) {
    try {
      return previewImport(payload, document);
    } catch (e) {
      throw new AppError(422, "INVALID_IMPORT", (e as Error).message);
    }
  }
  async importPreview(id: string, payload: unknown) {
    const v = await this.version(id);
    return {
      revision: v.revision,
      ...this.validateImport(payload, v.document),
    };
  }
  async importApply(id: string, revision: number, payload: unknown) {
    const v = await this.version(id);
    if (v.revision !== revision)
      throw new AppError(
        409,
        "REVISION_CONFLICT",
        "미리보기 이후 변경되었습니다. 다시 확인하세요.",
      );
    return this.save(
      id,
      revision,
      this.validateImport(payload, v.document).document,
      "gpt-import",
    );
  }
  async publish(id: string, revision: number) {
    return this.db.transaction(async (tx) => {
      const v = required(
        (
          await tx.query(
            "select * from resume.resume_documents where version_id=$1 for update",
            [id],
          )
        )[0],
      );
      if (v.revision !== revision)
        throw new AppError(
          409,
          "REVISION_CONFLICT",
          "최신 저장 상태를 확인하세요.",
        );
      const snapshot = publicSnapshot(v.document);
      const p = (
        await tx.query(
          "insert into resume.publications(version_id,token,snapshot) values($1,$2,$3) on conflict(version_id) do update set snapshot=excluded.snapshot,updated_at=now() returning token",
          [id, randomBytes(24).toString("base64url"), JSON.stringify(snapshot)],
        )
      )[0];
      await new ResumeService(tx).syncAssets(id, snapshot, true);
      return p;
    });
  }
  async publication(id: string) {
    return (
      (
        await this.db.query(
          "select token,updated_at from resume.publications where version_id=$1",
          [id],
        )
      )[0] ?? null
    );
  }
  async unpublish(id: string) {
    await this.db.query("delete from resume.publications where version_id=$1", [
      id,
    ]);
    return { ok: true };
  }
  async publicDocument(token: string) {
    return required(
      (
        await this.db.query(
          "select snapshot from resume.publications where token=$1",
          [token],
        )
      )[0],
    ).snapshot as ResumeData;
  }
  async deleteSummary(scope: "purposes" | "resumes" | "versions", id: string) {
    const table = scope === "versions" ? "resume_versions" : scope;
    const root = required(
      (
        await this.db.query(`select * from resume.${table} where id=$1`, [id])
      )[0],
    );
    const rows = await this.db.query(
      `select v.id,v.updated_at from resume.resume_versions v join resume.resumes r on r.id=v.resume_id where ${scope === "purposes" ? "r.purpose_id" : scope === "resumes" ? "r.id" : "v.id"}=$1 order by v.id`,
      [id],
    );
    const resumes =
      scope === "purposes"
        ? await this.db.query(
            "select id,updated_at from resume.resumes where purpose_id=$1 order by id",
            [id],
          )
        : [];
    return {
      name: root.name ?? root.title ?? `v${root.major}.${root.minor}`,
      versions: rows.length,
      resumes:
        scope === "purposes" ? resumes.length : scope === "resumes" ? 1 : 0,
      fingerprint: createHash("sha256")
        .update(JSON.stringify({ root, rows, resumes }))
        .digest("hex"),
    };
  }
  async remove(
    scope: "purposes" | "resumes" | "versions",
    id: string,
    confirmation: string,
    fingerprint: string,
  ) {
    if (scope !== "versions" && confirmation !== "삭제")
      throw new AppError(422, "CONFIRM_REQUIRED", "삭제를 정확히 입력하세요.");
    return this.db.transaction(async (tx) => {
      // Coarse locks are deliberate: low-volume, single-owner app; exclude concurrent edits/children.
      await tx.query(
        "lock table resume.purposes,resume.resumes,resume.resume_versions,resume.resume_documents in share row exclusive mode",
      );
      const summary = await new ResumeService(tx).deleteSummary(scope, id);
      if (summary.fingerprint !== fingerprint)
        throw new AppError(
          409,
          "SCOPE_CHANGED",
          "삭제 범위가 변경되었습니다. 다시 확인하세요.",
        );
      await tx.query(
        `delete from resume.${scope === "versions" ? "resume_versions" : scope} where id=$1`,
        [id],
      );
      return { ok: true };
    });
  }
}
