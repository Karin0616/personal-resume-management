"use client";
import { useEffect, useState } from "react";
import { Dialog } from "./dialog";
import { api } from "./api";
export function DeleteDialog({
  scope,
  id,
  onClose,
  onDeleted,
}: {
  scope: "purposes" | "resumes" | "versions";
  id: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [summary, setSummary] = useState<any>(null),
    [word, setWord] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api(`${scope}/${id}/delete-summary`)
      .then(setSummary)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, [scope, id]);
  return (
    <Dialog title="삭제 범위 확인" onClose={onClose}>
      {summary && (
        <>
          <p>
            <strong>{summary.name}</strong>을 삭제합니다.
          </p>
          <p>
            이력서 {summary.resumes}개 · 버전 {summary.versions}개와 해당
            history 및 공개 링크가 제거됩니다. 복제해 둔 다른 이력서는
            유지됩니다.
          </p>
          <p className="muted">삭제 후 복구할 수 없습니다.</p>
          {scope !== "versions" && (
            <label>
              계속하려면 <strong>삭제</strong>를 입력하세요.
              <input
                autoFocus
                value={word}
                onChange={(e) => setWord(e.target.value)}
              />
            </label>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <footer>
        <button onClick={onClose}>취소</button>
        <button
          className="danger"
          disabled={
            !summary || busy || (scope !== "versions" && word !== "삭제")
          }
          onClick={async () => {
            setBusy(true);
            try {
              await api(`${scope}/${id}`, "DELETE", {
                confirmation: word,
                fingerprint: summary.fingerprint,
              });
              onDeleted();
            } catch (e) {
              setError((e as Error).message);
              setWord("");
              await load();
            } finally {
              setBusy(false);
            }
          }}
        >
          삭제 실행
        </button>
      </footer>
    </Dialog>
  );
}
