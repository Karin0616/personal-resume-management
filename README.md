# personal-resume-management

개인 경력 데이터를 한 곳에서 관리하고, 지원처별로 이력서를 재구성해 A4 PDF로 출력할 수 있는 개인용 Resume Builder입니다.

웹 이력서는 누구나 열람할 수 있고, 편집은 등록된 개인 기기에서 Challenge-Response 인증을 거친 경우에만 허용하는 방향으로 설계합니다.

## 현재 확정된 방향

- 1차 목표: **채용 제출용 PDF 이력서 작성·편집·관리**
- 배포: **Vercel**
- GitHub: 소스 코드·문서·버전 관리의 기준점
- 데이터: 여러 기기에서 동일 데이터를 사용하기 위해 **클라우드 저장 필요**
- 인증: **별도 로컬 Authenticator + 공개키 기반 Challenge-Response**
- 편집 세션: 마지막 활동 기준 **1시간**
- 저장소: public repository
- 보안: 개인정보·private key·token·secret을 저장소에 커밋하지 않음

## MVP

- 섹션별 직접 편집
- 항목 추가·삭제
- 항목 순서 변경
- 항목 표시·숨김
- 지원처별 구성 및 강조 순서 변경
- 여러 기기에서 같은 데이터 사용
- A4 PDF 출력

## 문서

- [제품 명세](docs/PRODUCT_SPEC.md)
- [이력서 정보 구조](docs/RESUME_STRUCTURE.md)
- [디자인·PDF 출력 기준](docs/DESIGN_PRINT_SPEC.md)
- [인증·보안 명세](docs/AUTH_SECURITY_SPEC.md)
- [기술 구조](docs/ARCHITECTURE.md)
- [문서 작성 규칙](docs/DOCUMENTATION_RULES.md)

## 문서 상태 표기

- **확정**: 대화나 구현 결과로 이미 정한 내용
- **방향**: 큰 방향은 정했지만 세부 구현은 남은 내용
- **TBD**: 아직 결정하지 않은 내용

## Repository policy

이 저장소는 공개 저장소입니다. 실제 이력서 원문의 전화번호·이메일 등 개인정보와 private key, API key, token, session secret 등 민감정보를 직접 저장하지 않습니다.

새로운 결정이 생기면 코드와 관련 문서를 함께 갱신합니다.
