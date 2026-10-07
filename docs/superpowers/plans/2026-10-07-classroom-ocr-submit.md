# 클래스룸 손글씨 제출 앱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 학생이 손글씨 과제를 촬영 → OCR → 직접 수정 → 클래스룸에 제출하고, 교사는 학생×과제 표로 모든 제출물을 보고 CSV로 내려받는 PWA를 만든다.

**Architecture:** 화면은 빌드 단계 없는 정적 PWA(vanilla HTML/CSS/ES modules, GitHub Pages). 로직은 Google Apps Script에 두고, PWA가 Google Identity Services로 받은 학교 계정 토큰으로 Apps Script API `scripts.run`을 호출한다. 그래서 GAS 함수는 **호출한 사용자 본인 권한**으로 Classroom·Drive·Docs를 다룬다. OCR은 Drive의 이미지→Google 문서 변환 기능이다.

**Tech Stack:** HTML/CSS/JS(ES modules), Google Identity Services, Apps Script(V8, 고급 서비스 Classroom v1·Drive v3, DocumentApp), clasp(GAS 배포), node:test(단위 테스트), GitHub Pages.

**Spec:** `C:\claude_code\이것저것\docs\superpowers\specs\2026-10-07-classroom-ocr-submit-design.md`

## Global Constraints

- 비용 0원, 카드 등록 없음. 유료 API·서비스 사용 금지.
- 학교 Google Workspace 내부 앱(OAuth 동의 화면 "내부"). 구글 앱 심사 없음.
- 프로젝트 경로: `C:\claude_code\classroom-ocr` (ASCII 경로. 한글 경로에서 도구가 깨지는 것을 피하기 위함)
- 빌드 단계 없음, 런타임 의존성 없음. 개발 도구는 node(테스트), clasp(GAS 배포), `npx serve`(로컬 서버)만 쓴다.
- OCR은 범용: 양식 인식이나 칸별 처리를 하지 않는다. 오류는 학생이 편집 화면에서 고친다.
- UI: 간결·직관, 카드형·벤토 그리드, 화면당 주요 행동 하나, 한국어, 설명 문구 최소화.
- 사용자가 입력한 문자열(학생 글, 과제 제목, 이름)은 HTML에 넣기 전에 반드시 `esc()`를 거친다.
- 권한 검사는 클래스룸에 맡긴다. GAS 공개 함수는 호출자 권한으로만 실행된다.
- OAuth 범위는 아래 6개이고 `gas/appsscript.json`과 `web/config.js`가 **같아야** 한다(Task 5 테스트가 검사):
  `classroom.courses.readonly`, `classroom.rosters.readonly`, `classroom.coursework.me`, `classroom.coursework.students`, `documents`, `drive.file` (모두 `https://www.googleapis.com/auth/` 접두사)
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## File Structure

```
C:\claude_code\classroom-ocr\
├ .clasp.json              clasp 설정 (scriptId, rootDir: gas)
├ .gitignore
├ gas\
│  ├ appsscript.json       매니페스트: 범위, 고급 서비스, executionApi DOMAIN
│  ├ Api.js                PWA가 부르는 공개 함수 (whoami, listMyAssignments, ocr, submit, createAssignment, getGrid, getText, getTexts, devSmoke)
│  └ Grid.js               buildGrid 순수 함수 (node 테스트 가능)
├ web\                     GitHub Pages 배포 루트
│  ├ package.json          {"type":"module"} — node가 web/*.js를 ESM으로 읽게 함
│  ├ index.html
│  ├ styles.css            토큰, 카드, 벤토, 다크 모드
│  ├ config.js             CLIENT_ID, SCRIPT_ID, SCOPES
│  ├ api.js                getToken (GIS), makeRunner, run
│  ├ lib.js                esc, DONE, stateLabel, summarize, toCsv (순수)
│  ├ ui.js                 render, loading, fail, $
│  ├ app.js                라우터, 로그인, 역할 분기, 서비스 워커 등록
│  ├ student.js            과제 카드 목록, 촬영·편집·제출 화면
│  ├ teacher.js            수업 목록, 벤토 대시보드, 표, 상세, 과제 만들기, CSV
│  ├ manifest.webmanifest
│  ├ sw.js                 네트워크 우선 + 오프라인 껍데기 캐시
│  └ icons\icon-192.png, icon-512.png
├ tools\make-icons.py      아이콘 PNG 생성
└ test\
   ├ grid.test.cjs
   ├ lib.test.mjs
   ├ api.test.mjs
   └ config.test.mjs
```

라우트: `#/` 홈(교사면 수업 목록, 학생이면 과제 카드) · `#/a/{courseId}/{workId}` 학생 편집기 · `#/t/{courseId}` 교사 대시보드.

---

### Task 1: 프로젝트, Google Cloud, GAS 뼈대

**Files:**
- Create: `.gitignore`, `.clasp.json`(clasp가 생성), `gas/appsscript.json`, `gas/Api.js`

**Interfaces:**
- Produces: GAS 함수 `whoami() → {teaching: Course[], learning: Course[]}`, `Course = {id: string, name: string, section: string}`. 내부 헬퍼 `list_(fetchPage: (pageToken?) => object, key: string) → any[]`.
- Produces (설정값, Task 5에서 사용): OAuth 웹 클라이언트 ID, API 실행 파일 배포 ID.

- [ ] **Step 1: 저장소 만들기**

```bash
mkdir -p /c/claude_code/classroom-ocr/gas /c/claude_code/classroom-ocr/web /c/claude_code/classroom-ocr/test /c/claude_code/classroom-ocr/tools
cd /c/claude_code/classroom-ocr && git init
printf 'node_modules/\n.DS_Store\n' > .gitignore
```

- [ ] **Step 2: Google Cloud 설정 (사용자가 학교 계정으로 직접 진행)**

1. https://console.cloud.google.com → 새 프로젝트 `classroom-ocr` → **프로젝트 번호**를 메모
2. "API 및 서비스 → 라이브러리"에서 **Google Classroom API, Google Drive API, Apps Script API** 사용 설정
3. "OAuth 동의 화면" → 사용자 유형 **내부** → 앱 이름 `과제 제출`. 범위는 비워 둬도 됨(토큰 요청 시 지정)
4. "사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션" → 승인된 자바스크립트 원본에 `http://localhost:5173` 추가 → **클라이언트 ID**를 메모
5. https://script.google.com/home/usersettings 에서 "Google Apps Script API"를 **사용**으로 (clasp 사용에 필요)

- [ ] **Step 3: clasp 설치, 로그인, 프로젝트 생성**

```bash
npm install -g @google/clasp
clasp login            # 브라우저가 열림 → 학교 계정으로 로그인 (사용자)
cd /c/claude_code/classroom-ocr && clasp create --type standalone --title "classroom-ocr" --rootDir gas
```
Expected: `.clasp.json`이 생기고 `gas/appsscript.json`이 만들어짐

