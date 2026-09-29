# 다른 PC에서 작업 이어가기

이 문서는 `feat/mvp-bootstrap` 브랜치의 구현 상태를 다른 데스크톱과 새 Codex 대화로 전달하기 위한 인수인계 기록이다.

## 시작 명령

```powershell
git clone --branch feat/mvp-bootstrap https://github.com/Karin0616/personal-resume-management.git
Set-Location personal-resume-management
pnpm install --frozen-lockfile
Copy-Item .env.example apps/web/.env.local
```

새 PC에서 개발하려면 `apps/web/.env.local`에 별도로 Supabase 연결값을 넣는다. 이 파일, `.local/`, `.vercel/`, Tauri의 DPAPI 키와 설치 산출물은 Git으로 동기화하지 않는다. 기존 PC의 DPAPI 키를 복사하지 말고, 각 PC에서 별도 키를 만든다.

## 구현 및 운영 상태

- 기준 브랜치: `feat/mvp-bootstrap`.
- MVP 웹, shared schema, Supabase migration, API/service 계층, Tauri Windows Authenticator, 테스트와 CI를 구현했다.
- Supabase 운영 프로젝트에는 `resume` schema의 14개 테이블, RLS, private `resume-photos` Storage bucket을 적용했다.
- Vercel의 `projectallblu` Hobby 팀에 `personal-resume-management` 프로젝트를 별도로 만들었다. 기존 Vercel 프로젝트의 환경변수·도메인·설정은 변경하지 않았다. Hobby 사용량 한도만 팀 전체에서 공유한다.
- 운영 주소: `https://personal-resume-management.vercel.app`.
- Vercel Production 환경변수는 이 프로젝트에만 등록했다. `DATABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`는 Secret이며 저장소나 이 문서에 넣지 않는다.
- 첫 Production 배포가 완료됐다. 운영 smoke test에서 홈 200, 미인증 관리 API 읽기/쓰기 401, 다른 Origin mutation 403, browser binding cookie 보안 속성, 승인 전 편집 세션 미발급을 확인했다.
- 최신 로컬 검증 결과는 `docs/IMPLEMENTATION_PLAN.md`에 있다. 과거 로컬 검증에서는 lint, typecheck, build, Vitest 14개, Playwright 4개, Rust test 3개, clippy가 통과했다.

## 현재 blocker: 최초 Authenticator 기기 등록

운영 DB의 active device 수는 0이다. 즉 실패한 등록 시도는 기기를 남기지 않았다.

1. Windows Authenticator에서 운영 주소와 기기 이름을 설정하고 등록 JSON을 생성했다.
2. JSON의 구조, 운영 origin, 만료 시각은 올바른 상태였다.
3. 그러나 Node.js의 Ed25519 검증으로 `public_key`와 `signature`의 조합을 확인했을 때 서명이 일치하지 않았다.
4. `scripts/register-device.ts`도 같은 이유로 `등록 증명 또는 만료 시각이 올바르지 않습니다.`를 반환했다.

다음 작업자는 `apps/authenticator/src-tauri/src/main.rs`의 `registration()`과 `apps/authenticator/src-tauri/src/key_store.rs`를 우선 점검해야 한다. Rust가 생성한 registration payload 서명을 Rust와 Node 양쪽에서 같은 fixture로 교차 검증하는 테스트를 추가한 뒤, 새 Authenticator 설치 파일을 빌드한다. 기존의 DPAPI 키를 임의로 삭제하거나 복사하지 않는다. 새 키가 필요하면 사용자에게 그 영향과 절차를 설명하고 명시적으로 요청한다.

## 안전한 재개 순서

1. `README.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/OPERATIONS.md`, 이 문서를 읽는다.
2. `.env.local`의 값은 출력하지 말고, 필요한 경우 presence/format만 확인한다.
3. Authenticator registration signature mismatch를 재현하는 Rust/Node 교차 테스트부터 고친다.
4. Authenticator를 다시 빌드하고, 사용자 PC에서 새 proof를 만든다.
5. proof 유효 시간 10분 안에 운영 DB에 최초 public key를 등록한다.
6. 운영 사이트에서 challenge → 승인 → browser complete → 편집 세션 발급을 확인한다.
7. 이후에만 실제 이력서 생성·편집·사진·공개·PDF 흐름을 운영 환경에서 smoke test한다.

## 새 Codex 대화에 붙여넣을 프롬프트

```text
Karin0616/personal-resume-management의 feat/mvp-bootstrap 브랜치에서 작업을 이어가 주세요.

먼저 README.md, docs/IMPLEMENTATION_PLAN.md, docs/OPERATIONS.md, docs/HANDOFF.md를 모두 읽고 현재 구현과 Git 상태를 확인하세요. 문서의 확정 제품 결정을 임의로 바꾸지 마세요.

운영 Supabase migration/private Storage와 Vercel Production 배포는 이미 완료됐습니다. 비밀값은 저장소·출력·채팅에 넣지 마세요. 운영 주소는 https://personal-resume-management.vercel.app 입니다.

현재 최우선 blocker는 Windows Tauri Authenticator 최초 기기 등록입니다. 생성된 등록 JSON의 Ed25519 signature가 public_key와 맞지 않아 scripts/register-device.ts에서 거절됐고, 운영 DB에 등록된 활성 기기는 없습니다.

apps/authenticator/src-tauri/src/main.rs와 key_store.rs를 조사해 Rust와 Node 사이 registration signature 교차 검증 테스트를 추가하고 문제를 수정하세요. 기존 DPAPI 키를 임의로 삭제·복사하지 말고, 새 키가 필요하다면 사용자에게 설명 후 요청하세요. 수정 후 lint/typecheck/test/build 및 Rust test/clippy를 실행하고, 새 설치 파일과 안전한 등록 절차를 제시하세요.
```
