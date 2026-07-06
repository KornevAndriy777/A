// ============ CONFIG: SCORING SCALES ============
// linear interpolation between (min_reps -> min_pts) and (max_reps -> max_pts), clamped 0-100
const SCALES = {
  pullups:  { minReps: 7,  minPts: 55, maxReps: 20, maxPts: 100, name: 'Підтягування' },
  squats:   { minReps: 53, minPts: 51, maxReps: 90, maxPts: 100, name: 'Присідання «козачок»' },
  pushups:  { minReps: 28, minPts: 51, maxReps: 60, maxPts: 100, name: 'Віджимання з відривом' },
  abs:      { minReps: 48, minPts: 51, maxReps: 90, maxPts: 100, name: 'Прес зі скручуванням' },
  frog:     { minReps: 27, minPts: 50, maxReps: 40, maxPts: 100, name: '«Жаба»' },
};
const RUN_3000_NORM = 11 * 60 + 45; // seconds
const RUN_100_NORM = 13.4; // seconds
const PASS_THRESHOLD = 450;
const GOAL_SCORE = 500;
const MAX_SCORE = 500; // 5 x 100pt exercises
const PROGRAM_DAYS = 60; // two months prep

function calcScore(key, reps){
  const s = SCALES[key];
  if (!s || !reps || reps <= 0) return 0;
  if (reps < s.minReps) {
    // below min threshold: scale 0 -> minPts proportionally under min reps (soft, encouraging but honest)
    return Math.round((reps / s.minReps) * s.minPts);
  }
  if (reps >= s.maxReps) return s.maxPts;
  const ratio = (reps - s.minReps) / (s.maxReps - s.minReps);
  return Math.round(s.minPts + ratio * (s.maxPts - s.minPts));
}

function parseTimeToSec(str){
  if (!str) return null;
  str = str.trim().replace(',', '.');
  if (str.includes(':')) {
    const [m, s] = str.split(':').map(Number);
    if (isNaN(m) || isNaN(s)) return null;
    return m * 60 + s;
  }
  const v = parseFloat(str);
  return isNaN(v) ? null : v;
}

// ============ STORAGE ============
// Uses window.storage (shared=true) keyed by PIN, so any device with the same PIN sees the same data.
const LOCAL_PIN_KEY = 'fizo_local_pin';
let PIN = null;
let dataCache = { days: {}, curator: [], startDate: null };
let saveTimer = null;

function todayISO(d = new Date()){
  return d.toISOString().slice(0,10);
}

async function dataKey(){ return `fizo_data:${PIN}`; }

async function loadData(){
  setSync('syncing');
  try{
    const r = await window.storage.get(await dataKey(), true);
    if (r && r.value){
      dataCache = JSON.parse(r.value);
    } else {
      dataCache = { days: {}, curator: [], startDate: todayISO() };
      await persist();
    }
    setSync('live');
  }catch(e){
    dataCache = { days: {}, curator: [], startDate: todayISO() };
    setSync('offline');
  }
  if (!dataCache.startDate) dataCache.startDate = todayISO();
}

async function persist(){
  setSync('syncing');
  try{
    await window.storage.set(await dataKey(), JSON.stringify(dataCache), true);
    setSync('live');
  }catch(e){
    setSync('offline');
  }
}

function setSync(state){
  const dot = document.getElementById('syncDot');
  const txt = document.getElementById('syncText');
  if (!dot) return;
  dot.className = 'sync-dot';
  if (state === 'live'){ dot.classList.add('live'); txt.textContent = 'синхронізовано'; }
  else if (state === 'syncing'){ dot.classList.add('syncing'); txt.textContent = 'синхронізація…'; }
  else { txt.textContent = 'офлайн'; }
}

// ============ PIN GATE ============
const FIXED_PIN = '5925';
let pinBuffer = '';

