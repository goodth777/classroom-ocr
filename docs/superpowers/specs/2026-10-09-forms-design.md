# 설문 · 퀴즈 · 회신 설계

작성: 2026-10-09 · 상태: 승인됨(채팅·시안) · 관련: `2026-10-09-homeroom-seating-design.md`

## 1. 목표와 원칙

- 수업 클래스에 **설문 / 퀴즈 / 회신**을 넣는다. 만들 때 종류부터 고른다. 화면 구성은 구글 설문(제목 카드 + 문항 카드)을 따른다.
- **속도와 가벼움이 최우선.**
  - 설문 코드(교사 만들기·통계, 학생 답하기)는 화면을 열 때만 불러온다(`import()`).
  - 학생 `me`에는 설문 **목록만**, 문항은 열 때 한 번 받아 기기에 보관한다.
  - 교사 `view`에는 넣지 않는다. 설문 탭은 자체 경로로 받아 기기에 보관한 것부터 그린다.
  - 학생 제출은 기존 "보내는 중" 대기열(outbox)로 즉시 "제출됨", 서버는 뒤에서.
  - 교사 만들기는 기기 즉시 저장 + 2초 뒤 서버(좌석 배치와 같은 방식).
  - 새 라이브러리 없음. 그래프는 CSS 막대.
- 새 CSS 클래스는 모두 `sv-` 접두어(이름 충돌 재발 방지).

## 2. 종류와 문항

- 종류: `survey`(설문), `quiz`(퀴즈), `reply`(회신).
- 문항 종류(설문·퀴즈): `mc` 객관식, `cb` 체크박스, `short` 단답형, `long` 장문형, `scale` 척도(1~5, 양 끝 이름표). 퀴즈에서 `scale`은 채점하지 않는다.
- 문항 공통: 제목, 필수 여부. 선택지(mc·cb). 퀴즈: `answer`(mc: 선택지 번호, cb: 번호 목록, short: 정답 문자열 목록), `points`(기본 1).
- 회신: 버튼 종류 `ok`(확인했어요) / `yn`(예·아니요) / `custom`(교사가 쓴 선택지). 내부적으로 객관식 문항 하나로 저장한다.

## 3. 설정

- 대상: 클래스 전체 / 일부 학생(과제와 같은 고르기 창).
- 마감: 날짜·시간(선택). 지나면 받지 않는다.
- 설문만: **익명으로 받기**. 교사 화면에 누가 냈는지 나오지 않는다(낸 수만).
- 퀴즈만: **결과 공개** `now`(제출 즉시 점수+정답, 기본) / `after`(마감 후) / `score`(점수만) / `none`(안 보여 줌).
- 상태: `draft`(초안, 학생에게 안 보임) → `live`(보냄) → `closed`(마감). "학생에게 보내기" 때 🔔 알림·푸시(새 과제와 같은 종류 설정 `ann`).

## 4. 채점 (서버, `gas/Core.js`)

- 정답은 학생 기기로 보내지 않는다. 서버가 채점해 결과만 돌려준다.
- mc: 정답 번호와 같으면 배점. cb: 고른 번호 집합이 정답 집합과 정확히 같을 때만. short: 소문자로 바꾸고 모든 공백과 앞뒤 구두점을 지운 값이 정답 목록 중 하나와 같으면. long: 교사가 준 점수(없으면 채점 대기). scale: 채점 안 함.
- `grade(questions, answers, manual) → { score, max, pending, per: { [qid]: { got, max, ok } } }`. `ok`는 true/false, 장문 미채점은 null.

## 5. 학생

- 홈 "진행 중"/"완료"에 과제와 함께 카드로 나온다(왼쪽 색·꼬리표: 설문 초록, 퀴즈 노랑, 회신 파랑). 임박 알림에도 포함.
- `#/f/{formId}`: 한 화면에 문항 카드, 위쪽 진행 막대, 쓰던 답 자동 보관(`fdraft:{id}`), 익명 안내. 필수 문항이 비면 그 문항으로 이동·표시.
- 제출 → outbox → 즉시 "제출됨". 설문·회신은 마감 전까지 다시 낼 수 있다(덮어쓰기). 퀴즈는 한 번.
- 퀴즈 결과는 공개 설정에 따라: 점수, 문항별 ✓/✗, 정답. 전송 전까지는 "채점 중…".

