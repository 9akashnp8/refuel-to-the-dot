import { parseNum, computeRefuel, sumFills } from './calc.js';

const STORE_KEY = 'refuel-to-the-dot:v1';
const MIN_SEGMENTS = 2;
const MAX_SEGMENTS = 20;
const DEFAULT_SEGMENTS = 8;

const DEFAULTS = {
  tank: '',
  segments: String(DEFAULT_SEGMENTS),
  efficiency: '',
  effUnit: 'kmpl',
  pickupOdo: '',
  pickupLevel: null,
  nowOdo: '',
  remainingKm: '',
  nowLevel: null,
  price: '',
  currency: '',
  margin: '0.5',
  fills: [],
};

// Fields kept when starting a new trip (they belong to you, not the car).
const KEEP_ON_RESET = ['effUnit', 'price', 'currency', 'margin'];

const TEXT_FIELDS = ['tank', 'segments', 'efficiency', 'pickupOdo', 'nowOdo', 'remainingKm', 'price', 'currency', 'margin'];

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      return { ...structuredClone(DEFAULTS), ...saved, fills: Array.isArray(saved.fills) ? saved.fills : [] };
    }
  } catch {
    // Storage unavailable or corrupt: start fresh.
  }
  return structuredClone(DEFAULTS);
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // Private mode etc. The app still works for this session.
  }
}

let state = load();

const $ = (id) => document.getElementById(id);

// ---------- formatting ----------

function fmt(n, digits = 1) {
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function money(n) {
  const cur = (state.currency || '').trim();
  const num = Math.round(n).toLocaleString();
  if (!cur) return num;
  return /^[A-Za-z]{2,}$/.test(cur) ? `${cur} ${num}` : `${cur}${num}`;
}

const FRACTIONS = { 0: 'E', 0.25: '¼', 0.5: '½', 0.75: '¾', 1: 'F' };

function fractionLabel(level, segments) {
  const f = level / segments;
  for (const [k, v] of Object.entries(FRACTIONS)) {
    if (Math.abs(f - Number(k)) < 1e-9) return v;
  }
  return null;
}

function effSegments() {
  const n = Math.round(parseNum(state.segments));
  return n >= MIN_SEGMENTS && n <= MAX_SEGMENTS ? n : DEFAULT_SEGMENTS;
}

// ---------- gauge pickers ----------

function setupGauge(el) {
  const key = el.dataset.gauge;
  el.querySelectorAll('.step').forEach((btn) => {
    btn.addEventListener('click', () => {
      const segs = effSegments();
      const cur = state[key];
      const step = Number(btn.dataset.step);
      let next;
      if (cur === null) next = step > 0 ? 1 : 0;
      else next = Math.min(segs, Math.max(0, cur + step));
      state[key] = next;
      update();
    });
  });
  el.querySelector('.bars').addEventListener('click', (e) => {
    const bar = e.target.closest('.bar');
    if (!bar) return;
    const n = Number(bar.dataset.n);
    // Tapping the top lit bar again takes it down one, so you can reach "empty-ish" levels.
    state[key] = state[key] === n ? n - 1 : n;
    update();
  });
}

function renderGauge(el, segs, tank) {
  const key = el.dataset.gauge;
  const level = state[key];
  const bars = el.querySelector('.bars');
  if (bars.childElementCount !== segs) {
    bars.innerHTML = '';
    for (let n = 1; n <= segs; n++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bar';
      b.dataset.n = String(n);
      b.setAttribute('aria-label', `${n} of ${segs} bars`);
      bars.appendChild(b);
    }
  }
  [...bars.children].forEach((b, idx) => {
    const on = level !== null && idx < level;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(level === idx + 1));
  });
  const out = el.querySelector('output');
  if (level === null) {
    out.textContent = 'Tap a bar';
    out.classList.add('unset');
  } else {
    const parts = [`${level} / ${segs}`];
    const frac = fractionLabel(level, segs);
    if (frac) parts.push(frac);
    if (tank > 0) parts.push(`≈ ${fmt((level / segs) * tank)} L`);
    out.textContent = parts.join(' · ');
    out.classList.remove('unset');
  }
}

// ---------- result ----------

function row(label, value, total = false) {
  const cls = total ? ' class="total"' : '';
  return `<dt${cls}>${label}</dt><dd${cls}>${value}</dd>`;
}

function methodBlock(name, m, isPrimary, body) {
  let tag = '';
  if (m.ok) tag = isPrimary ? '<span class="tag used">Used</span>' : '<span class="tag">Cross-check</span>';
  let inner;
  if (m.ok) inner = `<dl>${body}</dl>`;
  else if (m.issue) inner = `<p class="missing">${m.issue}</p>`;
  else inner = `<p class="missing">Needs ${m.missing.join(', ')}.</p>`;
  return `<div class="method"><div class="method-head"><span class="method-name">${name}</span>${tag}</div>${inner}</div>`;
}

