'use strict';

const VERSION = '1.0.0';
const STORE_KEY = 'cubetimer.v1';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ====================== 저장 ======================
const DEFAULT_SETTINGS = { insp: false, hideRunning: false, showScr: true, showNet: true, sound: true, haptic: true };

function newSession(name) {
  return { id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, solves: [] };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      s.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings);
      if (!s.sessions || !s.sessions.length) s.sessions = [newSession('세션 1')];
      if (!s.sessions.find((x) => x.id === s.current)) s.current = s.sessions[0].id;
      return s;
    }
  } catch (e) { /* 깨진 데이터면 새로 시작 */ }
  const first = newSession('세션 1');
  return { sessions: [first], current: first.id, settings: { ...DEFAULT_SETTINGS }, lastBackup: 0, solvesAtBackup: 0 };
}

let state = loadState();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('저장 공간이 부족해요. 기록을 내보내 주세요.'); }
}
const session = () => state.sessions.find((s) => s.id === state.current);
const totalSolves = () => state.sessions.reduce((n, s) => n + s.solves.length, 0);

// 저장공간을 "지우지 마세요"로 요청
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ====================== 시간 계산 ======================
// 기록: { t: ms, p: 0 | 2 | -1(DNF), s: 스크램블, d: 날짜(ms) }
const value = (x) => (x.p === -1 ? Infinity : x.t + (x.p === 2 ? 2000 : 0));

function fmt(ms) {
  if (ms == null) return '-';
  if (ms === Infinity) return 'DNF';
  const cs = Math.floor(ms / 10); // 0.01초 단위 (내림, 대회 방식)
  const m = Math.floor(cs / 6000);
  const s = ((cs % 6000) / 100).toFixed(2);
  return m > 0 ? `${m}:${s.padStart(5, '0')}` : s;
}
function fmtSolve(x) {
  if (x.p === -1) return `DNF(${fmt(x.t)})`;
  return fmt(value(x)) + (x.p === 2 ? '+' : '');
}

// 대회 방식 평균: 위아래 5%(최소 1개)씩 빼고 평균. 남은 것 중 DNF가 있으면 DNF.
function avgOf(list) {
  const n = list.length;
  const v = list.map(value).sort((a, b) => a - b);
  const cut = Math.ceil(n * 0.05);
  const mid = v.slice(cut, n - cut);
  if (mid.includes(Infinity)) return Infinity;
  return mid.reduce((a, b) => a + b, 0) / mid.length;
}
const currentAvg = (solves, n) => (solves.length < n ? null : avgOf(solves.slice(-n)));
function bestAvg(solves, n) {
  let best = null;
  for (let i = n; i <= solves.length; i++) {
    const a = avgOf(solves.slice(i - n, i));
    if (best == null || a < best) best = a;
  }
  return best;
}
function bestSingle(solves) {
  const v = solves.map(value).filter((x) => x !== Infinity);
  return v.length ? Math.min(...v) : null;
}

// ====================== 스크램블 ======================
// 앱을 켜자마자 쓸 수 있게 다음 스크램블 몇 개를 저장해 둠
const STASH_KEY = 'cubetimer.scrStash';
let worker = null;
let scrambleQueue = (() => { try { return JSON.parse(localStorage.getItem(STASH_KEY)) || []; } catch (e) { return []; } })();
let currentScramble = '';
let waitingScramble = false;
let workerBusy = false;
const saveStash = () => { try { localStorage.setItem(STASH_KEY, JSON.stringify(scrambleQueue.slice(0, 5))); } catch (e) { /* 무시 */ } };

function requestScramble() {
  if (!worker || workerBusy || scrambleQueue.length >= 5) return;
  workerBusy = true;
  worker.postMessage('next');
}

