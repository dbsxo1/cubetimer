'use strict';
// cubetimer 컴퓨터용. 폰 버전과 같은 저장 형식(같은 브라우저에서는 기록도 공유).

const VERSION = '1.0.0';
const STORE_KEY = 'cubetimer.v1';
const STASH_KEY = 'cubetimer.scrStash';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ====================== 저장 ======================
const DEFAULT_SETTINGS = {
  insp: false, hideRunning: false, showScr: true, showNet: true, sound: true, haptic: true,
  // 컴퓨터용 추가 설정
  pcTheme: 'system', pcDecimals: 2, pcInput: 'timer', pcHoldMs: 300,
};

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
const S = () => state.settings;
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// 다른 탭(폰 버전 포함)에서 기록이 바뀌면 다시 읽기
addEventListener('storage', (e) => {
  if (e.key === STORE_KEY && phase === 'idle') { state = loadState(); applyTheme(); renderAll(); }
});

// ====================== 시간 계산 ======================
// 기록: { t: ms, p: 0 | 2 | -1(DNF), s: 스크램블, d: 날짜(ms), c?: 코멘트 }
const value = (x) => (x.p === -1 ? Infinity : x.t + (x.p === 2 ? 2000 : 0));
function fmt(ms) {
  if (ms == null) return '-';
  if (ms === Infinity) return 'DNF';
  const dec = S().pcDecimals === 3 ? 3 : 2;
  const unit = dec === 3 ? 1 : 10;
  const v = Math.floor(ms / unit) * unit; // 내림 (대회 방식)
  const m = Math.floor(v / 60000);
  const s = ((v % 60000) / 1000).toFixed(dec);
  return m > 0 ? `${m}:${s.padStart(dec + 3, '0')}` : s;
}
function fmtSolve(x) {
  if (x.p === -1) return `DNF(${fmt(x.t)})`;
  return fmt(value(x)) + (x.p === 2 ? '+' : '');
}
function avgOf(list) {
  const n = list.length, v = list.map(value).sort((a, b) => a - b);
  const cut = Math.ceil(n * 0.05), mid = v.slice(cut, n - cut);
  if (mid.includes(Infinity)) return Infinity;
  return mid.reduce((a, b) => a + b, 0) / mid.length;
}
function meanOf(list) {
  const v = list.map(value);
  if (v.includes(Infinity)) return Infinity;
  return v.reduce((a, b) => a + b, 0) / v.length;
}
const calc = (list, n) => (n === 3 ? meanOf(list) : avgOf(list));
const current = (solves, n) => (solves.length < n ? null : calc(solves.slice(-n), n));
function best(solves, n) {
  if (n === 1) { const v = solves.map(value).filter((x) => x !== Infinity); return v.length ? Math.min(...v) : (solves.length ? Infinity : null); }
  let b = null, at = -1;
  for (let i = n; i <= solves.length; i++) {
    const a = calc(solves.slice(i - n, i), n);
    if (b == null || a < b) { b = a; at = i - n; }
  }
  best.at = at;
  return b;
}

// ====================== 스크램블 ======================
let worker = null, workerBusy = false, waiting = false;
let queue = (() => { try { return JSON.parse(localStorage.getItem(STASH_KEY)) || []; } catch (e) { return []; } })();
const saveStash = () => { try { localStorage.setItem(STASH_KEY, JSON.stringify(queue.slice(0, 5))); } catch (e) { /* 무시 */ } };
let history = [], hIndex = -1; // 이전/다음 스크램블