- [ ] **Step 4: 매니페스트 덮어쓰기** — `gas/appsscript.json`

```json
{
  "timeZone": "Asia/Seoul",
  "runtimeVersion": "V8",
  "exceptionLogging": "STACKDRIVER",
  "dependencies": {
    "enabledAdvancedServices": [
      { "userSymbol": "Classroom", "serviceId": "classroom", "version": "v1" },
      { "userSymbol": "Drive", "serviceId": "drive", "version": "v3" }
    ]
  },
  "executionApi": { "access": "DOMAIN" },
  "oauthScopes": [
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.rosters.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.me",
    "https://www.googleapis.com/auth/classroom.coursework.students",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive.file"
  ]
}
```

- [ ] **Step 5: `whoami` 작성** — `gas/Api.js`

```js
// Public functions are called from the PWA via the Apps Script API (scripts.run)
// and run as the calling user, so Classroom enforces who may see or change what.

function whoami() {
  const pick = c => ({ id: c.id, name: c.name, section: c.section || '' });
  const courses = who => list_(p => Classroom.Courses.list({ [who]: 'me', courseStates: ['ACTIVE'], pageToken: p }), 'courses');
  return { teaching: courses('teacherId').map(pick), learning: courses('studentId').map(pick) };
}

function list_(fetchPage, key) {
  const out = [];
  let token;
  do {
    const res = fetchPage(token);
    (res[key] || []).forEach(x => out.push(x));
    token = res.nextPageToken;
  } while (token);
  return out;
}
```

- [ ] **Step 6: 푸시하고 GCP 프로젝트 연결**

```bash
cd /c/claude_code/classroom-ocr && clasp push --force && clasp open-script
```
열린 편집기에서: 프로젝트 설정(⚙) → "Google Cloud Platform(GCP) 프로젝트" → **프로젝트 번호 변경** → Step 2의 번호 입력. (scripts.run은 OAuth 클라이언트와 스크립트가 같은 GCP 프로젝트일 때만 동작)

- [ ] **Step 7: 편집기에서 실행 확인**

편집기에서 함수 `whoami` 선택 → 실행 → 권한 승인 → 실행 로그에 오류가 없어야 함. 결과를 보려면 임시로 `Logger.log(JSON.stringify(whoami()))`를 실행해 내 수업이 `teaching`에 나오는지 확인한다.

- [ ] **Step 8: API 실행 파일로 배포**

```bash
cd /c/claude_code/classroom-ocr && clasp deploy --description "v1"
```
Expected: `Deployed AKfycb... @1` 출력. 이 **배포 ID**(AKfycb…)를 메모. Task 5의 `SCRIPT_ID`로 쓴다(404가 나면 프로젝트 설정의 스크립트 ID로 바꿔 본다).

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: GAS skeleton with whoami and execution API manifest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: buildGrid (학생×과제 표 데이터)

**Files:**
- Create: `gas/Grid.js`
- Test: `test/grid.test.cjs`

**Interfaces:**
- Consumes: Classroom API 원본 객체 — Student `{userId, profile:{name:{fullName}}}`, CourseWork `{id, title, creationTime, associatedWithDeveloper?}`, StudentSubmission `{userId, courseWorkId, state, late?, updateTime?, assignmentSubmission?:{attachments?:[{driveFile?:{id, alternateLink}}]}}`
- Produces: `buildGrid(students, works, subs) → Grid`
  `Grid = {students: [{id, name}], works: [{id, title, app: boolean, created}], cells: {[studentId]: {[workId]: Cell}}}`
  `Cell = {state: string, late: boolean, updated: string, docId: string|null, link: string}` — `docId`·`link`는 마지막 Drive 첨부파일 기준. 학생은 이름순(ko), 과제는 생성일순.

- [ ] **Step 1: 실패하는 테스트 작성** — `test/grid.test.cjs`

```js
const test = require('node:test');
const assert = require('node:assert');
const { buildGrid } = require('../gas/Grid.js');

test('buildGrid maps submissions into student x work cells', () => {
  const g = buildGrid(
    [
      { userId: 's2', profile: { name: { fullName: '홍길동' } } },
      { userId: 's1', profile: { name: { fullName: '김철수' } } },
    ],
    [
      { id: 'w2', title: 'B', creationTime: '2026-10-02T00:00:00Z', associatedWithDeveloper: true },
      { id: 'w1', title: 'A', creationTime: '2026-10-01T00:00:00Z' },
    ],
    [
      {
        userId: 's1', courseWorkId: 'w2', state: 'TURNED_IN', updateTime: '2026-10-03T00:00:00Z',
        assignmentSubmission: { attachments: [
          { driveFile: { id: 'old', alternateLink: 'O' } },
          { link: { url: 'x' } },
          { driveFile: { id: 'd1', alternateLink: 'L' } },
        ] },
      },
      { userId: 's2', courseWorkId: 'w1', state: 'CREATED' },
    ]
  );
  assert.deepStrictEqual(g.students.map(s => s.name), ['김철수', '홍길동']);
  assert.deepStrictEqual(g.works.map(w => [w.id, w.app]), [['w1', false], ['w2', true]]);
  assert.deepStrictEqual(g.cells.s1.w2, { state: 'TURNED_IN', late: false, updated: '2026-10-03T00:00:00Z', docId: 'd1', link: 'L' });
  assert.deepStrictEqual(g.cells.s2.w1, { state: 'CREATED', late: false, updated: '', docId: null, link: '' });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd /c/claude_code/classroom-ocr && node --test test/`
Expected: FAIL — `Cannot find module '../gas/Grid.js'`

- [ ] **Step 3: 구현** — `gas/Grid.js`

```js
// Pure: turns raw Classroom lists into the teacher's student x assignment grid.
function buildGrid(students, works, subs) {
  const cells = {};
  subs.forEach(s => {
    const files = ((s.assignmentSubmission || {}).attachments || []).filter(a => a.driveFile);
    const last = files[files.length - 1];
    (cells[s.userId] = cells[s.userId] || {})[s.courseWorkId] = {
      state: s.state,
      late: !!s.late,
      updated: s.updateTime || '',
      docId: last ? last.driveFile.id : null,
      link: last ? last.driveFile.alternateLink || '' : '',
    };
  });
  return {
    students: students
      .map(s => ({ id: s.userId, name: s.profile.name.fullName }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    works: works
      .map(w => ({ id: w.id, title: w.title, app: !!w.associatedWithDeveloper, created: w.creationTime }))
      .sort((a, b) => a.created.localeCompare(b.created)),
    cells,
  };
}

if (typeof module !== 'undefined') module.exports = { buildGrid };
```

- [ ] **Step 4: 통과 확인**