function initWorker() {
  try {
    worker = new Worker('scramble-worker.js');
    worker.onmessage = (e) => {
      workerBusy = false;
      scrambleQueue.push(e.data);
      saveStash();
      if (waitingScramble) { waitingScramble = false; takeScramble(); }
      requestScramble();
    };
    requestScramble();
  } catch (e) {
    worker = null; // 워커를 못 쓰면 무작위 이동 스크램블로 대체
  }
}

// 대체용: 같은 면/같은 축 반복을 피한 무작위 25수
function randomMoveScramble() {
  const faces = ['U', 'D', 'L', 'R', 'F', 'B'], axis = { U: 0, D: 0, L: 1, R: 1, F: 2, B: 2 }, suf = ['', "'", '2'];
  const out = []; let last = null, prev = null;
  while (out.length < 25) {
    const f = faces[(Math.random() * 6) | 0];
    if (f === last) continue;
    if (prev && axis[f] === axis[last] && axis[f] === axis[prev]) continue;
    prev = last; last = f; out.push(f + suf[(Math.random() * 3) | 0]);
  }
  return out.join(' ');
}

function takeScramble() {
  if (scrambleQueue.length) {
    currentScramble = scrambleQueue.shift();
    saveStash();
    requestScramble();
  } else if (worker) {
    currentScramble = '';
    waitingScramble = true;
  } else {
    currentScramble = randomMoveScramble();
  }
  renderScramble();
}

// ---------- 스크램블 그림 (전개도) ----------
const AXES = { U: [0, 1, 0], D: [0, -1, 0], R: [1, 0, 0], L: [-1, 0, 0], F: [0, 0, 1], B: [0, 0, -1] };
const COLORS = { U: '#f5f5f7', D: '#ffd60a', F: '#30d158', B: '#0a84ff', R: '#ff453a', L: '#ff9f0a' };
const VIEW = {
  U: { r: [1, 0, 0], d: [0, 0, 1], o: [0, 1] },
  L: { r: [0, 0, 1], d: [0, -1, 0], o: [1, 0] },
  F: { r: [1, 0, 0], d: [0, -1, 0], o: [1, 1] },
  R: { r: [0, 0, -1], d: [0, -1, 0], o: [1, 2] },
  B: { r: [-1, 0, 0], d: [0, -1, 0], o: [1, 3] },
  D: { r: [1, 0, 0], d: [0, 0, -1], o: [2, 1] },
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// 면을 밖에서 봤을 때 시계방향 90도
const turn = (v, a) => { const c = cross(a, v), d = dot(a, v); return [-c[0] + a[0] * d, -c[1] + a[1] * d, -c[2] + a[2] * d]; };

function stickersAfter(scramble) {
  const st = [];
  for (const f in AXES) {
    const n = AXES[f], free = [0, 1, 2].filter((k) => n[k] === 0);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const p = n.slice(); p[free[0]] = i; p[free[1]] = j;
      st.push({ p, n: n.slice(), c: f });
    }
  }
  for (const mv of scramble.split(/\s+/).filter(Boolean)) {
    const a = AXES[mv[0]]; if (!a) continue;
    const times = mv[1] === "'" ? 3 : mv[1] === '2' ? 2 : 1;
    for (let k = 0; k < times; k++) for (const s of st) if (dot(s.p, a) === 1) { s.p = turn(s.p, a); s.n = turn(s.n, a); }
  }
  return st;
}

function netSVG(scramble) {
  const S = 9.4; let h = '';
  for (const s of stickersAfter(scramble)) {
    const face = Object.keys(AXES).find((k) => dot(AXES[k], s.n) === 1), v = VIEW[face];
    const x = v.o[1] * 30 + (dot(s.p, v.r) + 1) * S + 1, y = v.o[0] * 30 + (dot(s.p, v.d) + 1) * S + 1;
    h += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${S - 1.3}" height="${S - 1.3}" rx="1.8" fill="${COLORS[s.c]}"/>`;
  }
  return h;
}

