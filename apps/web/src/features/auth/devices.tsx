"use client";
import { useEffect, useState } from "react";
import { Dialog } from "../dialog";
import { api, dateLabel } from "../api";
export function Devices({ onClose }: { onClose: () => void }) {
  const [devices, setDevices] = useState<any[]>([]),
    [proof, setProof] = useState(""),
    [request, setRequest] = useState<any>(null),
    [error, setError] = useState("");
  const load = () =>
    api("auth/devices")
      .then(setDevices)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  return (
    <Dialog title="등록 기기" onClose={onClose}>
      <p className="muted">
        기기 해제 시 해당 기기의 모든 편집 세션도 종료됩니다.
      </p>
      {devices.map((d) => (
        <div className="device-row" key={d.id}>
          <div>
            <strong>{d.name}</strong>
            <p className="small muted">
              {d.fingerprint.slice(0, 16)} · {dateLabel(d.created_at)}
            </p>
          </div>
          {d.revoked_at ? (
            <span>해제됨</span>
          ) : (
            <button
              onClick={async () => {
                if (!confirm(`${d.name} 기기와 편집 세션을 해제할까요?`))
                  return;
                try {
                  await api(`auth/devices/${d.id}`, "DELETE");
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              해제
            </button>
          )}
        </div>
      ))}
      <h3>새 기기 등록</h3>
      <p>
        새 Authenticator에서 만든 등록 JSON을 붙여넣은 뒤 기존 등록 기기에서
        승인하세요.
      </p>
      <textarea
        aria-label="기기 등록 JSON"
        value={proof}
        onChange={(e) => setProof(e.target.value)}
      />
      <button
        onClick={async () => {
          try {
            setRequest(
              await api("auth/challenges", "POST", {
                registration: JSON.parse(proof),
              }),
            );
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        등록 승인 요청
      </button>
      {request && (
        <div className="notice">
          <a href={request.url}>기존 기기의 Authenticator 열기</a>
          <button
            onClick={async () => {
              try {
                const r = await api(
                  `auth/challenges/${request.id}/complete`,
                  "POST",
                );
                if (r.pending) setError("기존 기기에서 먼저 승인하세요.");
                else {
                  setRequest(null);
                  setProof("");
                  setError("");
                  await load();
                }
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            승인 완료 확인
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </Dialog>
  );
}
