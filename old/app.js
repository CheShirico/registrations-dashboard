'use strict';

/* ---------- утилиты ---------- */
const $ = (s, r = document) => r.querySelector(s);
const SVG_TAGS = new Set(['svg', 'g', 'rect', 'text', 'line']);

function el(tag, attrs = {}, ...kids) {
  const e = SVG_TAGS.has(tag) ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  kids.flat().forEach((c) => c != null && e.append(c));
  return e;
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* недоступно */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* недоступно */ } },
};

/* ---------- разбор CSV ---------- */
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const REQUIRED = ['name', 'city', 'registered', 'source', 'ticket', 'paid'];
const YES = new Set(['да', 'yes', 'true', '1', 'y', 'оплачено']);

function toRecords(text) {
  const table = parseCSV(text);
  if (table.length < 2) throw new Error('В файле нет строк с данными.');
  const head = table[0].map((h) => h.trim().toLowerCase());
  const miss = REQUIRED.filter((c) => !head.includes(c));
  if (miss.length) throw new Error('Не найдены столбцы: ' + miss.join(', ') + '. Нужны: ' + REQUIRED.join(', ') + '.');
  const ix = Object.fromEntries(REQUIRED.map((c) => [c, head.indexOf(c)]));
  let badDates = 0;
  const rows = table.slice(1).map((r) => {
    const g = (c) => (r[ix[c]] ?? '').trim();
    const registered = g('registered');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(registered)) badDates++;
    return {
      name: g('name') || '(без имени)', city: g('city') || '(не указан)', registered,
      source: g('source') || '(не указан)', ticket: g('ticket') || '(не указан)',
      paid: YES.has(g('paid').toLowerCase()),
    };
  });
  return { rows, badDates };
}

/* ---------- состояние ---------- */
let ALL = [];
const F = { city: '', source: '', ticket: '', paid: '', q: '', from: '', to: '' };
let sortKey = 'registered', sortDir = -1;

function pass(r, skip) {
  const q = F.q.toLowerCase();
  return (skip === 'city' || !F.city || r.city === F.city)
    && (skip === 'source' || !F.source || r.source === F.source)
    && (skip === 'ticket' || !F.ticket || r.ticket === F.ticket)
    && (!F.paid || r.paid === (F.paid === 'yes'))
    && (!F.from || r.registered >= F.from)
    && (!F.to || r.registered <= F.to)
    && (!q || r.name.toLowerCase().includes(q));
}
const anyFilter = () => Object.values(F).some(Boolean);

const fmtFull = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(8) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4) : d || '—');
const fmtDay = (d) => d.slice(8) + '.' + d.slice(5, 7);
const byRu = (a, b) => String(a).localeCompare(String(b), 'ru');

/* ---------- подсказка ---------- */
const tipEl = $('#tip');
function showTip(lines, ev) {
  tipEl.replaceChildren(el('b', { text: lines[0] }), ...lines.slice(1).map((s) => el('div', { text: s })));
  tipEl.hidden = false;
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  const x = Math.min(Math.max(ev.clientX - w / 2, 8), window.innerWidth - w - 8);
  const y = ev.clientY - h - 14 < 8 ? ev.clientY + 18 : ev.clientY - h - 14;
  tipEl.style.left = x + 'px';
  tipEl.style.top = y + 'px';
}
const hideTip = () => { tipEl.hidden = true; };

/* ---------- фильтры ---------- */
const SELECTS = [['city', 'Все города'], ['source', 'Все источники'], ['ticket', 'Все билеты']];

function buildOptions() {
  for (const [key, all] of SELECTS) {
    const vals = [...new Set(ALL.map((r) => r[key]))].sort(byRu);
    $('#f-' + key).replaceChildren(el('option', { value: '', text: all }), ...vals.map((v) => el('option', { value: v, text: v })));
  }
}

function syncControls() {
  for (const [key] of SELECTS) $('#f-' + key).value = F[key];
  $('#f-paid').value = F.paid;
  $('#f-from').value = F.from;
  $('#f-to').value = F.to;
  if (document.activeElement !== $('#f-q')) $('#f-q').value = F.q;
  $('#reset').hidden = !anyFilter();
}

function setFilter(k, v) { F[k] = v; render(); }

