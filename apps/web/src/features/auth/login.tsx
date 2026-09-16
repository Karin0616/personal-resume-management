"use client";
import { useState, useEffect, useRef } from "react";
import { KeyRound, ArrowUpRight, Check } from "lucide-react";
import { api } from "../api";
export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [request, setRequest] = useState<{
      id: string;
      url: string;
      expires_at: string;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const success = useRef(onSuccess);
  success.current = onSuccess;
  useEffect(() => {
    if (!request) return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        if (Date.now() > Date.parse(request!.expires_at))
          throw new Error("요청이 만료됐습니다. 다시 인증해 주세요.");
        const r = await api(`auth/challenges/${request!.id}/complete`, "POST");
        if (cancelled) return;
        if (!r.pending) {
          success.current();
          return;
        }
        timer = setTimeout(poll, 2000);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setRequest(null);
        }
      }
    }
    timer = setTimeout(poll, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [request]);
  return (
    <div className="login-card">
      <span className="icon-tile">
        <KeyRound size={24} />
      </span>
      <p className="eyebrow">YOUR PRIVATE WORKSPACE</p>
      <h1>
        다음 기회를 위한
        <br />
        나의 이력서.
      </h1>
      <p className="muted">
        등록한 기기에서 인증하고
        <br />
        마지막으로 작업하던 이력서를 이어가세요.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {request ? (
        <>
          <a className="button primary" href={request.url}>
            Authenticator 열기 <ArrowUpRight size={16} />
          </a>
          <p className="muted small">
            앱에서 사이트를 확인하고 승인해 주세요. <Check size={14} />
          </p>
        </>
      ) : (
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              setRequest(await api("auth/challenges", "POST", {}));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "요청 중…" : "편집 인증 시작"} <ArrowUpRight size={16} />
        </button>
      )}
      <p className="small muted">
        공개 이력서는 공유받은 링크로 바로 열람할 수 있습니다.
      </p>
    </div>
  );
}