function renderScramble() {
  const box = $('#scrambleBox'), txt = $('#scrambleText'), net = $('#scrambleNet');
  box.classList.toggle('hidden', !state.settings.showScr);
  if (!currentScramble) {
    txt.textContent = '스크램블 준비 중…'; txt.classList.add('loading'); net.innerHTML = '';
  } else {
    txt.textContent = currentScramble; txt.classList.remove('loading');
    net.innerHTML = state.settings.showNet ? netSVG(currentScramble) : '';
  }
  net.classList.toggle('hidden', !state.settings.showNet);
}

// ====================== 소리 · 진동 ======================
let audio = null;
function unlockAudio() {
  if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } }
  if (audio.state === 'suspended') audio.resume();
}
function beep(freq = 880, dur = 0.09, gain = 0.15, when = 0) {
  if (!state.settings.sound || !audio) return;
  const t = audio.currentTime + when;
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur + 0.02);
}
function chime() { beep(784, 0.12, 0.14, 0); beep(988, 0.12, 0.14, 0.1); beep(1319, 0.22, 0.14, 0.2); }
// iOS 18 사파리: 스위치 체크박스를 누르면 기기 진동이 남 (사용자 터치 중에만)
function haptic() {
  if (!state.settings.haptic) return;
  if (navigator.vibrate) { navigator.vibrate(12); return; }
  $('#hapticLabel').click();
}

// ====================== 타이머 ======================
// idle → (hold → ready) → running → idle
// 관찰 시간 켜짐: idle → 탭 → inspecting → (hold → ready) → running
let phase = 'idle';
let holdTimer = null, startAt = 0, raf = 0;
let inspStart = 0, inspTimer = null, inspAlerts = {};
let lastSolveIndex = -1;
const HOLD_MS = 300;

const timeEl = $('#timeDisplay'), hintEl = $('#hint'), inspEl = $('#inspLabel');

function setTimeClass(...cls) {
  timeEl.className = 'time ' + cls.join(' ');
}

function inspElapsed() { return (performance.now() - inspStart) / 1000; }

function startInspection() {
  phase = 'inspecting';
  inspStart = performance.now(); inspAlerts = {};
  document.body.classList.add('running');
  $('#penaltyBar').classList.add('hidden');
  hintEl.textContent = '관찰 중 · 길게 눌렀다 떼면 시작'; hintEl.className = 'hint';
  const tick = () => {
    const e = inspElapsed();
    const left = 15 - Math.floor(e);
    if (phase === 'inspecting') {
      timeEl.textContent = left > 0 ? String(left) : e < 17 ? '+2' : 'DNF';
      setTimeClass('inspecting', left <= 3 ? 'late' : '');
    }
    if (e >= 8 && !inspAlerts[8]) { inspAlerts[8] = 1; inspEl.textContent = '8초!'; beep(660); }
    if (e >= 12 && !inspAlerts[12]) { inspAlerts[12] = 1; inspEl.textContent = '12초!'; beep(880); beep(880, 0.09, 0.15, 0.15); }
  };
  tick();
  inspTimer = setInterval(tick, 100);
}

function startSolve() {
  clearInterval(inspTimer);
  const inspPenalty = state.settings.insp ? (inspElapsed() > 17 ? -1 : inspElapsed() > 15 ? 2 : 0) : 0;
  phase = 'running';
  startAt = performance.now();
  startSolve.penalty = inspPenalty;
  document.body.classList.add('running');
  $('#stopLayer').classList.remove('hidden');
  inspEl.textContent = '';
  setTimeClass();
  hintEl.textContent = ''; hintEl.className = 'hint';
  const loop = () => {
    timeEl.textContent = state.settings.hideRunning ? '풀이 중' : fmt(performance.now() - startAt);
    raf = requestAnimationFrame(loop);
  };
  loop();
}