for (const [key] of SELECTS) $('#f-' + key).addEventListener('change', (e) => setFilter(key, e.target.value));
$('#f-paid').addEventListener('change', (e) => setFilter('paid', e.target.value));
$('#f-from').addEventListener('change', (e) => setFilter('from', e.target.value));
$('#f-to').addEventListener('change', (e) => setFilter('to', e.target.value));
$('#f-q').addEventListener('input', (e) => setFilter('q', e.target.value.trim()));
$('#reset').addEventListener('click', () => { Object.keys(F).forEach((k) => (F[k] = '')); render(); });

/* ---------- показатели ---------- */
function renderKpis(rows) {
  const paid = rows.filter((r) => r.paid).length;
  const pct = rows.length ? Math.round((100 * paid) / rows.length) : 0;
  const cities = new Set(rows.map((r) => r.city)).size;
  const vip = rows.filter((r) => r.ticket === 'VIP').length;
  const tile = (l, v, s) => el('div', { class: 'kpi' }, el('span', { class: 'l', text: l }), el('span', { class: 'v', text: String(v) }), el('span', { class: 's', text: s }));
  $('#kpis').replaceChildren(
    tile('Регистраций', rows.length, 'из ' + ALL.length + ' всего'),
    tile('Оплатили', paid, pct + '% от выбранных'),
    tile('Не оплатили', rows.length - paid, 'ждут оплаты'),
    tile('Билеты VIP', vip, 'среди выбранных'),
    tile('Городов', cities, 'среди выбранных'),
  );

  const top = (k) => {
    const m = new Map();
    rows.forEach((r) => m.set(r[k], (m.get(r[k]) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1] || byRu(a[0], b[0]))[0];
  };
  const ts = top('source'), tc = top('city');
  const lead = $('#lead');
  if (!rows.length) { lead.textContent = ALL.length ? 'По выбранным фильтрам участников нет.' : 'Нет данных. Загрузите файл CSV.'; return; }
  lead.replaceChildren(
    'Регистраций: ', el('b', { text: rows.length }), ', оплатили ', el('b', { text: pct + '%' }),
    '. Основной канал — ', el('b', { text: ts[0] }), ' (' + ts[1] + '), основной город — ', el('b', { text: tc[0] }), ' (' + tc[1] + ').',
    anyFilter() ? ' Цифры показаны для выбранных фильтров.' : '',
  );
}

/* ---------- график по дням ---------- */
function dayRange() {
  const ds = ALL.map((r) => r.registered).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!ds.length) return [];
  const out = [];
  for (let t = Date.parse(ds[0]); t <= Date.parse(ds[ds.length - 1]); t += 864e5) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

function weekStart(d) {
  const t = new Date(Date.parse(d));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

function renderDaily(rows) {
  const box = $('#chart-daily');
  box.replaceChildren();
  let days = dayRange();
  if (!days.length) { box.append(el('div', { class: 'empty', text: 'Нет данных с корректными датами.' })); return; }
  const weekly = days.length > 62;
  const key = weekly ? weekStart : (d) => d;
  const buckets = [...new Set(days.map(key))];
  const data = buckets.map((b) => ({ day: b, n: 0, paid: 0 }));
  const idx = new Map(data.map((d, i) => [d.day, i]));
  rows.forEach((r) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.registered)) return;
    const o = data[idx.get(key(r.registered))];
    o.n++; if (r.paid) o.paid++;
  });

  const W = Math.max(box.clientWidth, 300), H = 250, m = { t: 10, r: 8, b: 30, l: 30 };
  const x = (i) => m.l + (i * (W - m.l - m.r)) / data.length;
  const step = (W - m.l - m.r) / data.length;
  const bw = Math.max(step * 0.72, 2);
  const ymax = Math.max(1, ...data.map((d) => d.n));
  const tickStep = Math.max(1, Math.ceil(ymax / 4));
  const top = Math.ceil(ymax / tickStep) * tickStep;
  const y = (v) => H - m.b - (v / top) * (H - m.b - m.t);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Число регистраций ' + (weekly ? 'по неделям' : 'по дням') + ': оплаченные и неоплаченные' });
  for (let v = 0; v <= top; v += tickStep) {
    svg.append(el('line', { class: 'grid', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
    svg.append(el('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end', text: v }));
  }
  const every = Math.max(1, Math.ceil(46 / step));
  data.forEach((d, i) => {
    if (i % every === 0) svg.append(el('text', { x: x(i) + step / 2, y: H - m.b + 17, 'text-anchor': 'middle', text: fmtDay(d.day) }));
    const bx = x(i) + (step - bw) / 2;
    if (d.paid) svg.append(el('rect', { x: bx, y: y(d.paid), width: bw, height: y(0) - y(d.paid), rx: 2, fill: 'var(--paid)' }));
    if (d.n - d.paid) {
      const h = y(d.paid) - y(d.n) - (d.paid ? 2 : 0);
      svg.append(el('rect', { x: bx, y: y(d.n), width: bw, height: Math.max(h, 1), rx: 2, fill: 'var(--unpaid)' }));
    }
    const label = weekly ? 'Неделя с ' + fmtFull(d.day) : fmtFull(d.day);
    svg.append(el('rect', {
      x: x(i), y: m.t, width: step, height: H - m.t - m.b, fill: 'transparent',
      onmousemove: (ev) => showTip([label, 'Регистраций: ' + d.n, 'Оплатили: ' + d.paid, 'Не оплатили: ' + (d.n - d.paid)], ev),
      onmouseleave: hideTip,
    }));
  });
  box.append(svg);
}

/* ---------- горизонтальные столбцы по признаку ---------- */
const measureCtx = document.createElement('canvas').getContext('2d');
function textW(s) { measureCtx.font = '12px system-ui, sans-serif'; return measureCtx.measureText(s).width; }

function renderDim(key, boxSel) {
  const box = $(boxSel);
  box.replaceChildren();
  const m = new Map();
  ALL.filter((r) => pass(r, key)).forEach((r) => {
    const o = m.get(r[key]) || { k: r[key], n: 0, paid: 0 };
    o.n++; if (r.paid) o.paid++;
    m.set(o.k, o);
  });
  const list = [...m.values()].sort((a, b) => b.n - a.n || byRu(a.k, b.k));
  if (!list.length) { box.append(el('div', { class: 'empty', text: 'Нет данных по выбранным фильтрам' })); return; }

  const W = Math.max(box.clientWidth, 260), rh = 30, H = list.length * rh + 4;
  const lw = Math.min(Math.max(...list.map((d) => textW(d.k))) + 14, W * 0.45);
  const max = Math.max(...list.map((d) => d.n));
  const sx = (v) => (v / max) * Math.max(W - lw - 36, 20);
  const cur = F[key];
  const toggle = (d) => setFilter(key, d.k === cur ? '' : d.k);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': 'Регистрации: оплаченные и неоплаченные' });
  list.forEach((d, i) => {
    const g = el('g', {
      class: 'row', transform: `translate(0,${i * rh + 2})`, tabindex: 0, role: 'button', 'aria-pressed': String(d.k === cur),
      'aria-label': d.k + ': ' + d.n, style: cur && d.k !== cur ? 'opacity:.4' : null,
      onclick: () => toggle(d),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(d); } },
      onmousemove: (ev) => showTip([d.k, 'Всего: ' + d.n, 'Оплатили: ' + d.paid, 'Не оплатили: ' + (d.n - d.paid)], ev),
      onmouseleave: hideTip,
    });
    const un = d.n - d.paid;
    g.append(
      el('rect', { class: 'hit', x: -4, width: W + 8, height: rh, rx: 4 }),
      el('text', { class: 'lab', x: 0, y: rh / 2 + 4, text: d.k }),
    );
    if (d.paid) g.append(el('rect', { x: lw, y: 8, width: sx(d.paid), height: 14, rx: 3, fill: 'var(--paid)' }));
    if (un) g.append(el('rect', { x: lw + sx(d.paid) + (d.paid ? 2 : 0), y: 8, width: Math.max(sx(un) - (d.paid ? 2 : 0), 2), height: 14, rx: 3, fill: 'var(--unpaid)' }));
    g.append(el('text', { x: lw + sx(d.n) + 7, y: rh / 2 + 4, text: d.n }));
    svg.append(g);
  });
  box.append(svg);
}