function request() {
  if (!worker || workerBusy || queue.length >= 5) return;
  workerBusy = true; worker.postMessage('next');
}
function initWorker() {
  try {
    worker = new Worker('../scramble-worker.js');
    worker.onmessage = (e) => {
      workerBusy = false; queue.push(e.data); saveStash();
      if (waiting) { waiting = false; nextScramble(); }
      request();
    };
    request();
  } catch (e) { worker = null; }
}
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
function nextScramble() {
  if (hIndex < history.length - 1) { hIndex++; renderScramble(); return; }
  let s = null;
  if (queue.length) { s = queue.shift(); saveStash(); request(); }
  else if (worker) { waiting = true; renderScramble(true); return; }
  else s = randomMoveScramble();
  history.push(s); if (history.length > 50) history.shift();
  hIndex = history.length - 1;
  renderScramble();
}
function prevScramble() { if (hIndex > 0) { hIndex--; renderScramble(); } }
const currentScramble = () => (hIndex >= 0 ? history[hIndex] : '');
function renderScramble(loading) {
  const el = $('#scramble');
  el.classList.toggle('hidden', !S().showScr);
  if (loading || !currentScramble()) { el.textContent = 'Generating scramble…'; el.classList.add('loading'); }
  else { el.textContent = currentScramble(); el.classList.remove('loading'); }
}
$('#scramble').addEventListener('click', () => {
  if (currentScramble()) navigator.clipboard?.writeText(currentScramble()).then(() => toast('복사됨')).catch(() => {});
});
$('#nextScr').addEventListener('click', (e) => { e.currentTarget.blur(); nextScramble(); });
$('#prevScr').addEventListener('click', (e) => { e.currentTarget.blur(); prevScramble(); });

// ====================== 소리 ======================
let audio = null;
function unlockAudio() {
  if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } }
  if (audio.state === 'suspended') audio.resume();
}
function beep(freq = 880, dur = 0.09, gain = 0.12, when = 0) {
  if (!S().sound || !audio) return;
  const t = audio.currentTime + when, o = audio.createOscillator(), g = audio.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur + 0.02);
}
const chime = () => { beep(784, .12, .1, 0); beep(988, .12, .1, .1); beep(1319, .22, .1, .2); };

// ====================== 타이머 ======================
let phase = 'idle'; // idle, hold, ready, inspecting, hold-insp, ready-insp, running
let holdTimer = null, startAt = 0, raf = 0, inspStart = 0, inspTimer = null, inspAlerts = {}, pendingPenalty = 0;
const timeEl = $('#time'), subEl = $('#sub'), inspEl = $('#inspLabel');
const setClass = (...c) => { timeEl.className = 'time ' + c.join(' '); };
const setSub = (t, pb) => { subEl.textContent = t; subEl.className = 'sub' + (pb ? ' pb' : ''); };
const IDLE_HINT = () => (S().pcInput === 'typing' ? '시간을 입력하고 Enter' : '스페이스바를 꾹 눌렀다 떼면 시작');

function inspElapsed() { return (performance.now() - inspStart) / 1000; }
function startInspection() {
  phase = 'inspecting'; inspStart = performance.now(); inspAlerts = {};
  document.body.classList.add('running');
  setSub('준비되면 스페이스바를 꾹 누르세요');
  const tick = () => {
    const e = inspElapsed(), left = 15 - Math.floor(e);
    if (phase === 'inspecting') { timeEl.textContent = left > 0 ? left : e < 17 ? '+2' : 'DNF'; setClass('inspecting'); }
    if (e >= 8 && !inspAlerts[8]) { inspAlerts[8] = 1; inspEl.textContent = '8s'; beep(660); }
    if (e >= 12 && !inspAlerts[12]) { inspAlerts[12] = 1; inspEl.textContent = '12s'; beep(880); beep(880, .09, .12, .15); }
  };
  tick(); inspTimer = setInterval(tick, 100);
}
function startSolve() {
  clearInterval(inspTimer);
  pendingPenalty = S().insp ? (inspElapsed() > 17 ? -1 : inspElapsed() > 15 ? 2 : 0) : 0;
  phase = 'running'; startAt = performance.now();
  document.body.classList.add('running');
  inspEl.textContent = ''; setClass(); setSub('');
  if (S().hideRunning) { timeEl.innerHTML = '<span class="solving-dots" aria-label="솔빙 중"><i></i><i></i><i></i></span>'; return; }
  const loop = () => { timeEl.textContent = fmt(performance.now() - startAt); raf = requestAnimationFrame(loop); };
  loop();
}
function stopSolve() {
  const t = Math.round(performance.now() - startAt);
  cancelAnimationFrame(raf);
  phase = 'stopped'; // 같은 키 입력으로 바로 다시 시작되지 않게 잠깐 막음
  setTimeout(() => { if (phase === 'stopped') phase = 'idle'; }, 250);
  document.body.classList.remove('running');
  addSolve({ t, p: pendingPenalty, s: S().showScr ? currentScramble() : '', d: Date.now() });
}
function cancelAll() {
  clearTimeout(holdTimer); clearInterval(inspTimer); cancelAnimationFrame(raf);
  document.body.classList.remove('running');
  inspEl.textContent = '';
  if (phase !== 'idle') { phase = 'idle'; timeEl.textContent = '0.00'; setClass(); setSub(IDLE_HINT()); }
}

