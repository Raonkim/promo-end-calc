import {
  METHODS, parseDate, formatDate, addDays, validateInput, buildTimeline, buildIcs, speedCheck, reminderText, pickReminderEnd,
} from './calc.js';

const $ = (id) => document.getElementById(id);
const won = (n) => `${n.toLocaleString('ko-KR')}원`;
const ym = ({ y, m }) => `${y}년 ${m}월`;
const kdate = ({ y, m, d }) => `${y}년 ${m}월 ${d}일`;

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
  // 사용자가 가장 먼저 알아야 할 것: 빠르면 언제 끝나는가. 놓치지 않도록 가장 이른 날을 기본 기준으로 둔다.
  const ends = Object.entries(state.results).map(([id, t]) => ({ id, end: formatDate(t.end) })).sort((a, b) => (a.end < b.end ? -1 : 1));
  const first = ends[0], last = ends[ends.length - 1];
  // 이미 지난 후보는 건너뛰고, 오늘 이후 가장 이른 날을 기준으로 삼는다.
  const now = new Date();
  const pick = pickReminderEnd(Object.values(state.results).map((t) => t.end), { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
  state.earliest = pick.end;
  $('headline').textContent = kdate(pick.end);
  if (pick.allPast) {
    $('range').textContent = '세 가지 계산 모두 이미 지난 날짜입니다. 할인이 이미 끝났을 수 있으니 가입한 회사에 확인하세요.';
  } else if (formatDate(pick.end) !== first.end) {
    $('range').textContent = `세는 방법에 따라 ${kdate(pick.earliest)}에 이미 끝났을 수도 있습니다. 아직 남은 날 중 가장 이른 날을 보여 드립니다(늦으면 ${kdate(state.results[last.id].end)}).`;
  } else {
    $('range').textContent = first.end === last.end
      ? '세는 방법과 상관없이 같은 날입니다.'
      : `세는 방법에 따라 늦으면 ${kdate(state.results[last.id].end)}까지일 수 있습니다. 놓치지 않도록 가장 이른 날을 보여 드립니다.`;
  }
  $('method').value = Object.keys(state.results).find((id) => formatDate(state.results[id].end) === formatDate(pick.end)) || first.id;
  $('reminder').value = reminderText(state.earliest, input.promoFee, input.regularFee);
  $('copy-note').textContent = '';
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
  // 알림은 오늘 이후 가장 이른 종료일 기준(놓치는 쪽보다 일찍 아는 쪽이 낫다)
  const end = state.earliest;
  const before = Math.min(60, Math.max(0, Math.trunc(Number($('before').value) || 0)));
  const now = new Date();
  const today = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  // 종료일은 남았는데 'N일 전'이 이미 지났으면 오늘로 당긴다. 종료일까지 지났으면 그대로 두고 알린다.
  let remindDate = addDays(end, -before);
  const pulled = formatDate(remindDate) < formatDate(today) && formatDate(end) >= formatDate(today);
  if (pulled) remindDate = today;
  $('ics-note').textContent = formatDate(end) < formatDate(today)
    ? `종료일(${formatDate(end)})이 이미 지났습니다. 그래도 파일은 만들었습니다.`
    : pulled
      ? `${before}일 전은 이미 지나서 오늘(${kdate(today)}) 오전 9시 알림을 넣었습니다. 달력에 추가한 뒤 알림이 설정됐는지 확인하세요.`
      : `${kdate(remindDate)} 오전 9시 알림을 넣은 파일을 만들었습니다. 파일을 열어 달력에 추가한 뒤, 달력 앱에 알림이 설정됐는지 꼭 확인하세요(앱에 따라 알림이 빠질 수 있습니다).`;
  const ics = buildIcs({ remindDate, end, methodLabel: '가장 이른 날', regularFee: state.input.regularFee });
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = el('a');
  a.href = url;
  a.download = `할인종료-${formatDate(end)}.ics`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyReminder() {
  const input = $('reminder');
  try {
    await navigator.clipboard.writeText(input.value);
    $('copy-note').textContent = '복사했습니다.';
  } catch {
    // 클립보드 권한이 없는 환경(앱 안 브라우저 등): 글자를 선택해 두어 길게 눌러 복사하게 한다
    input.focus();
    input.select();
    $('copy-note').textContent = '문구를 선택해 두었습니다. 길게 눌러 복사하세요.';
  }
}

// 카카오톡·네이버·인스타그램·페이스북·라인 앱 안 브라우저
const IN_APP = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\//i;

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
  $('copy').addEventListener('click', copyReminder);
  $('inapp').hidden = !IN_APP.test(navigator.userAgent);
  $('speed').addEventListener('input', renderSpeeds);
  renderSpeeds();
}

init();