/* ---------- таблица ---------- */
function renderTable(rows) {
  const sorted = rows.slice().sort((a, b) => {
    const A = sortKey === 'paid' ? +a.paid : a[sortKey], B = sortKey === 'paid' ? +b.paid : b[sortKey];
    const c = typeof A === 'number' ? A - B : byRu(A, B);
    return sortDir * c || byRu(a.name, b.name);
  });
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.setAttribute('aria-sort', th.dataset.sort === sortKey ? (sortDir < 0 ? 'descending' : 'ascending') : 'none');
  });
  $('#count').textContent = 'Показано ' + rows.length + ' из ' + ALL.length;
  const tb = $('#tbody');
  if (!sorted.length) {
    tb.replaceChildren(el('tr', {}, el('td', { class: 'none', colspan: 6, text: 'Нет участников по выбранным фильтрам' })));
    return;
  }
  const pill = (t, c) => el('span', { class: 'pill ' + c, text: t });
  tb.replaceChildren(...sorted.map((r) => el('tr', {},
    el('td', { text: r.name }),
    el('td', { text: r.city }),
    el('td', { text: fmtFull(r.registered) }),
    el('td', { text: r.source }),
    el('td', {}, r.ticket === 'VIP' ? pill(r.ticket, 'vip') : r.ticket),
    el('td', {}, r.paid ? pill('✓ Оплачено', 'ok') : pill('○ Не оплачено', 'no')),
  )));
}