function addSolve(solve) {
  const ses = session();
  const prevBest = best(ses.solves, 1), prevAo5 = best(ses.solves, 5);
  ses.solves.push(solve); save();
  timeEl.textContent = fmtSolve(solve);
  const v = value(solve), ao5 = current(ses.solves, 5);
  if (prevBest != null && prevBest !== Infinity && v < prevBest) { setClass('pb'); setSub('🎉 single PB!', true); chime(); }
  else if (prevAo5 != null && ao5 != null && ao5 < prevAo5) { setClass(); setSub('🎉 ao5 PB!', true); chime(); }
  else { setClass(); setSub('Ctrl+1 OK · Ctrl+2 +2 · Ctrl+3 DNF · Ctrl+Z 삭제'); }
  nextScramble();
  renderSide();
}

function press() {
  unlockAudio();
  if (phase === 'running') { stopSolve(); return; }
  if (phase === 'idle' && S().insp) { phase = 'idle-armed'; return; }
  if (phase === 'idle' || phase === 'inspecting') {
    phase = phase === 'inspecting' ? 'hold-insp' : 'hold';
    setClass('holding');
    holdTimer = setTimeout(() => { phase = phase === 'hold-insp' ? 'ready-insp' : 'ready'; setClass('ready'); }, S().pcHoldMs);
  }
}
function release() {
  clearTimeout(holdTimer);
  if (phase === 'idle-armed') { startInspection(); return; }
  if (phase === 'ready' || phase === 'ready-insp') { startSolve(); return; }
  if (phase === 'hold') { phase = 'idle'; setClass(); return; }
  if (phase === 'hold-insp') { phase = 'inspecting'; setClass('inspecting'); }
}

const modalOpen = () => !$('#modalBack').classList.contains('hidden');
const typingInField = (e) => e.target.closest && e.target.closest('input, select, textarea') && e.target.id !== 'timeInput';

document.addEventListener('keydown', (e) => {
  if (modalOpen()) { if (e.key === 'Escape') closeModal(); return; }
  if (typingInField(e)) return;
  // 도는 중: 아무 키나 누르면 정지
  if (phase === 'running') { e.preventDefault(); stopSolve(); return; }
  if (e.key === 'Escape') { cancelAll(); return; }
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (['1', '2', '3', 'z'].includes(k)) { e.preventDefault(); shortcut(k); }
    return;
  }
  if (S().pcInput === 'typing') return;
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) press(); }
});
document.addEventListener('keyup', (e) => {
  if (modalOpen() || typingInField(e) || S().pcInput === 'typing') return;
  if (e.code === 'Space') { e.preventDefault(); release(); }
});
// 마우스: 타이머 영역 누르기 = 스페이스바, 도는 중엔 아무 데나 클릭하면 정지
$('#timerZone').addEventListener('pointerdown', (e) => { if (S().pcInput === 'timer' && e.button === 0 && phase !== 'running') press(); });
$('#timerZone').addEventListener('pointerup', () => { if (S().pcInput === 'timer') release(); });
document.addEventListener('pointerdown', () => { if (phase === 'running') stopSolve(); }, true);