Run: `node --test test/`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add gas/Grid.js test/grid.test.cjs && git commit -m "feat: buildGrid for teacher student x assignment view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: GAS 서버 함수 (OCR, 제출, 교사용)

**Files:**
- Modify: `gas/Api.js` (Task 1 내용 아래에 추가)

**Interfaces:**
- Consumes: `list_`(Task 1), `buildGrid`(Task 2)
- Produces (모두 scripts.run으로 호출):
  - `listMyAssignments() → Card[]`, `Card = {courseId, courseName, workId, title, description, state}`. 이 앱이 만든 과제(`associatedWithDeveloper`)만 포함하고, `state`는 제출 상태(제출물이 없으면 `'NEW'`)
  - `ocr(base64: string, mimeType: string) → string`
  - `submit(courseId, workId, title: string, text: string, photos: string[]) → {state: 'TURNED_IN', docId}` — photos는 JPEG base64 배열
  - `createAssignment(courseId, title, description) → workId`
  - `getGrid(courseId) → Grid`
  - `getText(docId) → string|null` (Google 문서가 아니거나 권한이 없으면 null)
  - `getTexts(docIds: (string|null)[]) → (string|null)[]`
  - `devSmoke() → string` (편집기 확인용, 읽기 전용)

- [ ] **Step 1: 함수 추가** — `gas/Api.js` 끝에 덧붙이기

```js
const Subs_ = () => Classroom.Courses.CourseWork.StudentSubmissions;

function listMyAssignments() {
  const courses = list_(p => Classroom.Courses.list({ studentId: 'me', courseStates: ['ACTIVE'], pageToken: p }), 'courses');
  const cards = [];
  courses.forEach(c => {
    const works = list_(p => Classroom.Courses.CourseWork.list(c.id, { courseWorkStates: ['PUBLISHED'], pageToken: p }), 'courseWork')
      .filter(w => w.associatedWithDeveloper);
    if (!works.length) return;
    const mine = {};
    list_(p => Subs_().list(c.id, '-', { userId: 'me', pageToken: p }), 'studentSubmissions')
      .forEach(s => { mine[s.courseWorkId] = s.state; });
    works.forEach(w => cards.push({
      courseId: c.id, courseName: c.name, workId: w.id, title: w.title,
      description: w.description || '', state: mine[w.id] || 'NEW',
    }));
  });
  return cards;
}

// Drive converts an image to a Google Doc with OCR; we read the text and drop the temp doc.
function ocr(base64, mimeType) {
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, 'ocr-temp');
  const file = Drive.Files.create({ name: 'ocr-temp', mimeType: MimeType.GOOGLE_DOCS }, blob, { ocrLanguage: 'ko' });
  try {
    return DocumentApp.openById(file.id).getBody().getText().trim();
  } finally {
    Drive.Files.remove(file.id);
  }
}

function submit(courseId, workId, title, text, photos) {
  const sub = (Subs_().list(courseId, workId, { userId: 'me' }).studentSubmissions || [])[0];
  if (!sub) throw new Error('제출할 과제를 찾을 수 없어요.');
  const doc = DocumentApp.create(title + ' - 제출');
  const body = doc.getBody();
  body.setText(text);
  (photos || []).forEach(b64 => {
    const img = body.appendImage(Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', 'photo.jpg'));
    const w = 450;
    img.setHeight(Math.round(img.getHeight() * w / img.getWidth())).setWidth(w);
  });
  doc.saveAndClose();
  if (sub.state === 'TURNED_IN') Subs_().reclaim({}, courseId, workId, sub.id);
  Subs_().modifyAttachments({ addAttachments: [{ driveFile: { id: doc.getId() } }] }, courseId, workId, sub.id);
  Subs_().turnIn({}, courseId, workId, sub.id);
  return { state: 'TURNED_IN', docId: doc.getId() };
}

// Created here (not in Classroom) so students can attach submissions through this app.
function createAssignment(courseId, title, description) {
  return Classroom.Courses.CourseWork.create(
    { title: title, description: description || '', workType: 'ASSIGNMENT', state: 'PUBLISHED' }, courseId).id;
}

function getGrid(courseId) {
  return buildGrid(
    list_(p => Classroom.Courses.Students.list(courseId, { pageToken: p }), 'students'),
    list_(p => Classroom.Courses.CourseWork.list(courseId, { pageToken: p }), 'courseWork'),
    list_(p => Subs_().list(courseId, '-', { pageToken: p }), 'studentSubmissions'));
}

function getText(docId) {
  try {
    return DocumentApp.openById(docId).getBody().getText();
  } catch (e) {
    return null;
  }
}

function getTexts(docIds) {
  return docIds.map(id => (id ? getText(id) : null));
}

function devSmoke() {
  const me = whoami();
  const out = { teaching: me.teaching.length, learning: me.learning.length };
  if (me.teaching[0]) {
    const g = getGrid(me.teaching[0].id);
    out.grid = { course: me.teaching[0].name, students: g.students.length, works: g.works.length };
  }
  Logger.log(JSON.stringify(out));
  return JSON.stringify(out);
}
```

- [ ] **Step 2: 푸시 후 편집기에서 스모크 실행**

```bash
cd /c/claude_code/classroom-ocr && clasp push --force
```
편집기에서 `devSmoke` 실행 → 권한 재승인(범위가 늘어남) → 로그에 `{"teaching":N,...,"grid":{"course":"...","students":N,"works":N}}`가 나와야 함. 교사 계정에 테스트용 수업(학생 1명 이상)이 없으면 클래스룸에서 하나 만든다.

- [ ] **Step 3: 새 버전 배포 (같은 배포 ID 유지)**

```bash
clasp deploy -i <Task1의 배포 ID> --description "v2 server functions"
```
Expected: 같은 배포 ID로 `@2`

- [ ] **Step 4: Commit**

```bash
git add gas/Api.js && git commit -m "feat: GAS OCR, submit, and teacher grid functions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: lib.js (화면 공용 순수 함수)

**Files:**
- Create: `web/package.json`, `web/lib.js`
- Test: `test/lib.test.mjs`

**Interfaces:**
- Consumes: `Grid`, `Cell` (Task 2)
- Produces:
  - `esc(s) → string` HTML 이스케이프
  - `DONE: Set<string>` = `{'TURNED_IN','RETURNED'}`
  - `stateLabel(cell?: {state}) → '제출'|'반환됨'|'회수함'|'미제출'`
  - `summarize(grid) → {rate: number(0-100), missing: [{name, miss}], recent: [{student, work, updated}] (최대 5개, 최신순)}`
  - `toCsv(grid, texts: {[studentId]: {[workId]: string}}) → string` (UTF-8 BOM, CRLF, 텍스트가 없으면 상태 라벨)

- [ ] **Step 1: ESM 표시**

```bash
cd /c/claude_code/classroom-ocr && printf '{ "type": "module" }\n' > web/package.json
```

- [ ] **Step 2: 실패하는 테스트 작성** — `test/lib.test.mjs`

```js
import test from 'node:test';
import assert from 'node:assert';
import { esc, stateLabel, summarize, toCsv } from '../web/lib.js';

