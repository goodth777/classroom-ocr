# 담임 클래스 + 좌석 배치 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 교사 화면에 담임/수업 클래스 구분을 넣고, 담임 클래스에 기기 안에서 즉시 동작하는 좌석 배치(구성 → 배치, 고정, 떨어뜨리기, 저장/불러오기, 전체 화면 공개, A4 가로 인쇄)를 만든다.

**Architecture:** 좌석 계산은 순수 모듈(`web/seatlogic.js`)이 맡고 node 테스트로 검증한다. 화면(`web/seats.js`)은 기기 저장본으로 즉시 그리고, 서버(`gas/Seats.js`)에는 2초 디바운스로 뒤에서 보낸다. 공개 연출(`web/seatshow.js`)은 이미 계산된 결과만 보여 준다.

**Tech Stack:** 바닐라 ES 모듈 PWA(GitHub Pages), Google Apps Script + Sheets, Pointer Events, Web Animations API, Web Audio, Fullscreen API, CSS `@page` named page. 테스트는 `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-09-homeroom-seating-design.md`

## Global Constraints

- 좌석 배치의 어떤 동작도 서버 응답을 기다리지 않는다(저장·불러오기 포함). 서버 호출은 `quiet()`로 뒤에서.
- 화면 문구에서 "반" 대신 "클래스".
- 새 CSS 클래스는 `seat-` 접두어(기존 `.sec`, `.center` 충돌 사례).
- 무료·카드 없음 유지, 새 라이브러리 추가 없음.
- 칸번호 = 행 × cols + 열, 0행 = 앞줄(교탁 쪽).
- 각 웹 배포마다 `web/sw.js`의 `CACHE` 버전을 올리고 새 파일을 `SHELL`에 넣는다.

---

### Task 1: 좌석 계산 모듈

**Files:**
- Create: `web/seatlogic.js`
- Test: `test/seat.test.mjs`

**Interfaces:**
- Produces:
  - `blankLayout(rows=5, cols=6) → Layout` — `{rows, cols, desks: bool[], pairs: false, assign: {}, fixed: [], apart: [], top: '', bottom: '', base: ''}` (모든 칸 책상)
  - `neighbours(L, i) → number[]` — 상하좌우 책상 칸, 짝 통로(c%2===1과 c+1 사이) 제외
  - `toggleDesk(L, i) → Layout` — 책상↔빈칸, 꺼지면 그 칸 배정·고정 제거
  - `resize(L, rows, cols) → Layout` — (행,열) 위치 유지, 새 칸은 책상, 밖으로 나간 배정·고정 제거
  - `unplaced(L, studentIds) → string[]`
  - `arrange(L, studentIds, base, rand=Math.random) → {assign, same, apartFail, unseated}`

- [ ] **Step 1: Write the failing tests** (`test/seat.test.mjs`)

