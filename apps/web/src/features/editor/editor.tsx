"use client";
import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensors,
  useSensor,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import {
  ArrowLeft,
  Download,
  GitBranch,
  Globe,
  Braces,
  History,
  Check,
  Cloud,
  AlertCircle,
} from "lucide-react";
import { titles, parseResume, type ResumeData } from "@resume/schema";
import { api, ApiError, versionName, dateLabel } from "../api";
import { SaveQueue } from "./save-queue";
import { Sortable, SectionEditor } from "./section-editor";
import { Dialog } from "../dialog";
import { DeleteDialog } from "../delete-dialog";
import { Login } from "../auth/login";
import { ResumeDocument } from "@/components/resume/document";
export function Editor({ id }: { id: string }) {
  const [version, setVersion] = useState<any>(null),
    [document, setDocument] = useState<ResumeData | null>(null),
    [active, setActive] = useState<string | null>(null),
    [error, setError] = useState(""),
    [locked, setLocked] = useState(false),
    [tick, setTick] = useState(0),
    [modal, setModal] = useState<
      "versions" | "import" | "publish" | "history" | "conflict" | null
    >(null),
    [extra, setExtra] = useState<any>(null),
    [deleting, setDeleting] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [importText, setImportText] = useState(""),
    [preview, setPreview] = useState<any>(null);
  const queue = useRef<SaveQueue<ResumeData> | null>(null),
    root = useRef<HTMLDivElement>(null),
    composing = useRef(false),
    activeRef = useRef(active);
  activeRef.current = active;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  function install(v: any) {
    queue.current?.dispose();
    queue.current = new SaveQueue<ResumeData>(
      v.document,
      v.revision,
      (doc, revision) =>
        api(`versions/${id}/data`, "PUT", {
          revision,
          document: parseResume(doc),
        }),
      () => setTick((n) => n + 1),
    );
    setVersion(v);
    setDocument(v.document);
    setLocked(false);
  }
  async function load() {
    try {
      const v = await api(`versions/${id}`);
      install(v);
      await api(`versions/${id}/activity`, "POST");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setLocked(true);
      else setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
    return () => queue.current?.dispose();
  }, [id]);
  useEffect(() => {
    function outside(e: PointerEvent) {
      const target = e.target as HTMLElement;
      if (composing.current || target.closest("dialog")) return;
      const section = target
        .closest("[data-edit-section]")
        ?.getAttribute("data-edit-section");
      if (activeRef.current && section !== activeRef.current) {
        setActive(null);
        setTimeout(() => void queue.current?.flush().catch(() => {}), 0);
      }
    }
    function leave(e: BeforeUnloadEvent) {
      if (queue.current?.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("pointerdown", outside);
    window.addEventListener("beforeunload", leave);
    let activity = false;
    const mark = () => {
      activity = true;
    };
    window.addEventListener("pointerdown", mark);
    window.addEventListener("keydown", mark);
    const heartbeat = setInterval(() => {
      if (activity && globalThis.document.visibilityState === "visible") {
        activity = false;
        void api("auth/session/activity", "POST").catch(() => {});
      }
    }, 60_000);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("beforeunload", leave);
      window.removeEventListener("pointerdown", mark);
      window.removeEventListener("keydown", mark);
      clearInterval(heartbeat);
    };
  }, []);
  const state = queue.current?.state ?? "saved";
  void tick;
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function change(next: ResumeData) {
    setDocument(next);
    queue.current?.change(next);
  }
  async function flush() {
    await queue.current?.flush();
  }
  async function open(which: typeof modal) {
    await run(async () => {
      await flush();
      if (which === "versions")
        setExtra(await api(`resumes/${version.resume_id}/versions`));
      if (which === "history") setExtra(await api(`versions/${id}/history`));
      if (which === "publish")
        setExtra(await api(`versions/${id}/publication`));
      setPreview(null);
      setModal(which);
    });
  }
  if (locked && !document) return <Login onSuccess={load} />;
  if (!document || !version)
    return <div className="empty">{error || "이력서를 불러오는 중…"}</div>;
  const saveError = queue.current?.error;
  return (
    <div
      ref={root}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
    >
      <div className="editor-toolbar no-print">
        <div className="actions">
          <button
            aria-label="홈으로"
            onClick={() =>
              run(async () => {
                await flush();
                window.location.assign("/");
              })
            }
          >
            <ArrowLeft size={17} />
          </button>
          <div>
            <strong>{version.title}</strong>
            <span className="muted small">
              {" "}
              {versionName(version)} {version.label && `· ${version.label}`}
            </span>
          </div>
        </div>
        <div className="actions">
          <span className={`save-status ${state}`} aria-live="polite">
            {state === "saved" ? (
              <Check size={14} />
            ) : state === "error" ? (
              <AlertCircle size={14} />
            ) : (
              <Cloud size={14} />
            )}
            {
              {
                saved: "저장 완료",
                pending: "저장 대기",
                saving: "저장 중…",
                error: "저장 실패",
              }[state]
            }
          </span>
          <button disabled={busy} onClick={() => open("versions")}>
            <GitBranch size={15} /> 버전
          </button>
          <button disabled={busy} onClick={() => open("import")}>
            <Braces size={15} /> GPT 가져오기
          </button>
          <button
            disabled={busy}
            onClick={() => open("history")}
            aria-label="변경 기록"
          >
            <History size={16} />
          </button>
          <button disabled={busy} onClick={() => open("publish")}>
            <Globe size={15} /> 공개
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await flush();
                window.location.assign(`/print/${id}`);
              })
            }
          >
            <Download size={15} /> PDF 출력
          </button>
        </div>
      </div>
      {(error || saveError) && (
        <div className="notice error no-print" role="alert">
          {error || saveError?.message}
          {saveError && (
            <div className="actions">
              <button
                onClick={() =>
                  run(async () => {
                    await queue.current?.retry();
                  })
                }
              >
                저장 재시도
              </button>
              {saveError instanceof ApiError && saveError.status === 401 && (
                <button onClick={() => setLocked(true)}>재인증</button>
              )}
              {saveError instanceof ApiError && saveError.status === 409 && (
                <button
                  onClick={() =>
                    run(async () => {
                      setExtra(await api(`versions/${id}`));
                      setModal("conflict");
                    })
                  }
                >
                  서버본 비교 / 내 편집본 보존
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <div className="editor-layout">
        <aside className="editor-nav no-print">
          <p className="eyebrow">CONTENTS</p>
          {document.sections.map((s, i) => (
            <button
              key={s.id}
              className={active === s.id ? "active" : ""}
              onClick={() => {
                setActive(s.id);
                globalThis.document
                  .querySelector(`[data-edit-section="${s.id}"]`)
                  ?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              {titles[s.kind]}
            </button>
          ))}
          <p className="small muted">
            섹션을 클릭해 편집하세요.
            <br />
            바깥을 클릭하면 저장됩니다.
          </p>
        </aside>
        <div className="editor-canvas">
          <div className="paper-caption no-print">
            <span>A4 · 자유로운 페이지 흐름</span>
            <span>직접 편집</span>
          </div>
          <article className="resume-paper editor-paper">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={({ active, over }) => {
                if (over && active.id !== over.id)
                  change({
                    ...document,
                    sections: arrayMove(
                      document.sections,
                      document.sections.findIndex((s) => s.id === active.id),
                      document.sections.findIndex((s) => s.id === over.id),
                    ),
                  });
              }}
            >
              <SortableContext
                items={document.sections.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                {document.sections.map((s) => (
                  <Sortable id={s.id} label={titles[s.kind]} key={s.id}>
                    <SectionEditor
                      section={s}
                      document={document}
                      active={active === s.id}
                      onActivate={() => setActive(s.id)}
                      onChange={(section) => {
                        const current = queue.current!.document;
                        change({
                          ...current,
                          sections: current.sections.map((old) =>
                            old.id === s.id ? section : old,
                          ),
                        });
                      }}
                      onError={setError}
                    />
                  </Sortable>
                ))}
              </SortableContext>
            </DndContext>
          </article>
        </div>
      </div>
      {locked && (
        <Dialog title="편집 세션 재인증" onClose={() => setLocked(false)}>
          <Login
            onSuccess={() => {
              setLocked(false);
              void run(async () => {
                await queue.current?.retry();
              });
            }}
          />
        </Dialog>
      )}
      {modal === "versions" && (
        <Dialog title="버전 관리" onClose={() => setModal(null)}>
          <p className="muted">
            자동저장은 현재 버전을 갱신합니다. 중요한 시점에 새 버전을 만드세요.
          </p>
          <div className="actions">
            {(["minor", "major"] as const).map((kind) => (
              <button
                key={kind}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await flush();
                    const v = await api(
                      `resumes/${version.resume_id}/versions`,
                      "POST",
                      { kind, source_id: id },
                    );
                    window.location.assign(`/editor/${v.id}`);
                  })
                }
              >
                새 {kind === "major" ? "Major" : "Minor"} 버전
              </button>
            ))}
          </div>
          {extra?.map((v: any) => (
            <div className="version-row" key={v.id}>
              <div>
                <button
                  className="quiet"
                  onClick={() =>
                    run(async () => {
                      await flush();
                      window.location.assign(`/editor/${v.id}`);
                    })
                  }
                >
                  <strong>
                    {versionName(v)} {v.id === id ? "· 현재" : ""}
                  </strong>{" "}
                  {v.label}
                </button>
                <p className="small muted">
                  생성 {dateLabel(v.created_at)}
                  <br />
                  수정 {dateLabel(v.updated_at)}
                </p>
                {v.source_snapshot && (
                  <p className="small">
                    복제 출처: {v.source_snapshot.purpose_name} /{" "}
                    {v.source_snapshot.title} / v{v.source_snapshot.major}.
                    {v.source_snapshot.minor}
                  </p>
                )}
              </div>
              <div className="actions">
                <button
                  onClick={() =>
                    run(async () => {
                      const label = prompt("버전 라벨", v.label ?? "");
                      if (label === null) return;
                      await api(`versions/${v.id}`, "PATCH", { label });
                      setExtra(
                        await api(`resumes/${version.resume_id}/versions`),
                      );
                      if (v.id === id) setVersion({ ...version, label });
                    })
                  }
                >
                  라벨
                </button>
                <button onClick={() => setDeleting(v.id)}>삭제</button>
              </div>
            </div>
          ))}
        </Dialog>
      )}
      {deleting && (
        <DeleteDialog
          scope="versions"
          id={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            if (deleting === id) window.location.assign("/");
            else {
              setDeleting(null);
              void api(`resumes/${version.resume_id}/versions`).then(setExtra);
            }
          }}
        />
      )}
      {modal === "history" && (
        <Dialog title="변경 기록" onClose={() => setModal(null)}>
          <p className="muted">
            현재 버전의 최근 100개 기록입니다. 이전 상태 복원은 제공하지
            않습니다.
          </p>
          {extra?.length ? (
            extra.map((h: any) => (
              <div className="version-row" key={h.revision}>
                <strong>
                  #{h.revision} · {h.kind}
                </strong>
                <span>
                  {h.areas.join(", ")}
                  <br />
                  <small>{dateLabel(h.created_at)}</small>
                </span>
              </div>
            ))
          ) : (
            <p>아직 변경 기록이 없습니다.</p>
          )}
        </Dialog>
      )}
      {modal === "import" && (
        <Dialog title="GPT 결과 가져오기" onClose={() => setModal(null)}>
          <p>
            JSON을 붙여넣고 변경 내용을 확인하세요. 삭제는 이 기능으로 실행되지
            않습니다.
          </p>
          <div className="actions">
            <a
              href="/api/v1/import-schema"
              download="resume-import.schema.json"
            >
              JSON Schema 다운로드
            </a>
            <a
              href={`/api/v1/versions/${id}/data`}
              target="_blank"
              rel="noreferrer"
            >
              현재 데이터 / ID 확인
            </a>
          </div>
          <textarea
            className="json-input"
            aria-label="GPT JSON"
            value={importText}
            onChange={(e) => {
              setImportText(e.target.value);
              setPreview(null);
            }}
          />
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                await flush();
                setPreview(
                  await api(`versions/${id}/import/preview`, "POST", {
                    payload: JSON.parse(importText),
                  }),
                );
              })
            }
          >
            변경 미리보기
          </button>
          {preview && (
            <>
              <div className="diff">
                {preview.diff.map((d: any) => (
                  <div key={d.field}>
                    <strong>{d.field}</strong>
                    <div className="diff-columns">
                      <pre>{JSON.stringify(d.before, null, 2)}</pre>
                      <pre>{JSON.stringify(d.after, null, 2)}</pre>
                    </div>
                  </div>
                ))}
              </div>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api(`versions/${id}/import/apply`, "POST", {
                      revision: preview.revision,
                      payload: JSON.parse(importText),
                    });
                    await load();
                    setModal(null);
                  })
                }
              >
                현재 버전에 적용
              </button>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </Dialog>
      )}
      {modal === "publish" && (
        <Dialog title="공개 링크" onClose={() => setModal(null)}>
          <p>
            현재 표시 중인 내용만 공개됩니다. 자동저장으로 공개본이 바뀌지
            않으며, 아래 버튼으로 갱신할 수 있습니다.
          </p>
          <div className="actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await flush();
                  setExtra(
                    await api(`versions/${id}/publication`, "POST", {
                      revision: queue.current!.revision,
                    }),
                  );
                })
              }
            >
              {extra ? "공개본 갱신" : "이 버전 공개"}
            </button>
            {extra && (
              <button
                onClick={() =>
                  run(async () => {
                    await api(`versions/${id}/publication`, "DELETE");
                    setExtra(null);
                  })
                }
              >
                공개 해제
              </button>
            )}
          </div>
          {extra && (
            <p>
              <a href={`/p/${extra.token}`} target="_blank" rel="noreferrer">
                공개 이력서 열기 ↗
              </a>
              <button
                onClick={() =>
                  run(async () => {
                    await navigator.clipboard.writeText(
                      `${location.origin}/p/${extra.token}`,
                    );
                  })
                }
              >
                링크 복사
              </button>
            </p>
          )}
          {error && <p className="error">{error}</p>}
        </Dialog>
      )}
      {modal === "conflict" && (
        <Dialog title="동시 편집 충돌" onClose={() => setModal(null)}>
          <p>서버의 최신본입니다. 내 편집 내용은 현재 화면에 유지됩니다.</p>
          <div className="conflict-preview">
            <ResumeDocument document={extra.document} />
          </div>
          <footer>
            <button
              disabled={busy}
              onClick={() => {
                if (confirm("내 미저장 내용을 버리고 서버본으로 바꿀까요?")) {
                  install(extra);
                  setError("");
                  setModal(null);
                }
              }}
            >
              서버본 사용
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const v = await api(
                    `resumes/${version.resume_id}/versions`,
                    "POST",
                    {
                      kind: "minor",
                      source_id: id,
                      document: queue.current!.document,
                    },
                  );
                  queue.current?.dispose();
                  window.location.assign(`/editor/${v.id}`);
                })
              }
            >
              내 편집본을 새 버전으로 보존
            </button>
          </footer>
          {error && <p className="error">{error}</p>}
        </Dialog>
      )}
    </div>
  );
}