function stopSolve() {
  const t = Math.round(performance.now() - startAt);
  cancelAnimationFrame(raf);
  phase = 'idle';
  document.body.classList.remove('running');
  $('#stopLayer').classList.add('hidden');
  haptic();

  const ses = session();
  const prevBest = bestSingle(ses.solves);
  const prevBestAo5 = bestAvg(ses.solves, 5);
  const solve = { t, p: startSolve.penalty || 0, s: state.settings.showScr ? currentScramble : '', d: Date.now() };
  ses.solves.push(solve);
  lastSolveIndex = ses.solves.length - 1;
  save();

  timeEl.textContent = fmtSolve(solve);
  const v = value(solve);
  const newAo5 = currentAvg(ses.solves, 5);
  if (prevBest != null && v < prevBest) {
    setTimeClass('pb'); hintEl.textContent = '🎉 새 최고 기록!'; hintEl.className = 'hint pb'; chime();
  } else if (prevBestAo5 != null && newAo5 != null && newAo5 < prevBestAo5) {
    setTimeClass(); hintEl.textContent = '🎉 ao5 최고 기록!'; hintEl.className = 'hint pb'; chime();
  } else {
    setTimeClass(); hintEl.textContent = '길게 눌렀다 떼면 시작'; hintEl.className = 'hint';
  }
  showPenaltyBar(solve.p);
  takeScramble();
  renderStats();
}

function showPenaltyBar(p) {
  const bar = $('#penaltyBar');
  bar.classList.remove('hidden');
  bar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.pen === String(p)));
}

function setPenalty(index, pen) {
  const ses = session();
  const solve = ses.solves[index];
  if (!solve) return;
  if (pen === 'del') {
    ses.solves.splice(index, 1);
    if (index === lastSolveIndex) {
      lastSolveIndex = -1;
      $('#penaltyBar').classList.add('hidden');
      timeEl.textContent = '0.00'; setTimeClass();
      hintEl.textContent = '길게 눌렀다 떼면 시작'; hintEl.className = 'hint';
    } else if (index < lastSolveIndex) lastSolveIndex--;
  } else {
    solve.p = Number(pen);
    if (index === lastSolveIndex) { timeEl.textContent = fmtSolve(solve); showPenaltyBar(solve.p); }
  }
  save();
  renderStats();
}

// 누르기 / 떼기
function press() {
  unlockAudio();
  if (phase === 'running') { stopSolve(); return; }
  if (phase === 'idle' && state.settings.insp) { phase = 'idle-armed'; return; } // 떼면 관찰 시작
  if (phase === 'idle' || phase === 'inspecting') {
    phase = phase === 'inspecting' ? 'hold-insp' : 'hold';
    setTimeClass('holding');
    holdTimer = setTimeout(() => {
      phase = phase === 'hold-insp' ? 'ready-insp' : 'ready';
      setTimeClass('ready');
      haptic();
    }, HOLD_MS);
  }
}
function release() {
  clearTimeout(holdTimer);
  if (phase === 'idle-armed') { haptic(); startInspection(); return; }
  if (phase === 'ready' || phase === 'ready-insp') { startSolve(); return; }
  if (phase === 'hold') { phase = 'idle'; setTimeClass(); return; }
  if (phase === 'hold-insp') { phase = 'inspecting'; setTimeClass('inspecting'); }
}

const zone = $('#timerZone');
zone.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  e.preventDefault();
  press();
});
zone.addEventListener('pointerup', (e) => { if (!e.target.closest('button')) release(); });
zone.addEventListener('pointercancel', () => { if (phase === 'hold' || phase === 'ready') { clearTimeout(holdTimer); phase = 'idle'; setTimeClass(); } });
$('#stopLayer').addEventListener('pointerdown', (e) => { e.preventDefault(); if (phase === 'running') stopSolve(); });