const grid = {
  students: [{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }],
  works: [{ id: 'w1', title: '과제1' }, { id: 'w2', title: '과제 "2"' }],
  cells: {
    s1: { w1: { state: 'TURNED_IN', updated: '2026-10-01' }, w2: { state: 'TURNED_IN', updated: '2026-10-03' } },
    s2: { w1: { state: 'RETURNED', updated: '2026-10-02' }, w2: { state: 'CREATED', updated: '' } },
  },
};

test('esc escapes html', () => {
  assert.strictEqual(esc(`<b a="1">'&`), '&lt;b a=&quot;1&quot;&gt;&#39;&amp;');
  assert.strictEqual(esc(null), '');
});

test('stateLabel', () => {
  assert.strictEqual(stateLabel({ state: 'TURNED_IN' }), '제출');
  assert.strictEqual(stateLabel({ state: 'RETURNED' }), '반환됨');
  assert.strictEqual(stateLabel({ state: 'RECLAIMED_BY_STUDENT' }), '회수함');
  assert.strictEqual(stateLabel(undefined), '미제출');
});

test('summarize computes rate, missing, recent', () => {
  const s = summarize(grid);
  assert.strictEqual(s.rate, 75);
  assert.deepStrictEqual(s.missing, [{ name: 'B', miss: 1 }]);
  assert.deepStrictEqual(s.recent.map(r => r.updated), ['2026-10-03', '2026-10-02', '2026-10-01']);
  assert.strictEqual(summarize({ students: [], works: [], cells: {} }).rate, 0);
});

test('toCsv writes BOM, quotes, and falls back to state label', () => {
  const csv = toCsv(grid, { s1: { w1: '첫 줄\n둘째 "줄"' } });
  assert.ok(csv.startsWith('\uFEFF'));
  const lines = csv.slice(1).split('\r\n');
  assert.strictEqual(lines[0], '"학생","과제1","과제 ""2"""');
  assert.strictEqual(lines[1], '"A","첫 줄\n둘째 ""줄""","제출"');
  assert.strictEqual(lines[2], '"B","반환됨","미제출"');
});
```

- [ ] **Step 3: 실패 확인**

Run: `node --test test/`
Expected: FAIL — `Cannot find module .../web/lib.js`

- [ ] **Step 4: 구현** — `web/lib.js`

```js
const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ENT[c]);

export const DONE = new Set(['TURNED_IN', 'RETURNED']);

const LABEL = { TURNED_IN: '제출', RETURNED: '반환됨', RECLAIMED_BY_STUDENT: '회수함' };
export const stateLabel = cell => LABEL[cell && cell.state] || '미제출';

export function summarize(grid) {
  let done = 0;
  const recent = [];
  const missing = [];
  grid.students.forEach(s => {
    const row = grid.cells[s.id] || {};
    let miss = 0;
    grid.works.forEach(w => {
      const c = row[w.id];
      if (c && DONE.has(c.state)) {
        done++;
        recent.push({ student: s.name, work: w.title, updated: c.updated || '' });
      } else miss++;
    });
    if (miss) missing.push({ name: s.name, miss });
  });
  const total = grid.students.length * grid.works.length;
  missing.sort((a, b) => b.miss - a.miss);
  recent.sort((a, b) => b.updated.localeCompare(a.updated));
  return { rate: total ? Math.round((done / total) * 100) : 0, missing, recent: recent.slice(0, 5) };
}

export function toCsv(grid, texts) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [
    ['학생', ...grid.works.map(w => w.title)],
    ...grid.students.map(s => [
      s.name,
      ...grid.works.map(w => (texts[s.id] || {})[w.id] ?? stateLabel((grid.cells[s.id] || {})[w.id])),
    ]),
  ];
  return '\uFEFF' + rows.map(r => r.map(q).join(',')).join('\r\n');
}
```

- [ ] **Step 5: 통과 확인**

Run: `node --test test/`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/lib.js test/lib.test.mjs && git commit -m "feat: shared UI helpers (esc, summarize, toCsv)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: config.js와 api.js (로그인과 GAS 호출)

**Files:**
- Create: `web/config.js`, `web/api.js`
- Test: `test/api.test.mjs`, `test/config.test.mjs`

**Interfaces:**
- Consumes: Task 1에서 메모한 클라이언트 ID와 배포 ID
- Produces:
  - `config.js`: `CLIENT_ID`, `SCRIPT_ID`, `SCOPES`(공백으로 구분한 문자열)
  - `api.js`: `getToken(force?: boolean) → Promise<string>`, `makeRunner({scriptId, getToken, fetchFn}) → run`, `run(fn: string, ...params) → Promise<any>` (GAS 오류는 `Error(errorMessage)`로 throw, 401이면 토큰을 새로 받아 한 번 재시도)

- [ ] **Step 1: 실패하는 테스트 작성** — `test/api.test.mjs`

```js
import test from 'node:test';
import assert from 'node:assert';
import { makeRunner } from '../web/api.js';

const reply = (status, body) => ({ status, json: async () => body });

test('run posts to scripts.run and returns the result', async () => {
  let seen;
  const run = makeRunner({
    scriptId: 'SID',
    getToken: async () => 'T',
    fetchFn: async (url, opts) => { seen = { url, opts }; return reply(200, { done: true, response: { result: 42 } }); },
  });
  assert.strictEqual(await run('ocr', 'abc', 'image/jpeg'), 42);
  assert.strictEqual(seen.url, 'https://script.googleapis.com/v1/scripts/SID:run');
  assert.strictEqual(seen.opts.headers.Authorization, 'Bearer T');
  assert.deepStrictEqual(JSON.parse(seen.opts.body), { function: 'ocr', parameters: ['abc', 'image/jpeg'] });
});

test('run throws the script error message', async () => {
  const run = makeRunner({
    scriptId: 'SID',
    getToken: async () => 'T',
    fetchFn: async () => reply(200, { done: true, error: { message: 'ScriptError', details: [{ errorMessage: '과제를 찾을 수 없어요.' }] } }),
  });
  await assert.rejects(run('submit'), { message: '과제를 찾을 수 없어요.' });
});

test('run refreshes the token once on 401', async () => {
  const forced = [];
  let calls = 0;
  const run = makeRunner({
    scriptId: 'SID',
    getToken: async force => { forced.push(!!force); return force ? 'NEW' : 'OLD'; },
    fetchFn: async () => (++calls === 1 ? reply(401, {}) : reply(200, { response: { result: 'ok' } })),
  });
  assert.strictEqual(await run('whoami'), 'ok');
  assert.deepStrictEqual(forced, [false, true]);
});
```

`test/config.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { SCOPES } from '../web/config.js';