```js
import test from 'node:test';
import assert from 'node:assert';
import { blankLayout, neighbours, toggleDesk, resize, unplaced, arrange } from '../web/seatlogic.js';

const seeded = seed => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const ids = n => Array.from({ length: n }, (_, i) => 's' + i);

test('neighbours: up/down/left/right desks only, aisle splits pairs', () => {
  const L = blankLayout(2, 4);
  assert.deepStrictEqual(neighbours(L, 1).sort(), [0, 2, 5]);
  L.pairs = true; // columns (0,1) | (2,3)
  assert.deepStrictEqual(neighbours(L, 1).sort(), [0, 5]);
  assert.deepStrictEqual(neighbours(L, 2).sort(), [3, 6]);
  L.desks[0] = false;
  assert.deepStrictEqual(neighbours(L, 1), [5]);
});

test('toggleDesk off drops the seat assignment and pin', () => {
  let L = blankLayout(1, 3);
  L.assign = { 1: 's1' }; L.fixed = [1];
  L = toggleDesk(L, 1);
  assert.strictEqual(L.desks[1], false);
  assert.deepStrictEqual(L.assign, {});
  assert.deepStrictEqual(L.fixed, []);
  assert.strictEqual(toggleDesk(L, 1).desks[1], true);
});

test('resize keeps (row, col) positions and drops what falls outside', () => {
  let L = blankLayout(2, 3);
  L.assign = { 0: 'a', 5: 'b' }; L.desks[4] = false;
  L = resize(L, 2, 2);
  assert.deepStrictEqual(L.assign, { 0: 'a' });
  assert.deepStrictEqual(L.desks, [true, true, true, false]);
  L = resize(L, 3, 2);
  assert.strictEqual(L.desks.length, 6);
  assert.strictEqual(L.desks[5], true);
});

test('unplaced lists students without a seat', () => {
  const L = blankLayout(1, 2); L.assign = { 0: 's0' };
  assert.deepStrictEqual(unplaced(L, ids(3)), ['s1', 's2']);
});

test('arrange keeps pinned seats and seats everyone when desks suffice', () => {
  const L = blankLayout(4, 5); L.assign = { 0: 's0', 7: 's7' }; L.fixed = [0];
  const r = arrange(L, ids(18), {}, seeded(1));
  assert.strictEqual(r.assign[0], 's0');
  assert.strictEqual(Object.keys(r.assign).length, 18);
  assert.strictEqual(new Set(Object.values(r.assign)).size, 18);
  assert.deepStrictEqual(r.unseated, []);
});

test('arrange avoids the same seat as the base layout', () => {
  const L = blankLayout(5, 6);
  const base = {}; ids(30).forEach((s, i) => { base[i] = s; });
  for (let k = 1; k <= 20; k++) {
    const r = arrange(L, ids(30), base, seeded(k));
    assert.strictEqual(r.same, 0);
    Object.entries(r.assign).forEach(([i, s]) => assert.notStrictEqual(base[i], s));
  }
});

test('arrange keeps apart pairs off neighbouring desks', () => {
  const L = blankLayout(5, 6); L.apart = [['s0', 's1'], ['s2', 's3'], ['s4', 's5']];
  for (let k = 1; k <= 20; k++) {
    const r = arrange(L, ids(28), {}, seeded(k));
    assert.strictEqual(r.apartFail, 0);
    const at = Object.fromEntries(Object.entries(r.assign).map(([i, s]) => [s, +i]));
    L.apart.forEach(([a, b]) => assert.ok(!neighbours(L, at[a]).includes(at[b])));
  }
});

test('arrange reports students who cannot sit', () => {
  const L = blankLayout(2, 2);
  const r = arrange(L, ids(6), {}, seeded(3));
  assert.strictEqual(Object.keys(r.assign).length, 4);
  assert.strictEqual(r.unseated.length, 2);
});

test('arrange relaxes same-seat when it cannot be avoided', () => {
  const L = blankLayout(1, 2); L.assign = { 1: 's1' }; L.fixed = [1];
  const r = arrange(L, ['s0', 's1'], { 0: 's0', 1: 's1' }, seeded(2));
  assert.strictEqual(r.assign[0], 's0');
  assert.strictEqual(r.same, 1);
});
```

- [ ] **Step 2: Run to verify failure** — `node --test` → FAIL (module not found).

- [ ] **Step 3: Implement `web/seatlogic.js`**

