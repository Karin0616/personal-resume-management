"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  ArrowUpRight,
  FileText,
  Clock3,
  Trash2,
  Pencil,
  ShieldCheck,
} from "lucide-react";
import { api, versionName, dateLabel, ApiError } from "./api";
import { Login } from "./auth/login";
import { Dialog } from "./dialog";
import { DeleteDialog } from "./delete-dialog";
import { Devices } from "./auth/devices";
import { useSessionActivity } from "./auth/use-session-activity";
export function Home() {
  const router = useRouter();
  const [data, setData] = useState<any>(null),
    [locked, setLocked] = useState(false),
    [tab, setTab] = useState(""),
    [error, setError] = useState(""),
    [modal, setModal] = useState<"purpose" | "resume" | "devices" | null>(null),
    [deletion, setDeletion] = useState<{
      scope: "purposes" | "resumes";
      id: string;
    } | null>(null),
    [busy, setBusy] = useState(false);
  useSessionActivity(!!data && !locked);
  async function load() {
    try {
      const d = await api("home");
      setData(d);
      setLocked(false);
      const v = d.versions.find((v: any) => v.id === d.recent_version_id);
      const recent = d.resumes.find((r: any) => r.id === v?.resume_id);
      setTab((t) =>
        d.purposes.some((p: any) => p.id === t)
          ? t
          : (recent?.purpose_id ?? d.purposes[0]?.id ?? ""),
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setLocked(true);
      else setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  if (locked) return <Login onSuccess={load} />;
  if (!data)
    return (
      <div className="empty">
        {error || "작업 공간을 불러오는 중…"}
        {error && <button onClick={load}>다시 시도</button>}
      </div>
    );
  const recent = data.versions.find(
      (v: any) => v.id === data.recent_version_id,
    ),
    recentResume = data.resumes.find((r: any) => r.id === recent?.resume_id),
    purpose = data.purposes.find((p: any) => p.id === tab);
  return (
    <main className="workspace">
      <div className="page-heading">
        <div>
          <p className="eyebrow">MY RESUMES</p>
          <h1>나의 이력서</h1>
          <p className="muted">
            경험을 정리하고, 다음 기회에 맞게 다듬어 보세요.
          </p>
        </div>
        <div className="actions">
          <button onClick={() => setModal("devices")}>
            <ShieldCheck size={16} /> 등록 기기
          </button>
          <button
            className="primary"
            disabled={!tab}
            onClick={() => setModal("resume")}
          >
            <Plus size={17} /> 새 이력서
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {recent && recentResume && (
        <button
          className="recent-card"
          onClick={() => router.push(`/editor/${recent.id}`)}
        >
          <div>
            <p className="eyebrow">
              <Clock3 size={14} /> 최근 작업 이어하기
            </p>
            <h2>{recentResume.title}</h2>
            <p>
              {
                data.purposes.find((p: any) => p.id === recentResume.purpose_id)
                  ?.name
              }{" "}
              {recentResume.company && ` / ${recentResume.company}`}
            </p>
            <span className="small">
              {versionName(recent)} · {dateLabel(recent.updated_at)}
            </span>
          </div>
          <ArrowUpRight size={30} />
        </button>
      )}
      <div className="tabs" role="tablist" aria-label="직무 및 용도">
        {data.purposes.map((p: any) => (
          <button
            role="tab"
            aria-selected={p.id === tab}
            className={p.id === tab ? "active" : ""}
            key={p.id}
            onClick={() => setTab(p.id)}
          >
            {p.name}
          </button>
        ))}
        <button onClick={() => setModal("purpose")}>
          <Plus size={16} /> 새 직무/용도
        </button>
      </div>
      <div className="list-heading">
        <h2>{purpose?.name ?? "첫 직무/용도를 만들어 보세요"}</h2>
        {purpose && (
          <div className="actions">
            <button
              className="quiet"
              onClick={async () => {
                const name = prompt("직무/용도 이름", purpose.name);
                if (name)
                  try {
                    await api(`purposes/${tab}`, "PATCH", { name });
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  }
              }}
            >
              <Pencil size={14} /> 이름 변경
            </button>
            <button
              className="quiet"
              onClick={() => setDeletion({ scope: "purposes", id: tab })}
            >
              <Trash2 size={14} /> 용도 삭제
            </button>
          </div>
        )}
      </div>
      <div className="card-grid">
        {data.resumes
          .filter((r: any) => r.purpose_id === tab)
          .map((r: any) => {
            const versions = data.versions.filter(
                (v: any) => v.resume_id === r.id,
              ),
              v = versions[0];
            return (
              <article className="resume-card" key={r.id}>
                <button
                  className="card-main"
                  onClick={async () => {
                    if (v) router.push(`/editor/${v.id}`);
                    else
                      try {
                        const n = await api(
                          `resumes/${r.id}/versions`,
                          "POST",
                          { kind: "minor" },
                        );
                        router.push(`/editor/${n.id}`);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                  }}
                >
                  <div className="paper-thumb">
                    <FileText size={32} />
                    <span>{v ? versionName(v) : "새 버전 만들기"}</span>
                  </div>
                  <h3>{r.title}</h3>
                  <p className="muted">{r.company || "공통 이력서"}</p>
                  {v?.label && <span className="badge">{v.label}</span>}
                  <p className="small muted">
                    {versions.length}개 버전 · {dateLabel(r.updated_at)}
                  </p>
                </button>
                <div className="card-footer">
                  <span className="small">
                    {v ? "이어서 편집" : "빈 이력서"}
                  </span>
                  <div className="actions">
                    <button
                      aria-label={`${r.title} 이름 변경`}
                      className="icon-button"
                      onClick={async () => {
                        const title = prompt("이력서 이름", r.title);
                        if (!title) return;
                        const company = prompt(
                          "회사/지원처 (선택)",
                          r.company ?? "",
                        );
                        if (company === null) return;
                        try {
                          await api(`resumes/${r.id}`, "PATCH", {
                            title,
                            company: company || null,
                          });
                          await load();
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      aria-label={`${r.title} 삭제`}
                      className="icon-button"
                      onClick={() =>
                        setDeletion({ scope: "resumes", id: r.id })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        {tab && (
          <button className="new-card" onClick={() => setModal("resume")}>
            <Plus size={25} />
            <strong>새 이력서</strong>
            <span className="muted small">빈 문서 또는 기존 버전에서 시작</span>
          </button>
        )}
      </div>
      {(modal === "purpose" || modal === "resume") && (
        <Dialog
          title={modal === "purpose" ? "새 직무/용도" : "새 이력서"}
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = new FormData(e.currentTarget);
              try {
                if (modal === "purpose") {
                  const p = await api("purposes", "POST", {
                    name: f.get("name"),
                  });
                  setTab(p.id);
                  setModal(null);
                  await load();
                } else {
                  const source = f.get("source");
                  const result = await api("resumes", "POST", {
                    purpose_id: tab,
                    title: f.get("name"),
                    company: f.get("company") || null,
                    ...(source ? { source_id: source } : {}),
                  });
                  router.push(`/editor/${result.version.id}`);
                }
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {modal === "purpose" ? "직무/용도 이름" : "이력서 이름"}
              <input
                name="name"
                required
                maxLength={200}
                placeholder={
                  modal === "purpose" ? "예: 서비스 기획" : "예: 공통본"
                }
                autoFocus
              />
            </label>
            {modal === "resume" && (
              <>
                <label>
                  회사/지원처 <span className="muted">선택</span>
                  <input name="company" maxLength={200} />
                </label>
                <label>
                  시작할 버전
                  <select name="source">
                    <option value="">빈 이력서</option>
                    {data.versions.map((v: any) => {
                      const r = data.resumes.find(
                        (r: any) => r.id === v.resume_id,
                      );
                      return (
                        <option key={v.id} value={v.id}>
                          {
                            data.purposes.find(
                              (p: any) => p.id === r?.purpose_id,
                            )?.name
                          }{" "}
                          / {r?.title} / {versionName(v)} {v.label}
                        </option>
                      );
                    })}
                  </select>
                </label>
              </>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <footer>
              <button type="button" onClick={() => setModal(null)}>
                취소
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "생성 중…" : "만들기"}
              </button>
            </footer>
          </form>
        </Dialog>
      )}
      {modal === "devices" && <Devices onClose={() => setModal(null)} />}
      {deletion && (
        <DeleteDialog
          {...deletion}
          onClose={() => setDeletion(null)}
          onDeleted={() => {
            setDeletion(null);
            void load();
          }}
        />
      )}
    </main>
  );
}
