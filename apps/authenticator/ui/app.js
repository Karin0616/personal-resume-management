/* global window, document */
const invoke = window.__TAURI__.core.invoke;
const el = (id) => document.getElementById(id);
let pending = null;
async function run(fn) {
  el("message").textContent = "";
  try {
    await fn();
  } catch (e) {
    el("message").textContent = String(e);
  }
}
async function refresh() {
  const s = await invoke("status");
  el("origin").value = s.origin;
  el("name").value = s.name;
  el("status").textContent = `Public key: ${s.public_key}`;
}
el("setup").onclick = () =>
  run(async () => {
    await invoke("setup", {
      origin: el("origin").value.trim(),
      name: el("name").value.trim(),
    });
    await refresh();
  });
el("registration").onclick = () =>
  run(async () => {
    el("proof").value = await invoke("registration");
    el("proof").select();
    el("message").textContent =
      "10분 안에 등록 JSON을 관리자 CLI 또는 기존 인증된 웹 화면에 전달하세요.";
  });
async function inspect(request) {
  pending = null;
  el("approve").disabled = true;
  const c = await invoke("inspect", { request });
  pending = c;
  el("details").textContent =
    `사이트: ${c.origin}\n목적: ${c.purpose === "login" ? "편집 로그인" : "새 기기 등록"}\n만료: ${c.expires_at}${c.registration ? "\n새 기기: " + c.registration.name + "\nPublic key: " + c.registration.public_key : ""}`;
  el("approve").disabled = false;
}
el("inspect").onclick = () => run(() => inspect(el("request").value.trim()));
el("approve").onclick = () =>
  run(async () => {
    if (!pending) return;
    el("approve").disabled = true;
    await invoke("approve", { id: pending.id });
    pending = null;
    el("details").textContent = "승인 완료. 브라우저로 돌아가세요.";
  });
el("reject").onclick = () =>
  run(async () => {
    await invoke("reject");
    pending = null;
    el("approve").disabled = true;
    el("details").textContent = "요청을 거절했습니다.";
  });
function links(urls) {
  if (urls[0]) {
    el("request").value = urls[0];
    void run(() => inspect(urls[0]));
  }
}
void run(async () => {
  await refresh();
});
void window.__TAURI__.event.listen("auth-links", (event) =>
  links(event.payload),
);
void invoke("initial_links").then(links);