function mileageLabel(inputs) {
  return inputs.efficiencyUnit === 'l100'
    ? `${fmt(inputs.efficiency)} L/100 km`
    : `${fmt(inputs.efficiency)} km/L`;
}

function renderResult(r, inputs) {
  const big = $('resLitres').parentElement;
  const note = $('resNote');
  const amount = $('resAmount');
  const unit = $('resLitresUnit');
  const dock = $('dock');

  big.classList.remove('done');
  unit.hidden = false;
  amount.textContent = '';

  if (!r.primaryKey) {
    $('resLitres').textContent = '—';
    note.textContent = 'Enter mileage and distance to return, plus odometer or gauge readings.';
    $('dockValue').textContent = '—';
    $('dockAmount').textContent = 'Enter readings';
  } else if (r.noFuelNeeded) {
    $('resLitres').textContent = 'No fuel needed';
    unit.hidden = true;
    big.classList.add('done');
    note.textContent = `You have about ${fmt(-r.raw)} L more than you need to get back at the pickup level.`;
    $('dockValue').textContent = '0 L';
    $('dockAmount').textContent = 'Nothing to add';
  } else {
    $('resLitres').textContent = fmt(r.litres);
    if (r.amount !== null) amount.textContent = `≈ ${money(r.amount)}`;
    const marginTxt = r.margin > 0 ? ` Includes ${fmt(r.margin)} L margin.` : '';
    note.textContent = r.primaryKey === 'consumption'
      ? `Based on distance driven and your mileage.${marginTxt}`
      : `Based on the fuel gauge.${marginTxt} Add odometer readings for a more precise figure.`;
    $('dockValue').textContent = `${fmt(r.litres)} L`;
    $('dockAmount').textContent = r.amount !== null ? money(r.amount) : '';
  }

  $('resWarnings').innerHTML = r.warnings.map((w) => `<li>${w}</li>`).join('');

  const c = r.methods.consumption;
  const g = r.methods.gauge;
  let cBody = '';
  if (c.ok) {
    cBody =
      row('Driven so far', `${fmt(c.driven, 0)} km`) +
      row('Still to drive', `${fmt(inputs.remainingKm, 0)} km`) +
      row(`Burned at ${mileageLabel(inputs)}`, `${fmt(c.burned)} L`) +
      row('Already added', `− ${fmt(c.added)} L`) +
      row('Needed', `${fmt(c.need)} L`, true);
  }
  let gBody = '';
  if (g.ok) {
    const barWord = Math.abs(g.barsShort) === 1 ? 'bar' : 'bars';
    const shortLabel = g.barsShort >= 0
      ? `${g.barsShort} ${barWord} below pickup`
      : `${-g.barsShort} ${barWord} above pickup`;
    gBody =
      row(shortLabel, `${g.short >= 0 ? '' : '− '}${fmt(Math.abs(g.short))} L`) +
      row(`Drive back at ${mileageLabel(inputs)}`, `${fmt(g.driveBack)} L`) +
      row('Needed', `${fmt(g.need)} L`, true);
  }
  let agree = '';
  if (r.methodsAgree) agree = '<p class="note">Both methods agree to within one bar.</p>';
  $('methods').innerHTML =
    methodBlock('By distance driven', c, r.primaryKey === 'consumption', cBody) +
    methodBlock('By fuel gauge', g, r.primaryKey === 'gauge', gBody) +
    agree;

  const logInput = $('logLitres');
  logInput.placeholder = r.litres > 0 ? fmt(r.litres) : 'Litres';
  dock.classList.toggle('hidden', false);
}

function renderSetupSummary(segs) {
  const bits = [];
  const tank = parseNum(state.tank);
  const eff = parseNum(state.efficiency);
  if (tank > 0) bits.push(`${fmt(tank, tank % 1 ? 1 : 0)} L`);
  if (eff > 0) bits.push(`${fmt(eff, eff % 1 ? 1 : 0)} ${state.effUnit === 'l100' ? 'L/100' : 'km/L'}`);
  if (state.pickupLevel !== null) bits.push(`pickup ${state.pickupLevel}/${segs}`);
  $('setupSummary').textContent = bits.join(' · ');
}