function shortcut(k) {
  const ses = session(), last = ses.solves[ses.solves.length - 1];
  if (!last) return;
  if (k === 'z') {
    if (!confirm(`마지막 기록 ${fmtSolve(last)}을 삭제할까요?`)) return;
    ses.solves.pop(); save(); timeEl.textContent = '0.00'; setClass(); setSub(IDLE_HINT()); renderSide(); toast('삭제됨'); return;
  }
  last.p = k === '1' ? 0 : k === '2' ? 2 : -1;
  save(); timeEl.textContent = fmtSolve(last); renderSide();
}

// ---------- 직접 입력 모드 ----------
// 1234 → 12.34, 12.34, 1:02.34, 12.34+ (+2), DNF
function parseTyped(raw) {
  let s = raw.trim().toUpperCase();
  if (!s) return null;
  if (s === 'DNF') return { t: 0, p: -1 };
  let p = 0;
  if (s.endsWith('+')) { p = 2; s = s.slice(0, -1); }
  let ms;
  if (/^\d+$/.test(s)) {
    const n = s.padStart(3, '0');
    const cs = Number(n.slice(-2)), rest = n.slice(0, -2);
    const sec = Number(rest.slice(-2) || 0), min = Number(rest.slice(0, -2) || 0);
    ms = (min * 60 + sec) * 1000 + cs * 10;
  } else if (/^(\d+:)?\d+(\.\d+)?$/.test(s)) {
    const [a, b] = s.includes(':') ? s.split(':') : ['0', s];
    ms = Math.round((Number(a) * 60 + Number(b)) * 1000);
  } else return null;
  return ms > 0 ? { t: ms, p } : null;
}
$('#timeInput').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const r = parseTyped(e.target.value);
  if (!r) { toast('형식: 1234 / 12.34 / 1:02.34 / 12.34+ / DNF'); return; }
  addSolve({ ...r, s: S().showScr ? currentScramble() : '', d: Date.now() });
  e.target.value = '';
});

// ====================== 사이드바 ======================
function renderSessions() {
  const sel = $('#sessionSelect');
  sel.innerHTML = state.sessions.map((s) => `<option value="${s.id}">${esc(s.name)} (${s.solves.length})</option>`).join('');
  sel.value = state.current;
}
$('#sessionSelect').addEventListener('change', (e) => { state.current = e.target.value; save(); e.target.blur(); resetDisplay(); renderSide(); });

function renderSide() {
  const solves = session().solves;
  const set = (id, v) => { $(id).textContent = fmt(v); };
  set('#cur1', solves.length ? value(solves[solves.length - 1]) : null); set('#best1', best(solves, 1));
  set('#cur3', current(solves, 3)); set('#best3', best(solves, 3));
  set('#cur5', current(solves, 5)); set('#best5', best(solves, 5));
  set('#cur12', current(solves, 12)); set('#best12', best(solves, 12));
  const finite = solves.map(value).filter((v) => v !== Infinity);
  $('#countText').textContent = `솔브: ${finite.length}/${solves.length}`;
  $('#meanText').textContent = `평균: ${finite.length ? fmt(finite.reduce((a, b) => a + b, 0) / finite.length) : '-'}`;
  const bestV = best(solves, 1);
  const rows = [];
  for (let i = solves.length - 1; i >= 0; i--) {
    const x = solves[i];
    rows.push(`<button class="solve-row${value(x) === bestV && bestV !== Infinity ? ' best' : ''}" data-i="${i}" type="button"><span class="i">${i + 1}</span><span class="t">${fmtSolve(x)}</span>${x.c ? '<span class="c">✎</span>' : ''}</button>`);
  }
  $('#solveList').innerHTML = rows.join('') || '<div style="padding:10px;color:var(--faint)">아직 기록이 없어요</div>';
  renderSessions();
}
$('#solveList').addEventListener('click', (e) => { const r = e.target.closest('.solve-row'); if (r) openSolve(Number(r.dataset.i)); });

