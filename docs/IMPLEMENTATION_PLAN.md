# MVP 구현 기록

## 기준

2026-09-15 사용자 승인 계획과 README 및 8개 제품 문서를 기준으로 구현한다.
기준 커밋은 `363c0de`, 작업 브랜치는 `feat/mvp-bootstrap`이다.

## 단계별 산출물

| 단계 | 산출물 | 검증 |
|---|---|---|
| Repository bootstrap | CLI 인증, clone, 작업 브랜치 | origin·기준 커밋·상태 확인 |
| Scaffold | pnpm workspace, Next.js, TypeScript, Tailwind | typecheck·lint·production build |
| DB | `supabase/migrations`, private schema, Storage 설정 | PGlite PostgreSQL 엔진 통합 테스트 |
| API/service | `/api/v1`, service와 DB adapter | HTTP 권한 경계·저장 통합 테스트 |
| 홈 | 최근 작업·직무 탭·카드·생성·자유 복제·범위 삭제 | 브라우저 E2E |
| Editor | 10개 섹션·Tiptap·dnd-kit·직접 편집 | 브라우저 입력·정렬·숨김 검증 |
| 저장/버전/history | 직렬 저장 큐·revision·Major/Minor·100개 기록 | 실패·충돌·버전/출처 보존 테스트 |
| GPT import | JSON Schema·대상 검증·diff·명시적 적용 | 알려지지 않은 필드·삭제 차단 |
| Print/PDF | 공통 renderer·A4 CSS·로컬 한글 폰트 | Chromium PDF·이미지 확인 |
| 인증 서버 | Ed25519·브라우저 binding·1시간 idle·revoke | 실제 서명·쿠키·replay 테스트 |
| Authenticator | Tauri Windows·DPAPI·승인·기기 등록 | Rust 검사 및 Windows 설치 검증 |
| 테스트 | Vitest·PGlite·Playwright·Windows CI | `pnpm test`, `pnpm test:e2e`, `cargo test` |
| 배포 준비 | 환경변수 예시·migration·운영 절차 | 운영 프로젝트 연결 후 smoke test |
| 문서 | source of truth 갱신·API·운영 문서 | 구현과 대조 |

## 확정된 범위 해석

- 특별한 Master Resume 개체는 없다. 모든 버전은 자유 복제 가능하다.
- Introduction은 Header에서 분리한 단일 자기소개 섹션이다.
- 공개본은 사용자가 선택한 버전의 공개 시점 스냅샷이다. 편집 초안과 별도로 갱신한다.
- 공통 renderer를 편집의 비활성 상태·공개·PDF에서 재사용한다. 편집 화면은 고정 페이지 캔버스가 아니다.
- Authenticator는 Windows 우선이며 운영 배포에는 HTTPS origin이 필요하다.
- 실제 MCP 서버, write MCP, 휴지통, history 복원, 일괄 JSON 변경, 탭 드래그는 후속 범위다.

## 외부 검증 의존성

Supabase 프로젝트/Storage와 Vercel 프로젝트 연결, 실제 두 Windows 기기의 설치·키 등록·deep link 승인은 별도 실환경 검증이다. 로컬 테스트 통과를 운영 배포나 실기기 검증 완료로 표현하지 않는다.

## 로컬 검증 결과 (2026-09-17)

- `pnpm lint`, workspace typecheck, Next.js production build 통과.
- Vitest 14개 통과: PostgreSQL 데이터/삭제/복제/공개 snapshot, history 100개 제한, 저장 재시도와 충돌, 인증·HTTP 권한 경계, 기기 등록 검증.
- Playwright 4개 통과: 생성 → 편집 → 자동저장 → import → 버전 → PDF, 비인증 화면, rich text·숨김·키보드 정렬, 전체 섹션 다페이지 출력.
- 한글 A4 PDF 1페이지 및 5페이지 fixture를 렌더링해 확인. 한 페이지보다 긴 항목의 불필요한 페이지 이동을 줄였으며 페이지 경계에서 내용이 이어진다.
- Windows `cargo test --locked` 3개 통과: origin 검증, RFC 8032 Ed25519 벡터, DPAPI 암복호화. `cargo clippy --locked -- -D warnings` 통과.
- Tauri debug NSIS 설치 패키지 생성 성공: `apps/authenticator/src-tauri/target/debug/bundle/nsis/Resume Authenticator_0.1.0_x64-setup.exe`. 설치·코드서명·실기기 로그인은 검증하지 않았다. 배포용 release 빌드는 운영 문서의 명령을 따른다.
- 테스트는 가상 데이터와 로컬 PostgreSQL 엔진을 사용했다. 실제 Supabase/Storage 연결, Vercel 배포 및 실기기 간 인증은 아직 수행하지 않았다.

## Supabase 연결 후 확인

- Transaction pooler 연결 성공. 초기 migration을 실제 프로젝트에 적용했다.
- 앱 테이블 14개의 RLS 활성화 및 anon/authenticated 역할의 앱 schema 접근 차단을 확인했다.
- 비공개 `resume-photos` bucket 생성 확인. 임시 DB 쓰기/조회 검증은 rollback하여 데이터를 남기지 않았다.
- 서버용 secret key로 교체 후 실제 Supabase SDK에서 bucket 조회와 임시 PNG 업로드·다운로드 바이트 일치·삭제를 확인했다. 비인증 public URL 접근은 차단되었고 테스트 파일은 제거했다.
- Vercel 배포, 최초 기기 등록 및 실기기 로그인은 아직 진행하지 않았다.

## Vercel 프로젝트 준비

- 사용자 승인으로 기존 Hobby 팀 `projectallblu`에 `personal-resume-management` 프로젝트를 별도로 생성했다.
- Next.js, Node.js 24, root `apps/web`, pnpm install/build 설정 및 Production 환경변수 5개 등록을 완료했다. DB 연결 문자열과 서버 키는 Secret으로 저장했다.
- 전용 도메인은 `personal-resume-management.vercel.app`이다. 기존 프로젝트·도메인·팀 공통 설정은 변경하지 않았다. Hobby 팀 사용량 한도는 공유된다.
- 배포 파일 사전 검사에서 `.env.local`, 키 파일, Windows 빌드 산출물 제외를 확인했다.
- 첫 Production 배포는 자동 승인 검토 거부 후 사용자의 명시적 승인을 받아 완료했다. 운영 주소: `https://personal-resume-management.vercel.app`.
- 실제 배포에서 홈 200, 미인증 관리 조회/쓰기 401, 다른 Origin mutation 403을 확인했다. DB challenge 발급 200, 브라우저 binding cookie의 Secure/HttpOnly/SameSite, 승인 없는 요청의 pending 유지 및 편집 세션 미발급도 확인했다.
- 최초 기기 등록 및 실제 Authenticator 로그인 검증은 아직 남아 있다. 소스 공유용 브랜치는 `feat/mvp-bootstrap`이며 Git 연동 자동 배포는 아직 설정하지 않았다.