document.querySelectorAll('th[data-sort]').forEach((th) => {
  const go = () => {
    if (sortKey === th.dataset.sort) sortDir = -sortDir; else { sortKey = th.dataset.sort; sortDir = 1; }
    render();
  };
  th.addEventListener('click', go);
  th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
});

/* ---------- общий рендер ---------- */
function render() {
  syncControls();
  const rows = ALL.filter((r) => pass(r));
  renderKpis(rows);
  renderDaily(rows);
  renderDim('source', '#chart-source');
  renderDim('city', '#chart-city');
  renderDim('ticket', '#chart-ticket');
  renderTable(rows);
}

let lastW = 0;
new ResizeObserver(() => {
  const w = $('#app').clientWidth;
  if (w !== lastW) { lastW = w; if (ALL.length) { hideTip(); render(); } }
}).observe($('#app'));

/* ---------- загрузка данных ---------- */
function notice(text, ok) {
  const n = $('#notice');
  n.hidden = !text;
  n.className = 'notice' + (ok ? ' ok' : '');
  n.textContent = text || '';
}

function loadText(text, label, persist) {
  try {
    const { rows, badDates } = toRecords(text);
    ALL = rows;
    Object.keys(F).forEach((k) => (F[k] = ''));
    buildOptions();
    render();
    if (persist) store.set('rg.csv', text); else store.del('rg.csv');
    notice(label + ': загружено строк — ' + rows.length + (badDates ? '. Строк с некорректной датой: ' + badDates + ' (их нет на графике по дням).' : '.'), !badDates);
  } catch (e) {
    notice('Не удалось загрузить файл. ' + e.message);
  }
}

function loadFile(file) {
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => loadText(String(rd.result), file.name, true);
  rd.onerror = () => notice('Не удалось прочитать файл.');
  rd.readAsText(file, 'utf-8');
}

$('#file').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
$('#sample').addEventListener('click', () => loadText(window.SAMPLE_CSV, 'Пример данных', false));

let dragDepth = 0;
addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; document.body.classList.add('drag'); } });
addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('drag'); });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('drag'); loadFile(e.dataTransfer.files[0]); });

/* ---------- экспорт выборки ---------- */
$('#export').addEventListener('click', () => {
  const esc = (s) => (/[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  const rows = ALL.filter((r) => pass(r));
  const csv = [REQUIRED.join(','), ...rows.map((r) => [r.name, r.city, r.registered, r.source, r.ticket, r.paid ? 'да' : 'нет'].map(esc).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = el('a', { href: url, download: 'registrations-selection.csv' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

/* ---------- старт ---------- */
(function start() {
  const saved = store.get('rg.csv');
  if (saved) loadText(saved, 'Последний загруженный файл', true);
  else loadText(window.SAMPLE_CSV, 'Пример данных (registrations.csv)', false);
})();