// 통계 표의 값 클릭 → 그 평균에 들어간 기록 보기
[[1, 'cur'], [3, 'cur'], [5, 'cur'], [12, 'cur'], [3, 'best'], [5, 'best'], [12, 'best']].forEach(([n, kind]) => {
  const el = $(`#${kind}${n}`); if (!el || n === 1) return;
  el.classList.add('click');
  el.addEventListener('click', () => {
    const solves = session().solves;
    if (solves.length < n) return;
    let start = solves.length - n;
    if (kind === 'best') { best(solves, n); start = best.at; }
    openAverage(n, start);
  });
});

// ====================== 창 ======================
function openModal(html, wide) {
  const m = $('#modal'); m.className = 'modal' + (wide ? ' wide' : ''); m.innerHTML = html;
  $('#modalBack').classList.remove('hidden');
}
function closeModal() { $('#modalBack').classList.add('hidden'); $('#modal').innerHTML = ''; }
$('#modalBack').addEventListener('mousedown', (e) => { if (e.target.id === 'modalBack') closeModal(); });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function openSolve(i) {
  const x = session().solves[i]; if (!x) return;
  openModal(`
    <div class="big">${fmtSolve(x)}</div>
    <div class="meta">#${i + 1} · ${new Date(x.d).toLocaleString('ko-KR')}</div>
    ${x.s ? `<div class="scr">${esc(x.s)}</div>` : ''}
    <input type="text" id="comment" placeholder="코멘트" value="${esc(x.c || '')}" style="width:100%">
    <div class="actions">
      <button class="btn ${x.p === 0 ? 'on' : ''}" data-pen="0">OK</button>
      <button class="btn ${x.p === 2 ? 'on' : ''}" data-pen="2">+2</button>
      <button class="btn ${x.p === -1 ? 'on' : ''}" data-pen="-1">DNF</button>
      ${x.s ? '<button class="btn" data-act="copy">스크램블 복사</button>' : ''}
      <button class="btn danger" data-act="del">삭제</button>
      <button class="btn right" data-act="close">닫기</button>
    </div>`);
  const m = $('#modal');
  m.querySelector('#comment').addEventListener('change', (e) => { x.c = e.target.value.trim(); if (!x.c) delete x.c; save(); renderSide(); });
  m.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pen != null) { x.p = Number(b.dataset.pen); save(); renderSide(); openSolve(i); }
    if (b.dataset.act === 'copy') navigator.clipboard?.writeText(x.s).then(() => toast('복사됨')).catch(() => {});
    if (b.dataset.act === 'del' && confirm('이 기록을 삭제할까요?')) { session().solves.splice(i, 1); save(); renderSide(); closeModal(); }
    if (b.dataset.act === 'close') closeModal();
  };
}

function openAverage(n, start) {
  const list = session().solves.slice(start, start + n);
  const v = list.map(value), sorted = [...v].sort((a, b) => a - b), cut = n === 3 ? 0 : Math.ceil(n * 0.05);
  const dropped = new Set(); // 평균에서 뺀 기록 (괄호)
  if (cut) {
    const lows = sorted.slice(0, cut), highs = sorted.slice(n - cut);
    for (const x of [...lows, ...highs]) { const k = v.findIndex((y, j) => y === x && !dropped.has(j)); dropped.add(k); }
  }
  const lines = list.map((x, j) => `<div class="row"><span>${start + j + 1}. ${dropped.has(j) ? `(${fmtSolve(x)})` : fmtSolve(x)}</span><span style="font-family:var(--mono);font-size:12px;color:var(--muted)">${esc(x.s || '')}</span></div>`).join('');
  openModal(`<h2>${n === 3 ? 'mo3' : 'ao' + n}: ${fmt(calc(list, n))}</h2>${lines}<div class="actions"><button class="btn right" data-act="close">닫기</button></div>`, true);
  $('#modal').onclick = (e) => { if (e.target.closest('[data-act="close"]')) closeModal(); };
}