test('PWA token scopes match the GAS manifest', () => {
  const manifest = JSON.parse(readFileSync(new URL('../gas/appsscript.json', import.meta.url)));
  assert.deepStrictEqual(SCOPES.split(' ').sort(), [...manifest.oauthScopes].sort());
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/`
Expected: FAIL — `Cannot find module .../web/api.js`, `.../web/config.js`

- [ ] **Step 3: 구현** — `web/config.js` (클라이언트 ID와 배포 ID는 Task 1에서 메모한 값으로 바꾼다)

```js
export const CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
export const SCRIPT_ID = 'YOUR_API_EXECUTABLE_DEPLOYMENT_ID';
export const SCOPES = [
  'classroom.courses.readonly',
  'classroom.rosters.readonly',
  'classroom.coursework.me',
  'classroom.coursework.students',
  'documents',
  'drive.file',
].map(s => 'https://www.googleapis.com/auth/' + s).join(' ');
```

`web/api.js`:

```js
import { CLIENT_ID, SCRIPT_ID, SCOPES } from './config.js';

let token = null;
let expires = 0;
let client = null;
let pending = null;

// Google Identity Services token flow. The first call must come from a click (popup).
export function getToken(force = false) {
  if (!force && token && Date.now() < expires) return Promise.resolve(token);
  if (!window.google?.accounts?.oauth2) return Promise.reject(new Error('로그인 준비 중이에요. 잠시 후 다시 눌러 주세요.'));
  client ??= google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: r => {
      if (r.error) return pending.reject(new Error(r.error));
      token = r.access_token;
      expires = Date.now() + (r.expires_in - 60) * 1000;
      pending.resolve(token);
    },
    error_callback: e => pending.reject(new Error(e.type === 'popup_closed' ? '로그인 창이 닫혔어요.' : e.type)),
  });
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    client.requestAccessToken(token ? { prompt: '' } : {});
  });
}

export function makeRunner({ scriptId, getToken, fetchFn = (...a) => fetch(...a) }) {
  const url = `https://script.googleapis.com/v1/scripts/${scriptId}:run`;
  const call = async (body, force) => fetchFn(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getToken(force)}`, 'Content-Type': 'application/json' },
    body,
  });
  return async function run(fn, ...parameters) {
    const body = JSON.stringify({ function: fn, parameters });
    let res = await call(body, false);
    if (res.status === 401) res = await call(body, true);
    const data = await res.json();
    if (data.error) {
      const d = (data.error.details || [])[0];
      throw new Error((d && d.errorMessage) || data.error.message);
    }
    return data.response && data.response.result;
  };
}

export const run = makeRunner({ scriptId: SCRIPT_ID, getToken });
```

- [ ] **Step 4: 통과 확인**

Run: `node --test test/`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add web/config.js web/api.js test/api.test.mjs test/config.test.mjs && git commit -m "feat: GIS token flow and scripts.run client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 웹 셸, 로그인, PWA

**Files:**
- Create: `web/index.html`, `web/styles.css`, `web/ui.js`, `web/app.js`, `web/manifest.webmanifest`, `web/sw.js`, `tools/make-icons.py`, `web/icons/icon-192.png`, `web/icons/icon-512.png`
- Create (임시, Task 7·8에서 교체): `web/student.js`, `web/teacher.js`

**Interfaces:**
- Consumes: `run`, `getToken`(Task 5), `esc`(Task 4), GAS `whoami`
- Produces:
  - `ui.js`: `render(html)`, `loading()`, `fail(err)`, `$(selector) → Element|null`
  - `app.js` 라우팅 계약: `studentHome()`, `studentEditor(courseId, workId)`(student.js), `teacherHome(me)`, `teacherCourse(courseId, me)`(teacher.js). 모두 async 가능하고, throw하면 app.js가 `fail()`로 보여 준다.

- [ ] **Step 1: `web/index.html`**

```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#f6f6f3">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <title>과제 제출</title>
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="icon" href="icons/icon-192.png">
  <link rel="apple-touch-icon" href="icons/icon-192.png">
  <link rel="stylesheet" href="styles.css">
  <script src="https://accounts.google.com/gsi/client" async></script>
  <script type="module" src="app.js"></script>
</head>
<body><main id="app"></main></body>
</html>
```

- [ ] **Step 2: `web/styles.css`**

```css
:root {
  --bg: #f6f6f3; --card: #fff; --ink: #1d1d1f; --muted: #6e6e73; --line: #e6e6e1;
  --accent: #1f6f5c; --accent-ink: #fff; --ok: #1f6f5c; --no: #c9c9c4; --danger: #c43c3c;
  --radius: 20px; color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111312; --card: #1c1f1e; --ink: #f2f2ef; --muted: #9a9e9c; --line: #2c302e;
    --accent: #5cc3a6; --accent-ink: #0b1a15; --ok: #5cc3a6; --no: #3a3e3c;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink);
  font: 16px/1.5 system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
#app { max-width: 1100px; margin: 0 auto;
  padding: max(16px, env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom)); }
h1 { font-size: 22px; margin: 0; }
h2 { font-size: 16px; margin: 0 0 8px; }
.card { display: block; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 18px; color: inherit; text-decoration: none; }
.muted { color: var(--muted); }
.bar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.bar h1 { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.back { font-size: 28px; line-height: 1; color: var(--ink); text-decoration: none; padding: 0 6px; }
button { font: inherit; border: 1px solid var(--line); background: var(--card); color: var(--ink);
  border-radius: 12px; padding: 10px 14px; cursor: pointer; }
button.primary { background: var(--accent); color: var(--accent-ink); border: 0; font-weight: 600; }
button.wide { width: 100%; padding: 16px; margin-top: 12px; border-radius: 16px; }
button:disabled { opacity: .5; cursor: default; }
input[type=text], textarea { font: inherit; color: inherit; background: var(--card); border: 1px solid var(--line);
  border-radius: 12px; padding: 12px; width: 100%; }
.cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
.task h2 { margin: 10px 0 6px; }
.task.done { opacity: .6; }
.chip { display: inline-block; font-size: 12px; color: var(--muted); background: var(--bg); border-radius: 999px; padding: 2px 10px; }
.state { font-size: 14px; color: var(--accent); }
.capture { text-align: center; cursor: pointer; margin-bottom: 12px; }
.capture img { display: block; max-width: 100%; max-height: 40vh; border-radius: 12px; margin: 0 auto 8px; }
.editor { min-height: 45vh; resize: vertical; border-radius: var(--radius); padding: 18px; }
.bento { display: grid; gap: 12px; grid-template-columns: repeat(3, 1fr); }
.bento .wide { grid-column: 1 / -1; }
@media (max-width: 760px) { .bento { grid-template-columns: 1fr; } }
.stat strong { display: block; font-size: 44px; line-height: 1.1; margin-top: 6px; }
.bento ul { list-style: none; margin: 0; padding: 0; }
.bento li { display: flex; justify-content: space-between; gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--line); }
.bento li:last-child { border: 0; }
.grid-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { padding: 6px 8px; border-bottom: 1px solid var(--line); text-align: center; white-space: nowrap; }
th:first-child, td:first-child { text-align: left; position: sticky; left: 0; background: var(--card); }
.tag { display: block; font-size: 11px; color: var(--muted); font-weight: 400; }
.cell { border: 0; background: none; padding: 2px 8px; font-size: 18px; }
.cell.ok { color: var(--ok); }
.cell.no { color: var(--no); }
dialog { border: 0; border-radius: var(--radius); background: var(--card); color: var(--ink); width: min(680px, 92vw); padding: 20px; }
dialog::backdrop { background: rgb(0 0 0 / .35); }
dialog pre { white-space: pre-wrap; font: inherit; max-height: 60vh; overflow: auto; }
dialog form { display: grid; gap: 10px; }
.center { min-height: 80vh; display: grid; place-items: center; }
.hero { text-align: center; padding: 36px; max-width: 360px; width: 100%; }
.hero button { margin-top: 16px; width: 100%; }
.loading { padding: 40px; text-align: center; color: var(--muted); }
.error { border-color: var(--danger); }
```

- [ ] **Step 3: `web/ui.js`**

```js
import { esc } from './lib.js';

const root = () => document.getElementById('app');
export const render = html => { root().innerHTML = html; };
export const $ = sel => root().querySelector(sel);
export const loading = () => render('<div class="loading">불러오는 중…</div>');
export const fail = e => render(`<section class="center"><div class="card hero error">
  <p>${esc(e.message)}</p><button onclick="location.reload()">다시 시도</button></div></section>`);
```

- [ ] **Step 4: `web/app.js`**

```js
import { run, getToken } from './api.js';
import { render, $, fail } from './ui.js';
import { studentHome, studentEditor } from './student.js';
import { teacherHome, teacherCourse } from './teacher.js';

let me = null;

function login() {
  render(`<section class="center"><div class="card hero">
    <h1>과제 제출</h1><p class="muted">학교 구글 계정으로 시작해요</p>
    <button id="login" class="primary">로그인</button></div></section>`);
  $('#login').onclick = async () => {
    try {
      await getToken();
      me = await run('whoami');
      route();
    } catch (e) { fail(e); }
  };
}

async function route() {
  if (!me) return login();
  const [, view, a, b] = location.hash.split('/');
  try {
    if (view === 'a') return await studentEditor(a, b);
    if (view === 't') return await teacherCourse(a, me);
    return me.teaching.length ? teacherHome(me) : await studentHome();
  } catch (e) { fail(e); }
}

addEventListener('hashchange', route);
route();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
```

- [ ] **Step 5: 임시 화면 모듈** (Task 7·8에서 통째로 교체)

`web/student.js`:
```js
import { render } from './ui.js';
export async function studentHome() { render('<p class="card">학생 화면 (Task 7)</p>'); }
export async function studentEditor() { render('<p class="card">편집기 (Task 7)</p>'); }
```
`web/teacher.js`:
```js
import { render } from './ui.js';
import { esc } from './lib.js';
export function teacherHome(me) { render(`<p class="card">교사: ${esc(me.teaching.map(c => c.name).join(', '))} (Task 8)</p>`); }
export async function teacherCourse() { render('<p class="card">대시보드 (Task 8)</p>'); }
```

- [ ] **Step 6: PWA 매니페스트와 서비스 워커**

`web/manifest.webmanifest`:
```json
{
  "name": "과제 제출",
  "short_name": "과제",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#f6f6f3",
  "theme_color": "#f6f6f3",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

`web/sw.js`:
```js
// Network-first so updates show immediately; cached shell keeps the app opening offline.
const CACHE = 'shell-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'ui.js', 'api.js', 'lib.js', 'config.js',
  'student.js', 'teacher.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));

self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request)
    .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request)));
});
```

- [ ] **Step 7: 아이콘 생성** — `tools/make-icons.py`

```python
# Draws the app icon (paper sheet with text lines on accent green) as PNGs.
from pathlib import Path
from PIL import Image, ImageDraw