function renderFills() {
  const list = $('fills');
  const fills = state.fills;
  list.innerHTML = fills
    .map((f, idx) => {
      const meta = [];
      if (typeof f.odo === 'number' && f.odo >= 0) meta.push(`at ${Math.round(f.odo).toLocaleString()} km`);
      if (f.ts) {
        meta.push(new Date(f.ts).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }));
      }
      return `<li><span class="fill-l">${fmt(f.litres)} L</span><span class="fill-meta">${meta.join(' · ')}</span>` +
        `<button type="button" class="del" data-idx="${idx}" aria-label="Remove ${fmt(f.litres)} L fill-up">×</button></li>`;
    })
    .join('');
  $('fillsEmpty').hidden = fills.length > 0;
  $('fillCount').textContent = fills.length ? `· ${fmt(sumFills(fills))} L` : '';
}

let lastResult = null;

function render() {
  const segs = effSegments();
  for (const key of ['pickupLevel', 'nowLevel']) {
    if (state[key] !== null && state[key] > segs) state[key] = segs;
  }
  const tank = parseNum(state.tank);
  document.querySelectorAll('[data-gauge]').forEach((el) => renderGauge(el, segs, tank));

  const cur = (state.currency || '').trim();
  $('priceUnit').textContent = cur ? `${cur} / L` : '/ L';

  const inputs = {
    tank,
    segments: segs,
    pickupLevel: state.pickupLevel,
    nowLevel: state.nowLevel,
    pickupOdo: parseNum(state.pickupOdo),
    nowOdo: parseNum(state.nowOdo),
    remainingKm: parseNum(state.remainingKm),
    efficiency: parseNum(state.efficiency),
    efficiencyUnit: state.effUnit,
    fills: state.fills,
    margin: parseNum(state.margin),
    price: parseNum(state.price),
  };
  // An empty margin field means the default, not zero.
  if (Number.isNaN(inputs.margin)) inputs.margin = parseNum(DEFAULTS.margin);

  lastResult = computeRefuel(inputs);
  renderResult(lastResult, inputs);
  renderSetupSummary(segs);
  renderFills();
}

function update() {
  save();
  render();
}

// ---------- toast ----------

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- wiring ----------

function syncInputs() {
  for (const k of TEXT_FIELDS) $(k).value = state[k] ?? '';
  $('effUnit').value = state.effUnit;
}

function init() {
  syncInputs();
  for (const k of TEXT_FIELDS) {
    $(k).addEventListener('input', (e) => {
      state[k] = e.target.value;
      update();
    });
  }
  $('effUnit').addEventListener('change', (e) => {
    state.effUnit = e.target.value;
    update();
  });

  document.querySelectorAll('[data-gauge]').forEach(setupGauge);

  $('logBtn').addEventListener('click', () => {
    const typed = parseNum($('logLitres').value);
    const litres = typed > 0 ? typed : lastResult && lastResult.litres > 0 ? lastResult.litres : NaN;
    if (!(litres > 0)) {
      toast('Enter the litres you added.');
      $('logLitres').focus();
      return;
    }
    const odo = parseNum(state.nowOdo);
    state.fills.push({ litres, odo: odo >= 0 ? odo : null, ts: Date.now() });
    // This stop's readings are now out of date.
    state.nowOdo = '';
    state.nowLevel = null;
    state.remainingKm = '';
    $('logLitres').value = '';
    syncInputs();
    update();
    toast(`Logged ${fmt(litres)} L. Enter fresh readings at your next stop.`);
  });

  $('addBtn').addEventListener('click', () => {
    const litres = parseNum($('addLitres').value);
    if (!(litres > 0)) {
      toast('Enter the litres you added.');
      $('addLitres').focus();
      return;
    }
    state.fills.push({ litres, odo: null, ts: Date.now() });
    $('addLitres').value = '';
    update();
  });

  $('fills').addEventListener('click', (e) => {
    const btn = e.target.closest('.del');
    if (!btn) return;
    const [removed] = state.fills.splice(Number(btn.dataset.idx), 1);
    update();
    if (removed) toast(`Removed ${fmt(removed.litres)} L fill-up.`);
  });

  $('resetBtn').addEventListener('click', () => {
    if (!confirm('Clear this trip (car, pickup readings and fill-ups)?')) return;
    const kept = Object.fromEntries(KEEP_ON_RESET.map((k) => [k, state[k]]));
    state = { ...structuredClone(DEFAULTS), ...kept };
    syncInputs();
    update();
    $('setup').open = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  $('dock').addEventListener('click', () => {
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Collapse the setup card once the car and pickup are filled in.
  const setupDone = parseNum(state.efficiency) > 0 && (parseNum(state.pickupOdo) >= 0 || state.pickupLevel !== null);
  $('setup').open = !setupDone;

  render();
}

init();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