// 관찰 중에는 화면 어디를 눌러도 시작 준비가 되도록
document.addEventListener('pointerdown', (e) => {
  if ((phase === 'inspecting') && !zone.contains(e.target)) { e.preventDefault(); press(); }
});
document.addEventListener('pointerup', (e) => {
  if ((phase === 'hold-insp' || phase === 'ready-insp') && !zone.contains(e.target)) release();
});

// 컴퓨터용: 스페이스바
let spaceDown = false;
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || !$('#screen-timer').classList.contains('on') || isSheetOpen()) return;
  e.preventDefault();
  if (phase === 'running') { stopSolve(); return; }
  if (!spaceDown) { spaceDown = true; press(); }
});
document.addEventListener('keyup', (e) => {
  if (e.code !== 'Space' || !spaceDown) return;
  spaceDown = false; release();
});

$('#penaltyBar').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.pen === 'del' && !confirm('이 기록을 삭제할까요?')) return;
  setPenalty(lastSolveIndex, b.dataset.pen);
});
$('#newScrBtn').addEventListener('click', () => { takeScramble(); });

// ====================== 화면 그리기 ======================
function renderStats() {
  const ses = session(), solves = ses.solves;
  $('#sessionName').textContent = ses.name;
  $('#settingsSession').textContent = ses.name + ' ›';
  $('#qAo5').textContent = fmt(currentAvg(solves, 5));
  $('#qAo12').textContent = fmt(currentAvg(solves, 12));
  $('#qBest').textContent = fmt(bestSingle(solves));
  $('#qCount').textContent = solves.length;
  renderBackupBanner();
  if ($('#screen-list').classList.contains('on')) renderList();
  if ($('#screen-stats').classList.contains('on')) renderStatsScreen();
}

function renderList() {
  const ses = session(), solves = ses.solves;
  $('#listSub').textContent = `${ses.name} · ${solves.length}회`;
  const el = $('#solveList');
  if (!solves.length) { el.innerHTML = '<div class="empty">아직 기록이 없어요</div>'; return; }
  const best = bestSingle(solves);
  const rows = [];
  for (let i = solves.length - 1; i >= 0; i--) {
    const x = solves[i];
    const d = new Date(x.d);
    const date = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const isBest = value(x) === best && best != null;
    rows.push(`<button class="solve-row" data-i="${i}"><span class="idx">${i + 1}</span><span class="t${isBest ? ' mint' : ''}">${fmtSolve(x)}</span><span class="d">${date}</span></button>`);
  }
  el.innerHTML = rows.join('');
}
$('#solveList').addEventListener('click', (e) => {
  const r = e.target.closest('.solve-row'); if (r) openSolveSheet(Number(r.dataset.i));
});