function renderPinDots(){
  const dots = document.querySelectorAll('#pinDots .d');
  dots.forEach((d,i) => d.classList.toggle('filled', i < pinBuffer.length));
}

function showPinError(msg){
  document.getElementById('pinError').textContent = msg;
  setTimeout(()=> document.getElementById('pinError').textContent = '', 1600);
}

async function initPinGate(){
  document.getElementById('pinTitle').textContent = 'ФІЗО';
  document.getElementById('pinSubtitle').textContent = 'Введи код доступу';
}

document.getElementById('pinPad').addEventListener('click', async (e)=>{
  const btn = e.target.closest('button');
  if (!btn) return;
  const k = btn.dataset.k;
  if (k === 'del'){ pinBuffer = pinBuffer.slice(0,-1); renderPinDots(); return; }
  if (pinBuffer.length >= 4) return;
  pinBuffer += k;
  renderPinDots();
  if (pinBuffer.length === 4){
    await handlePinComplete();
  }
});

async function handlePinComplete(){
  if (pinBuffer !== FIXED_PIN){
    showPinError('Невірний код');
    setTimeout(()=>{ pinBuffer=''; renderPinDots(); }, 400);
    return;
  }
  PIN = pinBuffer;
  await unlockApp();
}

async function unlockApp(){
  document.getElementById('pinOverlay').classList.add('hidden');
  await loadData();
  renderAll();
}

// ============ TABS ============
document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click', ()=> switchView(tab.dataset.view));
});
document.querySelectorAll('.navbtn').forEach(nb=>{
  nb.addEventListener('click', ()=> switchView(nb.dataset.view));
});
function switchView(view){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+view).classList.add('active');
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.view===view));
  document.querySelectorAll('.navbtn').forEach(t=>t.classList.toggle('active', t.dataset.view===view));
  if (view === 'history') renderHistory();
  if (view === 'curator') renderCuratorList();
}

// ============ TODAY VIEW LOGIC ============
function getTodayEntry(){
  const t = todayISO();
  if (!dataCache.days[t]) dataCache.days[t] = { pullups:0, squats:0, pushups:0, abs:0, frog:0, run3000:null, run100:null };
  return dataCache.days[t];
}

function wireExerciseCard(key){
  const card = document.querySelector(`.ex-card[data-ex="${key}"]`);
  if (!card) return;
  const input = card.querySelector('input.val');
  const minus = card.querySelector('.minus');
  const plus = card.querySelector('.plus');
  const ptsEl = card.querySelector('.pts');
  const barFill = card.querySelector('.ex-bar-fill');

  function update(){
    const reps = parseInt(input.value) || 0;
    const pts = calcScore(key, reps);
    ptsEl.textContent = pts;
    if (barFill) barFill.style.width = pts + '%';
    const entry = getTodayEntry();
    entry[key] = reps;
    scheduleTotalUpdate();
  }
  minus.addEventListener('click', ()=>{ input.value = Math.max(0, (parseInt(input.value)||0) - 1); update(); });
  plus.addEventListener('click', ()=>{ input.value = (parseInt(input.value)||0) + 1; update(); });
  input.addEventListener('input', update);
  card._update = update;
}

['pullups','squats','pushups','abs','frog'].forEach(wireExerciseCard);

function wireRunCard(key, normSec, markId, isTimeMMSS){
  const card = document.querySelector(`.ex-card[data-ex="${key}"]`);
  const input = card.querySelector('input.val');
  const markEl = document.getElementById(markId);
  function update(){
    const sec = parseTimeToSec(input.value);
    const entry = getTodayEntry();
    entry[key] = input.value || null;
    if (sec === null){ markEl.textContent = '—'; markEl.style.color = 'var(--paper)'; scheduleTotalUpdate(); return; }
    if (sec <= normSec){
      markEl.textContent = 'ВИКОНАНО';
      markEl.style.color = 'var(--ok)';
      markEl.style.fontSize = '11px';
    } else {
      markEl.textContent = 'НЕ ВИКОНАНО';
      markEl.style.color = 'var(--danger)';
      markEl.style.fontSize = '11px';
    }
    scheduleTotalUpdate();
  }
  input.addEventListener('input', update);
  card._update = update;
}
wireRunCard('run3000', RUN_3000_NORM, 'run3000mark');
wireRunCard('run100', RUN_100_NORM, 'run100mark');