function openSessionMenu() {
  const ses = session();
  openModal(`<h2>세션 관리</h2>
    <div class="row"><span>현재 세션</span><input type="text" id="sesName" value="${esc(ses.name)}"></div>
    <div class="actions">
      <button class="btn" data-act="new">+ 새 세션</button>
      <button class="btn" data-act="rename">이름 저장</button>
      <button class="btn danger" data-act="clear">이 세션 기록 비우기</button>
      <button class="btn danger" data-act="delete">세션 삭제</button>
      <button class="btn right" data-act="close">닫기</button>
    </div>`);
  $('#modal').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'new') { const name = prompt('새 세션 이름', `세션 ${state.sessions.length + 1}`); if (name && name.trim()) { const s = newSession(name.trim()); state.sessions.push(s); state.current = s.id; save(); resetDisplay(); renderSide(); closeModal(); } }
    if (a === 'rename') { const v = $('#sesName').value.trim(); if (v) { ses.name = v; save(); renderSide(); toast('저장됨'); } }
    if (a === 'clear') { if (ses.solves.length && confirm(`"${ses.name}" 기록 ${ses.solves.length}개를 비울까요? 되돌릴 수 없어요.`)) { ses.solves = []; save(); resetDisplay(); renderSide(); closeModal(); } }
    if (a === 'delete') {
      if (state.sessions.length === 1) { toast('세션이 하나뿐이라 지울 수 없어요'); return; }
      if (confirm(`"${ses.name}" 세션과 기록 ${ses.solves.length}개를 삭제할까요?`)) { state.sessions = state.sessions.filter((s) => s !== ses); state.current = state.sessions[0].id; save(); resetDisplay(); renderSide(); closeModal(); }
    }
    if (a === 'close') closeModal();
  };
}
$('#sessionMenuBtn').addEventListener('click', openSessionMenu);

function openStats() {
  const solves = session().solves;
  const cells = [[1, 'single'], [3, 'mo3'], [5, 'ao5'], [12, 'ao12'], [50, 'ao50'], [100, 'ao100'], [1000, 'ao1000']]
    .map(([n, label]) => `<div><span>${label} 현재 / 베스트</span><b>${fmt(n === 1 ? (solves.length ? value(solves.at(-1)) : null) : current(solves, n))}</b> / <b>${fmt(best(solves, n))}</b></div>`).join('');
  const finite = solves.map(value).filter((v) => v !== Infinity);
  const mean = finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null;
  // 그래프 (최근 200개) + 분포
  const recent = solves.slice(-200), pts = recent.map((x, i) => [i, value(x)]).filter((p) => p[1] !== Infinity);
  let chart = '<text x="50%" y="50%" text-anchor="middle" fill="currentColor" opacity=".4" font-size="12">기록이 2개 이상이면 그래프가 그려져요</text>';
  let dist = '';
  if (pts.length > 1) {
    const max = Math.max(...pts.map((p) => p[1])), min = Math.min(...pts.map((p) => p[1])), span = max - min || 1;
    const X = (i) => 8 + (i / Math.max(recent.length - 1, 1)) * 704, Y = (v) => 168 - ((v - min) / span) * 152;
    const ao5 = [];
    for (let i = 4; i < recent.length; i++) { const a = avgOf(recent.slice(i - 4, i + 1)); if (a !== Infinity) ao5.push(`${X(i).toFixed(1)},${Y(Math.min(Math.max(a, min), max)).toFixed(1)}`); }
    chart = `<polyline points="${pts.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".45"/>` +
      (ao5.length > 1 ? `<polyline points="${ao5.join(' ')}" fill="none" stroke="var(--green)" stroke-width="2"/>` : '') +
      `<text x="714" y="14" text-anchor="end" font-size="11" fill="currentColor" opacity=".5">${fmt(max)}</text><text x="714" y="176" text-anchor="end" font-size="11" fill="currentColor" opacity=".5">${fmt(min)}</text>`;
    // 1초 단위 분포
    const buckets = {};
    finite.forEach((v) => { const k = Math.floor(v / 1000); buckets[k] = (buckets[k] || 0) + 1; });
    const keys = Object.keys(buckets).map(Number).sort((a, b) => a - b), top = Math.max(...Object.values(buckets));
    dist = keys.map((k) => `<div style="display:flex;gap:8px;align-items:center;font-variant-numeric:tabular-nums"><span style="width:60px;color:var(--muted)">${k}s</span><span style="height:10px;background:var(--text);opacity:.6;border-radius:2px;width:${(buckets[k] / top) * 70}%"></span><span style="color:var(--muted)">${buckets[k]}</span></div>`).join('');
  }
  openModal(`<h2>통계 · ${esc(session().name)}</h2>
    <div class="grid">${cells}<div><span>전체 평균</span><b>${fmt(mean)}</b></div></div>
    <svg class="chart" viewBox="0 0 720 184" preserveAspectRatio="none">${chart}</svg>
    <p class="hint">회색: 기록 · 초록: ao5 (최근 200개)</p>
    ${dist ? `<h2 style="margin-top:16px">분포</h2>${dist}` : ''}
    <div class="actions"><button class="btn right" data-act="close">닫기</button></div>`, true);
  $('#modal').onclick = (e) => { if (e.target.closest('[data-act="close"]')) closeModal(); };
}
$('#statsBtn').addEventListener('click', (e) => { e.currentTarget.blur(); openStats(); });