out = Path(__file__).resolve().parent.parent / "web" / "icons"
out.mkdir(parents=True, exist_ok=True)
for size in (192, 512):
    s = size / 512
    img = Image.new("RGB", (size, size), "#1f6f5c")
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([136 * s, 104 * s, 376 * s, 408 * s], radius=28 * s, fill="#ffffff")
    for i, w in enumerate((176, 176, 120)):
        y = (176 + i * 56) * s
        d.rounded_rectangle([176 * s, y, (176 + w) * s, y + 18 * s], radius=9 * s, fill="#1f6f5c")
    img.save(out / f"icon-{size}.png")
print("ok")
```

Run: `cd /c/claude_code/classroom-ocr && python tools/make-icons.py`
Expected: `ok`, 그리고 `web/icons/icon-192.png`, `icon-512.png` 생성

- [ ] **Step 8: 로컬 실행으로 로그인 확인**

`web/config.js`에 실제 클라이언트 ID와 배포 ID가 들어 있는지 확인한 뒤 실행:
```bash
cd /c/claude_code/classroom-ocr && npx --yes serve web -l 5173
```
브라우저로 `http://localhost:5173` → 로그인 → 학교 계정으로 권한 승인 → 교사 계정이면 "교사: (내 수업 이름) (Task 8)"이 보여야 함. 콘솔 오류가 없어야 하고, DevTools → Application → Manifest에 설치 가능 표시가 떠야 함.
404가 나면 `SCRIPT_ID`를 스크립트 ID(프로젝트 설정)로 바꿔 다시 시도. 403 `PERMISSION_DENIED`이면 Task 1 Step 6의 GCP 프로젝트 연결을 확인.

- [ ] **Step 9: 단위 테스트 회귀 확인 후 Commit**

Run: `node --test test/` → PASS (9 tests)
```bash
git add web tools && git commit -m "feat: PWA shell with Google sign-in and role routing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 학생 화면 (과제 카드, 촬영·OCR·편집·제출)

**Files:**
- Modify (전체 교체): `web/student.js`

**Interfaces:**
- Consumes: `run`(Task 5), `render`, `loading`, `$`(Task 6), `esc`, `stateLabel`, `DONE`(Task 4), GAS `listMyAssignments`, `ocr`, `submit`(Task 3)
- Produces: `studentHome()`, `studentEditor(courseId, workId)`

- [ ] **Step 1: `web/student.js` 작성**

```js
import { run } from './api.js';
import { render, loading, $ } from './ui.js';
import { esc, stateLabel, DONE } from './lib.js';