```js
// Pure seating logic (no DOM): desk layout, neighbours, random arrangement with rules. Seat i = row * cols + col, row 0 = front.

export function blankLayout(rows = 5, cols = 6) {
  return { rows, cols, desks: Array(rows * cols).fill(true), pairs: false, assign: {}, fixed: [], apart: [], top: '', bottom: '', base: '' };
}

// Up/down/left/right desks. With pairs on, the aisle after every second column (between c and c+1 when c is odd) separates seats.
export function neighbours(L, i) {
  const r = Math.floor(i / L.cols), c = i % L.cols, out = [];
  const add = (rr, cc) => { if (rr >= 0 && rr < L.rows && cc >= 0 && cc < L.cols && L.desks[rr * L.cols + cc]) out.push(rr * L.cols + cc); };
  add(r - 1, c); add(r + 1, c);
  if (!(L.pairs && (c - 1) % 2 === 1)) add(r, c - 1);
  if (!(L.pairs && c % 2 === 1)) add(r, c + 1);
  return out;
}

const keepSeats = (L, ok) => ({
  ...L,
  assign: Object.fromEntries(Object.entries(L.assign).filter(([i]) => ok(+i))),
  fixed: L.fixed.filter(ok),
});

export function toggleDesk(L, i) {
  const desks = L.desks.slice();
  desks[i] = !desks[i];
  return keepSeats({ ...L, desks }, j => desks[j]);
}

export function resize(L, rows, cols) {
  const map = {}; // old index -> new index
  const desks = Array(rows * cols).fill(true);
  for (let r = 0; r < Math.min(rows, L.rows); r++) for (let c = 0; c < Math.min(cols, L.cols); c++) {
    map[r * L.cols + c] = r * cols + c;
    desks[r * cols + c] = L.desks[r * L.cols + c];
  }
  const assign = {};
  Object.entries(L.assign).forEach(([i, s]) => { const j = map[i]; if (j !== undefined && desks[j]) assign[j] = s; });
  const fixed = L.fixed.map(i => map[i]).filter(j => j !== undefined && desks[j]);
  return { ...L, rows, cols, desks, assign, fixed };
}

export const unplaced = (L, studentIds) => { const sat = new Set(Object.values(L.assign)); return studentIds.filter(s => !sat.has(s)); };

function shuffle(a, rand) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Random seats for everyone not pinned. Rules: pinned stay; avoid each student's seat in `base`; apart pairs never neighbour.
// Swaps rule-breaking students until clean (or a few thousand tries); apart pairs weigh far more than same-seat.
export function arrange(L, studentIds, base = {}, rand = Math.random) {
  const pinned = {};
  L.fixed.forEach(i => { if (L.desks[i] && L.assign[i] && studentIds.includes(L.assign[i])) pinned[i] = L.assign[i]; });
  const pinnedSet = new Set(Object.values(pinned));
  const free = shuffle(L.desks.map((d, i) => (d && !(i in pinned) ? i : -1)).filter(i => i >= 0), rand);
  const pool = shuffle(studentIds.filter(s => !pinnedSet.has(s)), rand);
  const seat = Array(L.desks.length).fill(null); // seat index -> student
  Object.entries(pinned).forEach(([i, s]) => { seat[i] = s; });
  free.forEach((i, k) => { if (k < pool.length) seat[i] = pool[k]; });
  const unseated = pool.slice(free.length);

  const partner = {};
  (L.apart || []).forEach(([a, b]) => { (partner[a] ??= []).push(b); (partner[b] ??= []).push(a); });
  const nb = L.desks.map((_, i) => neighbours(L, i));
  const apartBad = i => !!seat[i] && nb[i].some(j => seat[j] && (partner[seat[i]] || []).includes(seat[j]));
  const sameBad = i => !!seat[i] && base[i] === seat[i];
  const cost = i => (apartBad(i) ? 1000 : 0) + (sameBad(i) ? 1 : 0);
  const total = () => free.reduce((n, i) => n + cost(i), 0);

  let now = total();
  for (let t = 0; t < 4000 && now > 0; t++) {
    const bad = free.filter(i => cost(i) > 0);
    const a = bad[Math.floor(rand() * bad.length)];
    const b = free[Math.floor(rand() * free.length)];
    if (a === b) continue;
    [seat[a], seat[b]] = [seat[b], seat[a]];
    const next = total();
    if (next <= now) now = next; else [seat[a], seat[b]] = [seat[b], seat[a]];
  }
  const assign = {};
  seat.forEach((s, i) => { if (s) assign[i] = s; });
  return {
    assign,
    same: free.filter(sameBad).length + Object.keys(pinned).filter(i => base[i] === pinned[i]).length,
    apartFail: free.filter(apartBad).length,
    unseated,
  };
}
```

- [ ] **Step 4: Run tests** — `node --test` → all pass (기존 22 + 새 9).
- [ ] **Step 5: Commit** — `git add web/seatlogic.js test/seat.test.mjs && git commit -m "feat: seating logic module with tests"`