function openSettings() {
  const s = S();
  const tog = (key, label) => `<div class="row"><span>${label}</span><input type="checkbox" data-k="${key}" ${s[key] ? 'checked' : ''}></div>`;
  openModal(`<h2>설정</h2>
    ${tog('insp', 'WCA 15s Inspection')}
    ${tog('hideRunning', '솔빙 중 타이머 숨기기')}
    ${tog('showScr', '스크램블 보기')}
    ${tog('sound', '소리')}
    <div class="row"><span>입력 방식</span><select data-k="pcInput"><option value="timer">타이머 (스페이스바)</option><option value="typing">직접 입력</option></select></div>
    <div class="row"><span>시작 전 누르고 있는 시간</span><select data-k="pcHoldMs"><option value="0">바로</option><option value="300">0.3초</option><option value="550">0.55초</option><option value="1000">1초</option></select></div>
    <div class="row"><span>소수점</span><select data-k="pcDecimals"><option value="2">0.01초</option><option value="3">0.001초</option></select></div>
    <div class="row"><span>테마</span><select data-k="pcTheme"><option value="system">시스템</option><option value="light">라이트</option><option value="dark">다크</option></select></div>
    <p class="hint">WCA 15s Inspection: 솔빙 전 15초 동안 큐브를 살펴볼 수 있어요. 15초를 넘기면 +2, 17초를 넘기면 DNF예요.<br>직접 입력: 1234 → 12.34, 1:02.34, 12.34+ (+2), DNF</p>
    <p class="hint">cubetimer PC ${VERSION} · 스크램블: cubejs (MIT)</p>
    <div class="actions"><button class="btn right" data-act="close">닫기</button></div>`);
  const m = $('#modal');
  m.querySelectorAll('select[data-k]').forEach((el) => { el.value = String(s[el.dataset.k]); });
  m.addEventListener('change', (e) => {
    const el = e.target, k = el.dataset.k; if (!k) return;
    s[k] = el.type === 'checkbox' ? el.checked : (['pcHoldMs', 'pcDecimals'].includes(k) ? Number(el.value) : el.value);
    save(); applyTheme(); applyInputMode(); renderScramble(); renderSide();
    if (phase === 'idle' && !timeEl.querySelector('.solving-dots')) { const last = session().solves.at(-1); timeEl.textContent = last ? fmtSolve(last) : '0.00'; }
  });
  m.onclick = (e) => { if (e.target.closest('[data-act="close"]')) closeModal(); };
}
$('#settingsBtn').addEventListener('click', (e) => { e.currentTarget.blur(); openSettings(); });