function scheduleTotalUpdate(){
  updateTotalScore();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(()=> persist(), 800);
}

function computeTotal(entry){
  return ['pullups','squats','pushups','abs','frog'].reduce((sum,k)=> sum + calcScore(k, entry[k]||0), 0);
}

function updateTotalScore(){
  const entry = getTodayEntry();
  const total = computeTotal(entry);
  document.getElementById('totalScore').textContent = total;
  const pct = Math.min(1, total / MAX_SCORE);
  const circumference = 364.4;
  document.getElementById('dialArc').style.strokeDashoffset = circumference * (1 - pct);

  const tag = document.getElementById('statusTag');
  const detail = document.getElementById('statusDetail');
  if (total >= GOAL_SCORE){
    tag.textContent = 'ЦІЛЬ ДОСЯГНУТА';
    tag.className = 'status-tag target';
    detail.textContent = 'Тримай рівень — це вище планової цілі.';
  } else if (total >= PASS_THRESHOLD){
    tag.textContent = 'ПОРІГ ПРОЙДЕНО';
    tag.className = 'status-tag pass';
    detail.textContent = `До цілі 500 лишилось ${GOAL_SCORE - total} балів.`;
  } else {
    tag.textContent = 'НИЖЧЕ ПОРОГУ';
    tag.className = 'status-tag below';
    detail.textContent = `До мінімуму (450) лишилось ${PASS_THRESHOLD - total} балів.`;
  }
}

document.getElementById('saveDay').addEventListener('click', async ()=>{
  const entry = getTodayEntry();
  entry.savedAt = new Date().toISOString();
  entry.total = computeTotal(entry);
  await persist();
  renderWeekStrip();
  const btn = document.getElementById('saveDay');
  const orig = btn.textContent;
  btn.textContent = 'Збережено ✓';
  setTimeout(()=> btn.textContent = orig, 1200);
});