function renderStatsScreen() {
  const ses = session(), solves = ses.solves;
  $('#statsSub').textContent = ses.name;
  const finite = solves.map(value).filter((v) => v !== Infinity);
  const mean = finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null;
  const items = [
    ['최고 단일', fmt(bestSingle(solves)), 'mint'],
    ['최고 ao5', fmt(bestAvg(solves, 5)), 'mint'],
    ['현재 ao5', fmt(currentAvg(solves, 5))],
    ['최고 ao12', fmt(bestAvg(solves, 12)), 'mint'],
    ['현재 ao12', fmt(currentAvg(solves, 12))],
    ['현재 ao100', fmt(currentAvg(solves, 100))],
    ['평균 (DNF 제외)', fmt(mean)],
    ['횟수', `${solves.length}회${solves.length - finite.length ? ` · DNF ${solves.length - finite.length}` : ''}`],
  ];
  $('#statGrid').innerHTML = items.map(([k, v, c]) => `<div><span>${k}</span><b class="${c || ''}">${v}</b></div>`).join('');

  // 그래프: 최근 100개
  const recent = solves.slice(-100);
  const svg = $('#chart');
  const pts = recent.map((x, i) => ({ i, v: value(x) })).filter((p) => p.v !== Infinity);
  if (pts.length < 2) {
    svg.innerHTML = '<text x="160" y="74" text-anchor="middle" fill="#55555a" font-size="12">기록이 2개 이상이면 그래프가 그려져요</text>';
    return;
  }
  const max = Math.max(...pts.map((p) => p.v)), min = Math.min(...pts.map((p) => p.v)), span = max - min || 1;
  const X = (i) => 6 + (i / Math.max(recent.length - 1, 1)) * 308, Y = (v) => 128 - ((v - min) / span) * 116;
  const line = pts.map((p) => `${X(p.i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const ao5pts = [];
  for (let i = 4; i < recent.length; i++) {
    const a = avgOf(recent.slice(i - 4, i + 1));
    if (a !== Infinity) ao5pts.push(`${X(i).toFixed(1)},${Y(Math.min(Math.max(a, min), max)).toFixed(1)}`);
  }
  svg.innerHTML =
    `<line x1="0" x2="320" y1="${Y(min)}" y2="${Y(min)}" stroke="#26262b" stroke-dasharray="3 4"/>` +
    `<text x="314" y="${Y(min) - 4}" text-anchor="end" fill="#55555a" font-size="10">${fmt(min)}</text>` +
    `<text x="314" y="${Y(max) + 12}" text-anchor="end" fill="#55555a" font-size="10">${fmt(max)}</text>` +
    `<polyline points="${line}" fill="none" stroke="#5ee0b0" stroke-width="1.8" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` +
    (ao5pts.length > 1 ? `<polyline points="${ao5pts.join(' ')}" fill="none" stroke="#d1d1d6" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke" opacity=".8"/>` : '');
}

function renderBackupBanner() {
  const total = totalSolves();
  const since = total - (state.solvesAtBackup || 0);
  const days = state.lastBackup ? (Date.now() - state.lastBackup) / 86400000 : Infinity;
  const show = total > 0 && (since >= 100 || (state.lastBackup ? days >= 14 && since > 0 : total >= 50));
  $('#backupBanner').classList.toggle('hidden', !show);
  $('#backupInfo').textContent = state.lastBackup
    ? `마지막 백업: ${new Date(state.lastBackup).toLocaleDateString('ko-KR')} (이후 ${Math.max(since, 0)}회 추가)`
    : '마지막 백업: 없음';
}

// ====================== 탭 ======================
function showScreen(name) {
  if (phase !== 'idle') return;
  $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.screen === name));
  $$('.screen').forEach((s) => s.classList.toggle('on', s.id === 'screen-' + name));
  if (name === 'list') renderList();
  if (name === 'stats') renderStatsScreen();
}
$$('.tab').forEach((t) => t.addEventListener('click', () => showScreen(t.dataset.screen)));

// ====================== 시트 ======================
const backdrop = $('#sheetBackdrop'), sheet = $('#sheet');
const isSheetOpen = () => !backdrop.classList.contains('hidden');
function openSheet(html) { sheet.innerHTML = '<div class="grab"></div>' + html; backdrop.classList.remove('hidden'); }
function closeSheet() { backdrop.classList.add('hidden'); sheet.innerHTML = ''; }
backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeSheet(); });

function openSolveSheet(i) {
  const x = session().solves[i]; if (!x) return;
  const d = new Date(x.d);
  openSheet(`
    <div class="big">${fmtSolve(x)}</div>
    <div class="sub">${i + 1}번째 · ${d.toLocaleString('ko-KR')}</div>
    ${x.s ? `<div class="scr">${x.s}</div><svg class="net" viewBox="0 0 120 90">${netSVG(x.s)}</svg>` : '<div class="sub">스크램블 없음</div>'}
    <div class="btns">
      <button data-pen="0" class="${x.p === 0 ? 'on' : ''}">OK</button>
      <button data-pen="2" class="${x.p === 2 ? 'on' : ''}">+2</button>
      <button data-pen="-1" class="${x.p === -1 ? 'on' : ''}">DNF</button>
    </div>
    <div class="btns">
      ${x.s ? '<button data-act="copy">스크램블 복사</button>' : ''}
      <button data-act="del" class="danger">삭제</button>
    </div>`);
  sheet.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pen != null) { setPenalty(i, b.dataset.pen); openSolveSheet(i); renderList(); }
    if (b.dataset.act === 'copy') { navigator.clipboard?.writeText(x.s).then(() => toast('복사했어요')).catch(() => {}); }
    if (b.dataset.act === 'del' && confirm('이 기록을 삭제할까요?')) { setPenalty(i, 'del'); closeSheet(); renderList(); }
  };
}