function applyTheme() {
  const t = S().pcTheme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
function applyInputMode() {
  const typing = S().pcInput === 'typing';
  $('#timeInput').classList.toggle('hidden', !typing);
  timeEl.classList.toggle('hidden', typing);
  if (typing) $('#timeInput').focus();
  if (phase === 'idle') setSub(IDLE_HINT());
}
function resetDisplay() { cancelAll(); timeEl.textContent = '0.00'; setClass(); setSub(IDLE_HINT()); }

// ====================== 백업 ======================
function exportBackup() {
  const data = { app: 'cubetimer', version: 1, exportedAt: new Date().toISOString(), sessions: state.sessions, current: state.current, settings: state.settings };
  const d = new Date();
  const name = `cubetimer-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  state.lastBackup = Date.now(); state.solvesAtBackup = state.sessions.reduce((n, s) => n + s.solves.length, 0); save();
  toast('백업 완료');
}
$('#exportBtn').addEventListener('click', (e) => { e.currentTarget.blur(); exportBackup(); });
$('#importBtn').addEventListener('click', (e) => { e.currentTarget.blur(); $('#importFile').click(); });
$('#importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const incoming = parseBackup(JSON.parse(await f.text()));
    if (!incoming.length) { toast('가져올 기록이 없어요'); return; }
    const count = incoming.reduce((n, s) => n + s.solves.length, 0);
    if (!confirm(`세션 ${incoming.length}개, 기록 ${count}개를 가져올까요?\n같은 이름 세션에 합치고, 중복 기록은 건너뛰어요.`)) return;
    let added = 0;
    for (const inc of incoming) {
      let target = state.sessions.find((s) => s.name === inc.name);
      if (!target) { target = newSession(inc.name); state.sessions.push(target); }
      const seen = new Set(target.solves.map((x) => x.d + ':' + x.t));
      for (const x of inc.solves) if (!seen.has(x.d + ':' + x.t)) { target.solves.push(x); added++; }
      target.solves.sort((a, b) => a.d - b.d);
    }
    save(); renderSide(); toast(`${added}개 가져옴`);
  } catch (err) { toast('파일을 읽지 못했어요'); }
});
function parseBackup(data) {
  if (data && data.app === 'cubetimer' && Array.isArray(data.sessions)) {
    return data.sessions.map((s) => ({
      name: String(s.name || '가져온 세션'),
      solves: (s.solves || []).filter((x) => typeof x.t === 'number').map((x) => {
        const o = { t: x.t, p: x.p === 2 || x.p === -1 ? x.p : 0, s: String(x.s || ''), d: Number(x.d) || Date.now() };
        if (x.c) o.c = String(x.c);
        return o;
      }),
    }));
  }
  if (data && typeof data === 'object' && Object.keys(data).some((k) => /^session\d+$/.test(k))) {
    const names = {};
    try {
      const sd = data.properties && data.properties.sessionData;
      const parsed = typeof sd === 'string' ? JSON.parse(sd) : sd;
      for (const k in parsed || {}) names[k] = parsed[k] && parsed[k].name;
    } catch (e) { /* 이름 없으면 기본 */ }
    const out = [];
    for (const k of Object.keys(data)) {
      const m = k.match(/^session(\d+)$/); if (!m) continue;
      let list = data[k];
      if (typeof list === 'string') { try { list = JSON.parse(list); } catch (e) { continue; } }
      if (!Array.isArray(list) || !list.length) continue;
      out.push({
        name: `csTimer ${names[m[1]] != null ? names[m[1]] : m[1]}`,
        solves: list.filter((x) => Array.isArray(x) && Array.isArray(x[0])).map((x) => {
          const o = { t: Number(x[0][1]) || 0, p: x[0][0] === -1 ? -1 : x[0][0] === 2000 ? 2 : 0, s: String(x[1] || ''), d: (Number(x[3]) || 0) * 1000 || Date.now() };
          if (x[2]) o.c = String(x[2]);
          return o;
        }),
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
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 1600);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (phase === 'hold' || phase === 'ready')) { clearTimeout(holdTimer); phase = 'idle'; setClass(); }
});

// 오프라인: 폰 버전과 같은 서비스 워커 사용
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && phase === 'idle' && !modalOpen()) location.reload(); });
  addEventListener('load', () => navigator.serviceWorker.register('../sw.js').catch(() => {}));
}

function renderAll() { renderSide(); renderScramble(); applyInputMode(); }

applyTheme();
renderAll();
initWorker();
nextScramble();
setSub(IDLE_HINT());