---

### Task 2: 서버 — 클래스 종류와 좌석 저장

**Files:**
- Create: `gas/Seats.js`
- Modify: `gas/Db.js` (HEADERS_, CACHED_, 스키마 키 `schema:5`), `gas/Api.js` (createClass_ kind, classes_ kind, 경로 등록, 문구)

**Interfaces:**
- Produces (교사 키 경로): `seats {classId} → [{id, name, layout, updated}]`, `seatPut {classId, id, name, layout, updated} → updated`, `seatDel {id} → true`. `classes`/`view`의 클래스 항목에 `kind: 'homeroom' | ''`. `createClass`가 `kind`를 받음.

- [ ] **Step 1: Db.js** — `Classes: ['id','name','section','subject','code','created','kind']`, `Seats: ['id','classId','name','layout','updated']`, `CACHED_`에 `Seats: true`, `ensureSchema_`의 `schema:4` → `schema:5`(두 군데).
- [ ] **Step 2: `gas/Seats.js`**

```js
// Seat layouts for homeroom classes. The app keeps its own copy and saves here in the background,
// so these routes never sit in front of the teacher. Newer `updated` wins.
const MAX_LAYOUT_ = 45000;

function seats_(req) {
  return rows_('Seats').filter(s => s.classId === req.classId)
    .map(s => ({ id: s.id, name: s.name, layout: s.layout, updated: s.updated }));
}

function seatPut_(req) {
  const id = String(req.id || '');
  const layout = String(req.layout || '');
  if (!id || !layout || layout.length > MAX_LAYOUT_) throw err_('좌석 배치를 저장하지 못했어요.');
  if (!rows_('Classes').some(c => c.id === req.classId)) throw err_('클래스를 찾을 수 없어요.', 'notfound');
  const updated = String(req.updated || now_());
  return withLock_(() => {
    const row = rows_('Seats').find(s => s.id === id);
    if (row) {
      if (String(row.updated) >= updated) return row.updated; // an older save arriving late
      Object.assign(row, { name: String(req.name || ''), layout: layout, updated: updated });
      update_('Seats', row._row, row);
    } else {
      append_('Seats', { id: id, classId: req.classId, name: String(req.name || ''), layout: layout, updated: updated });
    }
    return updated;
  });
}

function seatDel_(req) {
  return withLock_(() => {
    deleteRows_('Seats', rows_('Seats').filter(s => s.id === String(req.id)));
    return true;
  });
}
```

- [ ] **Step 3: Api.js** — `createClass_`: `kind: req.kind === 'homeroom' ? 'homeroom' : ''`를 행에 넣고 문구 `'클래스 이름을 입력해 주세요.'`; `classes_` 반환에 `kind: c.kind || ''`; `routes_()`에 `seats/seatPut/seatDel`(auth `teacher`); `'반을 찾을 수 없어요.'` 문구들 → `'클래스를 찾을 수 없어요.'`.
- [ ] **Step 4: Check** — `for f in gas/*.js; do node --check $f; done`, `node --test`.
- [ ] **Step 5: Commit** — `git commit -m "feat(server): class kind and seat layout routes"`

---

### Task 3: 교사 화면 — 담임/수업 묶음, 종류별 탭, "클래스" 문구

**Files:** Modify `web/teacher.js`, `web/styles.css`; mock `scratchpad/mock-api.js`

**Interfaces:**
- Consumes: `cls.kind`.
- Produces: 탭 id `seats` (`#/t/{classId}/seats`), `draw()`가 `seatsView(ctx)`(Task 4)를 부름. `ctx = { v, cls, frame(body, actions) → html, after() }` — `frame`은 `shell(v.classes, cls, 'seats', students, body, actions)`, `after`는 `bindShell()`.