let cards = [];

const loadDraft = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const saveDraft = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const clearDraft = k => { try { localStorage.removeItem(k); } catch {} };

export async function studentHome() {
  loading();
  cards = await run('listMyAssignments');
  if (!cards.length) {
    return render('<section class="center"><div class="card hero"><p class="muted">아직 받은 과제가 없어요.</p></div></section>');
  }
  render(`<header class="bar"><h1>내 과제</h1></header>
    <section class="cards">${cards.map(c => `
      <a class="card task ${DONE.has(c.state) ? 'done' : ''}" href="#/a/${c.courseId}/${c.workId}">
        <span class="chip">${esc(c.courseName)}</span>
        <h2>${esc(c.title)}</h2>
        <span class="state">${stateLabel(c)}</span>
      </a>`).join('')}
    </section>`);
}

// Shrinks the photo so the upload stays small; 2000px matched the OCR test images.
async function resizeImage(file, max = 2000) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k);
  cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const url = cv.toDataURL('image/jpeg', 0.85);
  return { url, base64: url.split(',')[1] };
}

export async function studentEditor(courseId, workId) {
  if (!cards.length) { loading(); cards = await run('listMyAssignments'); }
  const c = cards.find(x => x.courseId === courseId && x.workId === workId);
  if (!c) throw new Error('과제를 찾을 수 없어요.');
  const key = `draft:${courseId}:${workId}`;
  const photos = [];

  render(`<header class="bar"><a href="#/" class="back" aria-label="뒤로">‹</a><h1>${esc(c.title)}</h1></header>
    ${c.description ? `<p class="card muted">${esc(c.description)}</p>` : ''}
    <label class="card capture">
      <input type="file" accept="image/*" capture="environment" id="photo" hidden>
      <img id="preview" alt="촬영한 사진" hidden>
      <span id="capLabel">📷 손글씨 촬영</span>
    </label>
    <textarea id="text" class="editor" placeholder="직접 입력하거나 촬영하세요" aria-label="제출할 내용">${esc(loadDraft(key))}</textarea>
    <button id="submit" class="primary wide">${DONE.has(c.state) ? '다시 제출' : '제출'}</button>`);

  const text = $('#text');
  text.oninput = () => saveDraft(key, text.value);

  $('#photo').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    const label = $('#capLabel');
    const { url, base64 } = await resizeImage(file);
    $('#preview').src = url;
    $('#preview').hidden = false;
    label.textContent = '글자 읽는 중…';
    try {
      const t = await run('ocr', base64, 'image/jpeg');
      photos.push(base64);
      text.value = text.value.trim() ? `${text.value}\n\n${t}` : t;
      saveDraft(key, text.value);
      label.textContent = '📷 한 장 더 촬영';
    } catch {
      label.textContent = '읽지 못했어요. 다시 촬영하거나 직접 입력하세요';
    }
    e.target.value = '';
  };

  $('#submit').onclick = async () => {
    const body = text.value.trim();
    if (!body) return text.focus();
    const btn = $('#submit');
    btn.disabled = true;
    btn.textContent = '제출 중…';
    try {
      await run('submit', courseId, workId, c.title, body, photos);
      clearDraft(key);
      location.hash = '#/';
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '제출';
      alert(err.message);
    }
  };
}
```

- [ ] **Step 2: 테스트용 과제 준비**

학생 화면에는 이 앱이 만든 과제만 보이므로, 아직 교사 화면(Task 8)이 없는 지금은 GAS 편집기에서 한 번 실행한다: 편집기에 임시 함수 `function tmp(){ Logger.log(createAssignment('<테스트 수업 ID>', 'OCR 테스트', '손글씨로 작성')); }`를 추가해 실행하고, 확인 후 지운다(커밋하지 않음). 수업 ID는 `devSmoke`/`whoami` 로그에서 확인.

- [ ] **Step 3: 학생 계정으로 확인**

`npx --yes serve web -l 5173` → **학생 테스트 계정**으로 로그인(같은 학교 도메인이고 테스트 수업에 학생으로 참여 중). 체크리스트:
- "OCR 테스트" 카드가 보인다
- 카드를 누르고 → 손글씨 사진(테스트한 `1.jpg` 등)을 고르면 → 미리보기와 "글자 읽는 중…" 뒤에 텍스트가 채워진다
- 새로고침해도 글이 남아 있다(임시 저장)
- 텍스트를 고치고 제출 → 목록으로 돌아가고 카드가 "제출"로 바뀐다
- 클래스룸 웹에서 해당 과제에 "OCR 테스트 - 제출" 문서가 첨부돼 있고, 문서 안에 텍스트와 사진이 있다

- [ ] **Step 4: Commit**

```bash
git add web/student.js && git commit -m "feat: student cards, photo OCR editor, and submission

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 교사 화면 (수업 목록, 벤토 대시보드, 표, 상세, 과제 만들기, CSV)

**Files:**
- Modify (전체 교체): `web/teacher.js`

**Interfaces:**
- Consumes: `run`, `render`, `loading`, `$`, `esc`, `stateLabel`, `DONE`, `summarize`, `toCsv`, GAS `getGrid`, `getText`, `getTexts`, `createAssignment`, `me.teaching: Course[]`
- Produces: `teacherHome(me)`, `teacherCourse(courseId, me)`

- [ ] **Step 1: `web/teacher.js` 작성**

