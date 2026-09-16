# Resume API v1

기본 경로 `/api/v1`. 공개 조회와 challenge 요청을 제외한 관리 API는 편집 세션이 필요하다.
웹 UI는 DB/Storage 클라이언트를 사용하지 않고 API만 호출한다. service는 PostgreSQL adapter를 주입받으며 향후 MCP도 같은 검증과 저장 동작을 재사용한다.

## 요청 규칙

- 브라우저 mutation: `Origin: APP_ORIGIN`, `X-Resume-CSRF: 1`, 동일 출처 쿠키.
- JSON 요청은 1MB까지. 사진은 JPEG/PNG/WebP, 4MB까지이며 파일 signature도 검사한다. multipart 요청 크기에 여유를 두기 위한 기본값이다.
- 인증 오류 401, 출처 오류 403, 없음 404, 충돌 409, 입력 오류 422, 요청 제한 429.
- 응답 오류는 `{code, message, fields?}`. DB 쿼리·개인정보·서명·쿠키는 로그에 기록하지 않는다.
- 관리 API 응답과 공개 사진은 `Cache-Control: no-store`.

## 주요 경로

| 경로 | 동작 |
|---|---|
| `GET /home` | purposes, resumes, versions, recent_version_id |
| `GET/POST /purposes`, `PATCH /purposes/:id` | 직무 목록·생성·이름 변경 |
| `GET/POST /resumes`, `PATCH /resumes/:id` | 이력서 목록·생성·이름/회사 변경 |
| `GET/POST /resumes/:id/versions` | 버전 목록·생성 |
| `GET/PATCH /versions/:id` | 문서·메타 조회, label 변경 |
| `GET/PUT /versions/:id/data` | 구조화 데이터 조회·저장 |
| `GET /versions/:id/history` | 최근 100개 변경 요약 |
| `POST /versions/:id/activity` | 최근 작업 갱신 |
| `GET /:scope/:id/delete-summary` | 삭제 범위와 fingerprint |
| `DELETE /:scope/:id` | 확인된 직무/이력서/버전 삭제 |
| `POST /versions/:id/import/preview` | 검증된 필드별 diff·revision |
| `POST /versions/:id/import/apply` | 현재 버전에 적용 |
| `GET /import-schema` | 가져오기 JSON Schema |
| `GET/POST/DELETE /versions/:id/publication` | 공개 상태·스냅샷 갱신·해제 |
| `GET /public/:token` | 공개용 Resume Data만 반환 |
| `POST /assets`, `GET /assets/:id` | 인증된 사진 업로드·열람 |
| `GET /public/:token/assets/:id` | 해당 공개본이 참조하는 사진만 열람 |

새 이력서: `{purpose_id,title,company?,source_id?}`. 회사는 null 허용.
새 버전: `{kind:'major'|'minor',source_id?,document?}`. `document`는 충돌 시 내 편집본 보존용이다.
저장: `{revision,document}` → `{revision,document}`. 원자적으로 저장·revision 증가·history 추가. 같은 문서 재시도는 no-op.
삭제: `{confirmation,fingerprint}`. scope는 purposes/resumes/versions. 대량 삭제 confirmation은 정확히 `삭제`. 범위가 달라지면 409.
공개: `{revision}` → `{token}`. 수정 중 내용이 아니라 확인한 revision만 공개한다.
GPT preview: `{payload}`. apply: `{revision,payload}`. ID·순서·visibility·사진 참조·항목 삭제는 가져오기에서 변경하지 않는다.

## 데이터/버전

`packages/resume-schema/src/index.ts`가 검증과 JSON Schema의 기준이다. ordered sections/items와 안정 ID, visible을 저장한다. 모든 필드는 섹션별 허용 목록을 따른다. rich text는 지원 Tiptap node/mark만 허용하고 HTML 문자열을 실행하지 않는다.

새 이력서는 v1.0. 같은 이력서에서는 마지막 발급 번호를 잠금 안에서 증가시킨다. 삭제한 번호는 재사용하지 않는다. 최신 카드와 최근 편집 버전은 별개다. 복제 출처의 FK가 삭제돼도 이름·버전 스냅샷은 남는다.

## 인증 protocol

1. `POST /auth/challenges` → `{id,url,expires_at}`와 5분 browser binding cookie.
2. 앱이 `GET /auth/challenges/:id`로 서명할 원문과 origin·목적을 확인.
3. 사용자가 승인하면 앱이 `POST /auth/challenges/:id/approve`에 `{public_key,signature}`를 전송. 표준 Base64를 사용한다.
4. 원래 브라우저가 `POST /auth/challenges/:id/complete`. 승인 전에는 `{pending:true}`, 승인 후에는 HttpOnly 편집 cookie 발급. token을 JSON으로 반환하지 않는다.

서명 UTF-8 원문은 다음 각 줄을 LF로 연결하며 마지막 LF는 없다.

```text
resume-auth:v1
login
https://example.test
request UUID
32-byte nonce as hex
expires_at ISO 8601
```

새 기기 등록은 purpose `register`와 마지막 줄에 등록 JSON의 SHA-256 digest를 추가한다. canonical 필드 순서는 name, public_key, origin, nonce, expires_at, signature. 기존 기기의 승인 서명과 새 기기의 proof of possession을 모두 확인한다.

`POST /auth/session/activity`는 실제 사용자 활동이 있을 때만 요청한다. `POST /auth/logout`, `GET /auth/devices`, `DELETE /auth/devices/:id`를 제공한다.