## 6. 교사

- 수업 클래스 탭: 과제 현황 · **설문** · 학생 명단 · 메시지. `#/t/{cls}/forms`, 하나 열면 `#/t/{cls}/forms/{formId}`(질문), `.../{formId}/a`(응답).
- 목록: 종류, 제목, 마감·익명 등 요약, 낸 학생 수 막대, 상태. "＋ 새로 만들기" → 종류 카드 3개.
- 만들기: 제목 카드, 문항 카드(종류 메뉴, 선택지 추가·삭제, 필수, 복사, 삭제, 위·아래 이동), 퀴즈는 정답·배점, 오른쪽 "문항 추가". 위쪽 설정 줄: 대상, 마감, 익명/결과 공개, 자동 저장 표시, "학생에게 보내기"(보낸 뒤에는 "지금 마감"). 응답이 있는 문항을 지우거나 선택지를 바꾸면 확인 창.
- 응답: 낸 수/대상 수, 안 낸 학생(익명이면 숫자만), "안 낸 학생에게 알림"(푸시), **요약**(mc·cb 막대와 %, scale 분포·평균, 글 답 목록과 같은 답 묶기, 퀴즈 평균·점수 분포·문항별 정답률) / **학생별**(답 카드, 이전·다음, 장문 채점 저장). CSV(학생 × 문항, 퀴즈 점수).
- 통계는 받은 응답으로 교사 기기에서 계산(`web/formlogic.js`, 테스트).

## 7. 데이터

| 시트 | 칸 |
|---|---|
| `Forms` | id, classId, kind, title, desc, due, studentIds, questions(JSON), settings(JSON), status, created, updated, sent |
| `Responses` | id, formId, studentId(익명이면 빈칸), voter(익명 중복 방지용 해시), answers(JSON), score, manual(JSON), submitted |

- settings: `{ anon, reveal, reply }`. due: `YYYY-MM-DDTHH:mm`(한국 시각) 또는 빈칸.

### 서버 경로

- 교사: `forms {classId}` → 설문 목록(문항 포함, 응답 수) · `formPut {form}`(더 새 `updated`만) · `formSend {id}` · `formClose {id}` · `formDel {id}`(응답도 삭제) · `responses {formId}` · `grade {responseId, manual}` · `formNudge {id}`(안 낸 학생 푸시).
- 학생: `me`에 `forms` 목록 `{id, kind, title, due, status, n, anon, done, submitted, result?}` · `form {id}` → 정답 뺀 문항 + 내 답 + 공개 가능한 결과 · `answer {formId, answers}` → `{submitted, result?}`.
- 쓰기마다 `bump_(classId)`로 결과 캐시를 갱신한다.

## 8. 파일

- `gas/Core.js` 채점(`normShort`, `grade`) + `test/core.test.cjs`
- `gas/Forms.js` 새로: 경로, 학생 목록 계산, 익명 voter
- `gas/Db.js` 헤더·스키마, `gas/Api.js` 경로 등록·`me`에 forms
- `web/formlogic.js`(통계, 순수) + `test/form.test.mjs`
- `web/forms.js`(교사: 목록·종류·만들기·응답, 지연 로드), `web/sform.js`(학생: 답하기·결과, 지연 로드)
- `web/outbox.js`: 항목에 `action`/`payload`를 허용(과제 외 제출도 같은 대기열)
- `web/teacher.js`(탭·경로), `web/student.js`(홈 카드), `web/app.js`(`#/f/` 경로), `web/styles.css`(`sv-`), `web/sw.js`

## 9. 하지 않는 것

사진 답하기, 드롭다운·날짜 문항, 문항 섹션/분기, 퀴즈 시간 제한, 담임 클래스 설문(나중에).