```js
import { run } from './api.js';
import { render, loading, $ } from './ui.js';
import { esc, stateLabel, DONE, summarize, toCsv } from './lib.js';

export function teacherHome(me) {
  render(`<header class="bar"><h1>내 수업</h1></header>
    <section class="cards">${me.teaching.map(c => `
      <a class="card task" href="#/t/${c.id}">
        ${c.section ? `<span class="chip">${esc(c.section)}</span>` : ''}
        <h2>${esc(c.name)}</h2>
      </a>`).join('')}
    </section>`);
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const cellOf = (grid, sid, wid) => (grid.cells[sid] || {})[wid];

export async function teacherCourse(courseId, me) {
  loading();
  const course = me.teaching.find(c => c.id === courseId);
  if (!course) throw new Error('수업을 찾을 수 없어요.');
  const grid = await run('getGrid', courseId);
  const sum = summarize(grid);
  const li = (a, b) => `<li><span>${esc(a)}</span><span class="muted">${esc(b)}</span></li>`;

  render(`<header class="bar"><a href="#/" class="back" aria-label="뒤로">‹</a>
      <h1>${esc(course.name)}</h1><button id="new" class="primary">+ 과제</button></header>
    <section class="bento">
      <div class="card stat"><span class="muted">제출률</span><strong>${sum.rate}%</strong></div>
      <div class="card"><h2>미제출</h2><ul>${sum.missing.slice(0, 5).map(m => li(m.name, `${m.miss}건`)).join('') || '<li class="muted">없음</li>'}</ul></div>
      <div class="card"><h2>최근 제출</h2><ul>${sum.recent.map(r => li(r.student, r.work)).join('') || '<li class="muted">없음</li>'}</ul></div>
      <div class="card wide">
        <div class="grid-head"><h2>학생별 과제</h2><button id="csv">CSV 내려받기</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>학생</th>${grid.works.map(w => `<th>${esc(w.title)}${w.app ? '' : '<span class="tag">클래스룸</span>'}</th>`).join('')}</tr></thead>
          <tbody>${grid.students.map(s => `<tr><td>${esc(s.name)}</td>${grid.works.map(w => {
            const c = cellOf(grid, s.id, w.id);
            const ok = c && DONE.has(c.state);
            return `<td><button class="cell ${ok ? 'ok' : 'no'}" data-s="${s.id}" data-w="${w.id}" ${c && c.docId ? '' : 'disabled'}
              aria-label="${esc(`${s.name} ${w.title} ${stateLabel(c)}`)}">${ok ? '●' : '○'}</button></td>`;
          }).join('')}</tr>`).join('')}</tbody>
        </table></div>
      </div>
    </section>
    <dialog id="detail"></dialog>
    <dialog id="newDlg"><form id="newForm">
      <h2>새 과제</h2>
      <input type="text" name="title" placeholder="제목" required>
      <textarea name="description" rows="4" placeholder="안내 (선택)"></textarea>
      <button class="primary">만들기</button>
      <button type="button" id="cancel">취소</button>
    </form></dialog>`);

  $('table').onclick = async e => {
    const b = e.target.closest('button.cell');
    if (!b || b.disabled) return;
    const s = grid.students.find(x => x.id === b.dataset.s);
    const w = grid.works.find(x => x.id === b.dataset.w);
    const c = cellOf(grid, s.id, w.id);
    const dlg = $('#detail');
    dlg.innerHTML = '<p class="muted">불러오는 중…</p>';
    dlg.showModal();
    const text = await run('getText', c.docId).catch(() => null);
    dlg.innerHTML = `<h2>${esc(s.name)} · ${esc(w.title)}</h2>
      ${text != null ? `<pre>${esc(text)}</pre>` : ''}
      <p><a href="${esc(c.link)}" target="_blank" rel="noopener">원본 열기</a></p>
      <form method="dialog"><button>닫기</button></form>`;
  };

  $('#csv').onclick = async () => {
    const btn = $('#csv');
    btn.disabled = true;
    btn.textContent = '내려받는 중…';
    try {
      const texts = {};
      // One call per assignment column keeps each GAS run well under its time limit.
      for (const w of grid.works) {
        const got = await run('getTexts', grid.students.map(s => (cellOf(grid, s.id, w.id) || {}).docId || null));
        grid.students.forEach((s, i) => { if (got[i] != null) (texts[s.id] ??= {})[w.id] = got[i]; });
      }
      download(`${course.name}.csv`, toCsv(grid, texts));
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'CSV 내려받기';
    }
  };

  $('#new').onclick = () => $('#newDlg').showModal();
  $('#cancel').onclick = () => $('#newDlg').close();
  $('#newForm').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    e.target.querySelector('.primary').disabled = true;
    try {
      await run('createAssignment', courseId, f.get('title').trim(), f.get('description').trim());
      $('#newDlg').close();
      await teacherCourse(courseId, me);
    } catch (err) {
      e.target.querySelector('.primary').disabled = false;
      alert(err.message);
    }
  };
}
```

- [ ] **Step 2: 교사 계정으로 확인**

`npx --yes serve web -l 5173` → 교사 계정으로 로그인. 체크리스트:
- 수업 카드 → 대시보드: 제출률, 미제출, 최근 제출 카드와 학생×과제 표가 보인다
- Task 7에서 제출한 칸이 ●이고, 누르면 학생 글이 뜬다
- 클래스룸에서 직접 만든 과제 열에 "클래스룸" 표시가 붙는다
- "+ 과제"로 과제를 만들면 표에 새 열이 생기고, 학생 화면에도 카드가 생긴다
- "CSV 내려받기" → 엑셀로 열었을 때 한글이 깨지지 않고, 학생 행 × 과제 열에 글 또는 상태가 들어 있다
- 휴대폰 폭(DevTools 375px)에서 벤토가 한 줄로 쌓이고, 표는 가로 스크롤된다

- [ ] **Step 3: Commit**

```bash
git add web/teacher.js && git commit -m "feat: teacher bento dashboard, grid, detail, new assignment, CSV

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: GitHub Pages 배포와 실기기 확인

**Files:**
- Create: `.github/workflows/pages.yml`

**Interfaces:**
- Consumes: `web/` 전체
- Produces: 공개 URL `https://<github-id>.github.io/classroom-ocr/`

- [ ] **Step 1: Pages 워크플로** — `.github/workflows/pages.yml`

```yaml
name: pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: github-pages
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: web
      - uses: actions/deploy-pages@v4
```

- [ ] **Step 2: GitHub 저장소에 푸시 (사용자 확인 후)**

사용자가 GitHub에서 빈 저장소 `classroom-ocr`(공개)를 만들고 주소를 알려 준다. 그다음:
```bash
cd /c/claude_code/classroom-ocr && git branch -M main && git remote add origin https://github.com/<github-id>/classroom-ocr.git && git add .github && git commit -m "ci: deploy web/ to GitHub Pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push -u origin main
```
저장소 Settings → Pages → Source를 **GitHub Actions**로 설정. Actions 탭에서 배포가 성공해야 함.

- [ ] **Step 3: OAuth 원본 추가**

Google Cloud → 사용자 인증 정보 → OAuth 클라이언트 → 승인된 자바스크립트 원본에 `https://<github-id>.github.io` 추가(경로 없이).

- [ ] **Step 4: 실기기 확인**

- **안드로이드 크롬(학생)**: URL 접속 → 로그인 → 메뉴 → "홈 화면에 추가" → 아이콘으로 실행하면 주소창 없이 열린다 → 실제 손글씨를 촬영해 OCR → 제출
- **아이폰 사파리(학생)**: 공유 → "홈 화면에 추가" → 실행 → 로그인 팝업이 정상적으로 돌아오는지 확인. 설치형에서 로그인이 막히면 사파리 탭에서 쓰는 것으로 안내한다(알려진 iOS 제약)
- **PC 크롬·엣지(교사)**: 주소창의 "설치" → 독립 창으로 열린다 → 표에 방금 제출한 내용이 보인다 → CSV 내려받기
- 어디에서도 Apps Script 경고 띠가 나오지 않는다

- [ ] **Step 5: 확인 결과 기록 후 Commit**

문제가 있으면 고치고 다시 확인한다. 마지막에 `node --test test/` → PASS(9 tests).