- [ ] 사이드바: `classes.filter(c => c.kind === 'homeroom')`를 "담임" 라벨 아래(아이콘 `house-chimney-user` — `tools/make-fa.mjs` NAMES에 추가 후 재생성, `chair`도 추가), 나머지를 "수업" 라벨 아래. 담임이 없으면 담임 라벨 생략.
- [ ] 탭: 담임 = 좌석 배치(`chair`) · 학생 명단 · 메시지, 수업 = 과제 현황 · 학생 명단 · 메시지. 머리 칩에 담임이면 "담임 클래스".
- [ ] `teacherView`: 탭 없이 들어오면 담임은 `seats`, 수업은 `grid`. 담임 클래스에 `grid` 요청이 오면 `seats`로.
- [ ] 새 클래스 대화상자: 맨 위 종류 선택 `<div class="seg2">` 담임 / 수업(기본 수업), `createClass`에 `kind`. 만든 뒤 담임이면 `#/t/{id}/roster`(명단부터).
- [ ] "반" 문구 → "클래스": 새 반 만들기, 반 이름, 내 반, 반 전체, 첫 반을 만들어 주세요 등 `teacher.js`의 사용자 문구 전부(`grep -n "반" web/teacher.js`로 확인, 학급 표기 "2-3반" 같은 데이터는 그대로).
- [ ] mock: `classes`에 `kind`, 담임 클래스 `h1`(2학년 3반, 학생 27명), `seats/seatPut/seatDel`(메모리 저장).
- [ ] 미리보기로 사이드바·탭·대화상자 확인 후 commit `feat(teacher): homeroom/teaching class groups`.

---

### Task 4: 좌석 화면 (`web/seats.js`)

**Files:** Create `web/seats.js`; modify `web/styles.css`

**Interfaces:**
- Consumes: `seatlogic.js` 전부, `call/quiet`, `store`, `toast`, `fa`, `esc`, `showSeats()`(Task 5).
- Produces: `export function seatsView(ctx)`.

내용(스펙 3장, 6.3):
- [ ] 상태: `L`(작업본 Layout), `step` (`build`|`place`), `view` (`student`|`teacher`), `students` = `ctx.v.roster`(번호순). 작업본은 `localStorage seat:{classId}`에서 읽고 없으면 `blankLayout(5,6)`·`step='build'`.
- [ ] 저장 함수 `commit(next)`: `L = next; L.updated = new Date().toISOString(); localStorage 저장; scheduleSync()`(2초 디바운스) → `quiet('seatPut', {classId, id: 'cur:'+classId, name: '', layout: JSON.stringify(L), updated})`. 실패하면 `seatq:{classId}` 표시 + 도구줄 "저장 대기" 칩, 다음 변경·화면 열기 때 재시도.
- [ ] 열 때 `quiet('seats', {classId})` → 서버 작업본이 더 새로우면 교체 후 다시 그림; 저장본 목록 `seats:{classId}` 갱신.
- [ ] 그리기: 교실(`.seat-room` + 교탁 `.seat-desk`), 격자 `grid-template-columns`(짝이면 두 열마다 14px 통로 칸), 보기에 따라 행·열 순서 뒤집기. build 단계 칸: 책상 `.seat-cell.on`(초록 테두리)/빈칸 `.seat-cell`. place 단계 칸: 학생 `.seat-cell.stu`(번호·이름, 고정이면 📌), 빈 책상 `.seat-cell.empty`, 책상 없음은 투명.
- [ ] 도구줄: 단계 `[1 좌석 구성] › [2 자리 배치]`, 보기 토글, build: 행/열 −/＋(2~8, `resize`), 두 자리씩 붙이기, 모두 책상/모두 비우기, "구성 끝 · 자리 배치로". place: 불러오기. 머리 actions(place): 인쇄 · 저장 · 무작위 배치.
- [ ] 패널: build = 책상/학생/남는 자리 + 순서 안내; place = 책상/학생/고정, 자리 없는 학생(끌기 가능), 떨어뜨릴 학생 쌍 목록 + "쌍 추가"(두 학생 select 대화상자), 저장본 목록은 불러오기 대화상자에서.
- [ ] 포인터 끌기: `pointerdown`(학생 칸·패널 이름) → 6px 이상 움직이면 떠다니는 사본 + `elementFromPoint`로 대상 강조 → `pointerup`에서 교환/이동/패널로 빼기(`assign` 갱신, 고정이면 고정도 같이 이동). 움직이지 않은 클릭은 칸 메뉴(고정/고정 해제 · 비우기).
- [ ] 저장 대화상자(이름) → 저장본 `{id: newId, name, layout: {...L, base: ''}, updated}`를 목록·기기에 추가하고 `quiet('seatPut')`. 불러오기 대화상자: 목록(최근 순), 고르면 `commit({...저장본.layout, base: 저장본.id})`, 휴지통으로 `seatDel`.
- [ ] 무작위: 자리 부족 확인 → 확인창(연출/속도/효과음, `localStorage seatShowPrefs`) → `arrange(L, studentIds, baseAssign)` (`baseAssign` = `L.base` 저장본의 assign, 없으면 현재 `L.assign`) → `showSeats({...})` → 확정 시 `commit({...L, assign: r.assign})` + `r.same`/`r.apartFail`/`r.unseated` 안내 토스트.
- [ ] 인쇄: 미리보기 겹화면 `.seat-paper`(상·하단 문구 contenteditable, 학생/교사 보기 선택) → "인쇄하기"는 `body.classList.add('seat-printing'); print(); 끝나면 제거`. 문구는 `commit`으로 저장.
- [ ] commit `feat(teacher): seating screen`.