function openSessionSheet() {
  const items = state.sessions.map((s) =>
    `<button class="item ${s.id === state.current ? 'current' : ''}" data-id="${s.id}"><span>${escapeHTML(s.name)}</span><span class="count">${s.solves.length}회 ${s.id === state.current ? '✓' : ''}</span></button>`).join('');
  openSheet(`<h2>세션</h2>${items}
    <button class="wide" data-act="add">+ 새 세션</button>
    <div class="btns"><button data-act="rename">현재 세션 이름 변경</button><button data-act="delete" class="danger">현재 세션 삭제</button></div>`);
  sheet.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.id) {
      state.current = b.dataset.id; lastSolveIndex = -1;
      $('#penaltyBar').classList.add('hidden'); timeEl.textContent = '0.00'; setTimeClass();
      save(); renderStats(); closeSheet(); return;
    }
    if (b.dataset.act === 'add') {
      const name = prompt('새 세션 이름', `세션 ${state.sessions.length + 1}`);
      if (name && name.trim()) { const s = newSession(name.trim()); state.sessions.push(s); state.current = s.id; lastSolveIndex = -1; save(); renderStats(); }
      openSessionSheet();
    }
    if (b.dataset.act === 'rename') {
      const name = prompt('세션 이름', session().name);
      if (name && name.trim()) { session().name = name.trim(); save(); renderStats(); }
      openSessionSheet();
    }
    if (b.dataset.act === 'delete') {
      if (state.sessions.length === 1) { toast('세션이 하나뿐이라 지울 수 없어요'); return; }
      if (!confirm(`"${session().name}" 세션과 기록 ${session().solves.length}개를 삭제할까요?`)) return;
      state.sessions = state.sessions.filter((s) => s.id !== state.current);
      state.current = state.sessions[0].id; lastSolveIndex = -1;
      save(); renderStats(); openSessionSheet();
    }
  };
}
$('#sessionBtn').addEventListener('click', openSessionSheet);
$('#manageSessions').addEventListener('click', openSessionSheet);