// ============ WEEK STRIP ============
function renderWeekStrip(){
  const strip = document.getElementById('weekStrip');
  strip.innerHTML = '';
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // Mon=0
  const monday = new Date(now); monday.setDate(now.getDate() - dow);
  const labels = ['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];
  for (let i=0;i<7;i++){
    const d = new Date(monday); d.setDate(monday.getDate()+i);
    const iso = todayISO(d);
    const done = dataCache.days[iso] && dataCache.days[iso].savedAt;
    const dot = document.createElement('div');
    dot.className = 'day-dot' + (done ? ' done' : '') + (iso === todayISO() ? ' today' : '');
    dot.textContent = labels[i];
    strip.appendChild(dot);
  }
}

// ============ HEADER DAY COUNT ============
function renderDayCount(){
  const start = new Date(dataCache.startDate || todayISO());
  const now = new Date();
  const diffDays = Math.floor((now - start) / 86400000) + 1;
  document.getElementById('dayCount').textContent = Math.max(1, diffDays) + ' / ' + PROGRAM_DAYS;
  const left = PROGRAM_DAYS - diffDays;
  document.getElementById('daysLeft').textContent = left > 0 ? left + ' днів лишилось' : 'програму завершено';
}

// ============ HISTORY ============
function renderHistory(){
  const list = document.getElementById('historyList');
  const dates = Object.keys(dataCache.days).filter(d => dataCache.days[d].savedAt).sort().reverse();
  if (!dates.length){
    list.innerHTML = '<div class="log-empty">Ще немає збережених тренувань.<br>Заповни показники на вкладці «Сьогодні» і натисни «Зберегти».</div>';
    return;
  }
  list.innerHTML = dates.map(d=>{
    const e = dataCache.days[d];
    const total = e.total ?? computeTotal(e);
    const dateStr = new Date(d).toLocaleDateString('uk-UA', {day:'2-digit', month:'2-digit', year:'numeric'});
    return `<div class="log-item">
      <div class="log-top"><div class="log-date">${dateStr}</div><div class="log-score">${total} б.</div></div>
      <div class="log-detail">Підтягування ${e.pullups||0} · Козачок ${e.squats||0} · Віджимання ${e.pushups||0} · Прес ${e.abs||0} · Жаба ${e.frog||0}${e.run3000?` · 3000м ${e.run3000}`:''}${e.run100?` · 100м ${e.run100}`:''}</div>
    </div>`;
  }).join('');
}

// ============ CURATOR ============
document.getElementById('curatorDate').value = todayISO();

document.getElementById('saveCurator').addEventListener('click', async ()=>{
  const date = document.getElementById('curatorDate').value || todayISO();
  const entry = getTodayEntry();
  const record = {
    date,
    total: computeTotal(entry),
    pullups: entry.pullups||0, squats: entry.squats||0, pushups: entry.pushups||0,
    abs: entry.abs||0, frog: entry.frog||0, run3000: entry.run3000, run100: entry.run100,
    recordedAt: new Date().toISOString()
  };
  dataCache.curator.push(record);
  await persist();
  renderCuratorList();
  const btn = document.getElementById('saveCurator');
  const orig = btn.textContent;
  btn.textContent = 'Зафіксовано ✓';
  setTimeout(()=> btn.textContent = orig, 1200);
});

function renderCuratorList(){
  const list = document.getElementById('curatorList');
  if (!dataCache.curator.length){
    list.innerHTML = '<div class="log-empty">Куратор ще не робив контрольних замірів.</div>';
    return;
  }
  const sorted = [...dataCache.curator].sort((a,b)=> b.date.localeCompare(a.date));
  list.innerHTML = sorted.map(r=>{
    const dateStr = new Date(r.date).toLocaleDateString('uk-UA', {day:'2-digit', month:'2-digit', year:'numeric'});
    return `<div class="log-item curator">
      <div class="log-top"><div><div class="log-tag">Куратор</div><div class="log-date">${dateStr}</div></div><div class="log-score">${r.total} б.</div></div>
      <div class="log-detail">Підтягування ${r.pullups} · Козачок ${r.squats} · Віджимання ${r.pushups} · Прес ${r.abs} · Жаба ${r.frog}${r.run3000?` · 3000м ${r.run3000}`:''}${r.run100?` · 100м ${r.run100}`:''}</div>
    </div>`;
  }).join('');
}

// ============ RENDER ALL ============
function renderAll(){
  const entry = getTodayEntry();
  document.querySelector('[data-ex="pullups"] input.val').value = entry.pullups || 0;
  document.querySelector('[data-ex="squats"] input.val').value = entry.squats || 0;
  document.querySelector('[data-ex="pushups"] input.val').value = entry.pushups || 0;
  document.querySelector('[data-ex="abs"] input.val').value = entry.abs || 0;
  document.querySelector('[data-ex="frog"] input.val').value = entry.frog || 0;
  document.querySelector('[data-ex="run3000"] input.val').value = entry.run3000 || '';
  document.querySelector('[data-ex="run100"] input.val').value = entry.run100 || '';

  ['pullups','squats','pushups','abs','frog','run3000','run100'].forEach(k=>{
    const card = document.querySelector(`.ex-card[data-ex="${k}"]`);
    if (card && card._update) card._update();
  });

  updateTotalScore();
  renderWeekStrip();
  renderDayCount();
  renderHistory();
  renderCuratorList();
}

// ============ SERVICE WORKER ============
if ('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}

// ============ INIT ============
(async function init(){
  renderPinDots();
  await initPinGate();
})();
