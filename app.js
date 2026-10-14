import {
  METHODS, parseDate, formatDate, addDays, validateInput, buildTimeline, buildIcs, speedCheck,
} from './calc.js';

const $ = (id) => document.getElementById(id);
const won = (n) => `${n.toLocaleString('ko-KR')}원`;
const ym = ({ y, m }) => `${y}년 ${m}월`;

// 사용자 입력은 textContent로만 화면에 넣는다(innerHTML 쓰지 않음).
function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

function row(cells) {
  const tr = document.createElement('tr');
  for (const c of cells) tr.append(el('td', c));
  return tr;
}

let state = null;

// 빈 칸은 0이 아니라 '입력 없음'(NaN)으로 본다.
const num = (id) => { const v = $(id).value.trim(); return v === '' ? NaN : Number(v); };

function readInput() {
  return {
    start: parseDate($('start').value),
    months: num('months'),
    promoFee: num('promo'),
    regularFee: num('regular'),
  };
}

function renderTimeline() {
  const t = buildTimeline({ ...state.input, method: $('method').value });
  const body = $('timeline');
  body.replaceChildren();
  for (const r of t.rows) {
    let detail = '정상 요금';
    if (r.promoDays === 0 && r.regularDays === 0) detail = '개통 전';
    else if (r.regularDays === 0) detail = r.promoDays === r.days ? '할인' : `할인 ${r.promoDays}일`;
    else if (r.promoDays > 0) detail = `할인 ${r.promoDays}일 + 정상 ${r.regularDays}일`;
    else if (r.regularDays < r.days) detail = `정상 ${r.regularDays}일`;
    body.append(row([ym(r), won(r.amount), detail]));
  }
}

function render(input) {
  state = { input, results: {} };
  const body = $('methods');
  body.replaceChildren();
  for (const [id, meta] of Object.entries(METHODS)) {
    const t = buildTimeline({ ...input, method: id });
    state.results[id] = t;
    body.append(row([meta.label, formatDate(t.end), t.firstFullRegularMonth ? ym(t.firstFullRegularMonth) : '-']));
  }
  const diff = input.regularFee - input.promoFee;
  $('increase').textContent = diff > 0
    ? `할인이 끝나면 매달 ${won(diff)} 더 냅니다(1년이면 ${won(diff * 12)}).`
    : '할인 끝난 뒤 요금이 할인 중 요금보다 높지 않습니다. 입력값을 다시 확인하세요.';
  renderTimeline();
  $('result').hidden = false;
}

function onSubmit(e) {
  e.preventDefault();
  const input = readInput();
  const errors = validateInput(input);
  const list = $('errors');
  list.replaceChildren(...errors.map((m) => el('li', m)));
  if (errors.length) return;
  render(input);
}

function downloadIcs() {
  if (!state) return;
  const id = $('method').value;
  const end = state.results[id].end;
  const before = Math.min(60, Math.max(0, Math.trunc(Number($('before').value) || 0)));
  const remindDate = addDays(end, -before);
  const now = new Date();
  const today = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  $('ics-note').textContent = formatDate(remindDate) < formatDate(today)
    ? `알림 날짜(${formatDate(remindDate)})가 이미 지났습니다. 그래도 파일은 만들었습니다.`
    : `알림 날짜: ${formatDate(remindDate)}`;
  const ics = buildIcs({ remindDate, end, methodLabel: METHODS[id].label, regularFee: state.input.regularFee });
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = el('a');
  a.href = url;
  a.download = `할인종료-${formatDate(end)}.ics`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderSpeeds() {
  const v = Number($('speed').value);
  const list = $('speeds');
  if (!Number.isFinite(v) || v < 0) { list.replaceChildren(el('li', '0 이상의 숫자를 넣어 주세요.')); return; }
  list.replaceChildren(...speedCheck(v).map((s) =>
    el('li', `${s.ok ? '가능' : '끊길 수 있음'} · 유튜브 ${s.quality} (권장 ${s.mbps}Mbps)`, s.ok ? 'ok' : 'no')));
}

function init() {
  const select = $('method');
  for (const [id, meta] of Object.entries(METHODS)) {
    const o = el('option', meta.label);
    o.value = id;
    select.append(o);
  }
  $('form').addEventListener('submit', onSubmit);
  select.addEventListener('change', () => state && renderTimeline());
  $('ics').addEventListener('click', downloadIcs);
  $('speed').addEventListener('input', renderSpeeds);
  renderSpeeds();
}

init();