---

### Task 5: 전체 화면 공개 (`web/seatshow.js`)

**Files:** Create `web/seatshow.js`; modify `web/styles.css`

**Interfaces:**
- Produces: `export function showSeats({ L, assign, names, title, mode: 'slot'|'magnet', speed: 'fast'|'normal'|'step', sound: bool }) → Promise<'ok'|'again'|'close'>`

- [ ] 겹화면 `.seat-show`를 `document.body`에 붙이고 `requestFullscreen()`(실패해도 진행). 학생 보기 격자, 고정석은 처음부터 채움.
- [ ] 공개 순서 = 고정 아닌 자리를 앞줄부터. 간격: fast = 5000/n ms, normal = 12000/n ms, step = 스페이스·클릭마다.
- [ ] slot: 공개 전 칸들이 70ms마다 무작위 이름으로 바뀌다 순서대로 멈춤(멈출 때 튀는 애니메이션 + 틱 소리).
- [ ] magnet: 이름 자석이 흩어져 떠 있다가 차례로 포물선을 그리며 날아와 붙음, 스포트라이트 + 큰 이름 + 팝 소리.
- [ ] 소리: Web Audio 오실레이터 짧은 소리(틱 900Hz 40ms, 팝 520→880Hz 120ms), `sound`가 false면 없음.
- [ ] `prefers-reduced-motion` → 즉시 전부 표시.
- [ ] 끝나면 버튼 "다시 섞기 / 이대로 확정", 오른쪽 위 닫기, Esc = 닫기. 종료 시 전체 화면 해제·겹화면 제거.
- [ ] commit `feat: full-screen seat reveal (slot, magnet)`.

---

### Task 6: 인쇄 스타일, 서비스워커, 배포

- [ ] `styles.css`: `.seat-paper { page: seatland }`, `@page seatland { size: A4 landscape; margin: 8mm }`, `@media print { body.seat-printing #app, body.seat-printing .toast { display: none !important } body.seat-printing .seat-paper { position: static; ... } }`, 칸 크기는 JS가 용지(281×194mm 내부) 기준으로 계산해 CSS 변수로 넣음.
- [ ] `sw.js`: CACHE 올리고 `seatlogic.js`, `seats.js`, `seatshow.js` 추가.
- [ ] 전체 확인: `node --test`, 미리보기에서 구성 → 배치 → 끌기 → 고정 → 떨어뜨리기 → 무작위(slot/magnet, step) → 저장 → 불러오기 → 인쇄 미리보기, 휴대폰 폭에서 깨짐 없는지 QA 스크립트.
- [ ] `clasp push` + 같은 배포 id로 `clasp deploy`, main에 ff 병합·푸시, 새 경로 응답 확인.