function escapeHTML(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ====================== 설정 ======================
function renderSettings() {
  $$('[data-setting]').forEach((el) => { el.checked = !!state.settings[el.dataset.setting]; });
  $('#netRow').classList.toggle('disabled', !state.settings.showScr);
  $('#version').textContent = VERSION;
}
$$('[data-setting]').forEach((el) => el.addEventListener('change', () => {
  state.settings[el.dataset.setting] = el.checked;
  save(); renderSettings(); renderScramble();
}));

$('#clearSession').addEventListener('click', () => {
  const ses = session();
  if (!ses.solves.length) { toast('지울 기록이 없어요'); return; }
  if (!confirm(`"${ses.name}"의 기록 ${ses.solves.length}개를 모두 삭제할까요? 되돌릴 수 없어요.`)) return;
  ses.solves = []; lastSolveIndex = -1; save(); renderStats(); toast('삭제했어요');
});

// ====================== 백업 ======================
async function exportBackup() {
  const data = { app: 'cubetimer', version: 1, exportedAt: new Date().toISOString(), sessions: state.sessions, current: state.current, settings: state.settings };
  const json = JSON.stringify(data);
  const d = new Date();
  const name = `cubetimer-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  const file = new File([json], name, { type: 'application/json' });
  let done = false;
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'cubetimer 백업' });
      done = true;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // 사용자가 취소
  }
  if (!done) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  state.lastBackup = Date.now(); state.solvesAtBackup = totalSolves(); save();
  renderBackupBanner(); toast('백업 파일을 만들었어요');
}
$('#exportBtn').addEventListener('click', exportBackup);
$('#backupBanner').addEventListener('click', exportBackup);

$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const incoming = parseBackup(data);
    if (!incoming.length) { toast('가져올 기록이 없어요'); return; }
    const count = incoming.reduce((n, s) => n + s.solves.length, 0);
    if (!confirm(`세션 ${incoming.length}개, 기록 ${count}개를 가져올까요?\n같은 이름의 세션에 합쳐지고, 이미 있는 기록은 건너뛰어요.`)) return;
    let added = 0;
    for (const inc of incoming) {
      let target = state.sessions.find((s) => s.name === inc.name);
      if (!target) { target = newSession(inc.name); state.sessions.push(target); }
      const seen = new Set(target.solves.map((x) => x.d + ':' + x.t));
      for (const x of inc.solves) if (!seen.has(x.d + ':' + x.t)) { target.solves.push(x); added++; }
      target.solves.sort((a, b) => a.d - b.d);
    }
    save(); renderStats(); toast(`${added}개 가져왔어요`);
  } catch (err) {
    toast('파일을 읽지 못했어요');
  }
});

// cubetimer 형식 또는 csTimer 형식
function parseBackup(data) {
  if (data && data.app === 'cubetimer' && Array.isArray(data.sessions)) {
    return data.sessions.map((s) => ({
      name: String(s.name || '가져온 세션'),
      solves: (s.solves || []).filter((x) => typeof x.t === 'number').map((x) => ({ t: x.t, p: x.p === 2 || x.p === -1 ? x.p : 0, s: String(x.s || ''), d: Number(x.d) || Date.now() })),
    }));
  }
  // csTimer: { session1: [[[pen, ms], scramble, comment, unixSec], ...], properties: { sessionData: "{...}" } }
  if (data && typeof data === 'object' && Object.keys(data).some((k) => /^session\d+$/.test(k))) {
    let names = {};
    try {
      const sd = data.properties && data.properties.sessionData;
      const parsed = typeof sd === 'string' ? JSON.parse(sd) : sd;
      for (const k in parsed || {}) names[k] = parsed[k] && parsed[k].name;
    } catch (e) { /* 이름 없으면 기본 이름 */ }
    const out = [];
    for (const k of Object.keys(data)) {
      const m = k.match(/^session(\d+)$/); if (!m) continue;
      let list = data[k];
      if (typeof list === 'string') { try { list = JSON.parse(list); } catch (e) { continue; } }
      if (!Array.isArray(list) || !list.length) continue;
      out.push({
        name: `csTimer ${names[m[1]] != null ? names[m[1]] : m[1]}`,
        solves: list.filter((x) => Array.isArray(x) && Array.isArray(x[0])).map((x) => ({
          t: Number(x[0][1]) || 0,
          p: x[0][0] === -1 ? -1 : x[0][0] === 2000 ? 2 : 0,
          s: String(x[1] || ''),
          d: (Number(x[3]) || 0) * 1000 || Date.now(),
        })),
      });
    }
    return out;
  }
  return [];
}

// ====================== 기타 ======================
let toastTimer = null;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 1800);
}

// 앱이 백그라운드로 가면 진행 중인 준비 상태 정리 (도는 중이면 계속 잼)
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (phase === 'hold' || phase === 'ready')) { clearTimeout(holdTimer); phase = 'idle'; setTimeClass(); }
});

// 오프라인용 서비스 워커
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// 시작
renderSettings();
renderStats();
initWorker();
takeScramble();
