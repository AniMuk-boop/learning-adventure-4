/* ============================================================
   MONDAY — a stress budget simulator
   Pure vanilla JS. Single state object drives everything.
   ============================================================ */

(function(){

/* ---------- central state ---------- */
const state = {
  screen: 'intro',
  time: 540,              // simulated minutes, 540 = 9:00
  dayStart: 540,
  dayEnd: 1050,            // 17:30
  resources: { energy: 100, focus: 100, mood: 100 },
  inbox: 6,
  timeline: [],
  choiceLog: [],
  drivers: { interruptions: 0, workload: 0, anticipation: 0, recovery: 0 },
  archetypeScore: { firefighter: 0, planner: 0, protector: 0, busy: 0, recovery: 0 },
  queue: [],                // scheduled events for this playthrough, sorted by time
  delayed: [],              // consequences waiting to fire
  setupChoices: {},
  tickHandle: null,
  playing: false
};

/* ---------- setup modifiers ---------- */
const SETUP_MODS = {
  sleep: {
    low:  { energy:-15, focus:-10, mood:-5 },
    mid:  { energy:0,   focus:0,   mood:0  },
    high: { energy:+10, focus:+5,  mood:+5 }
  },
  breakfast: {
    coffee: { energy:+5,  focus:-5,  mood:0 },
    light:  { energy:0,   focus:0,   mood:0 },
    full:   { energy:+5,  focus:+5,  mood:0 }
  },
  commute: {
    traffic: { energy:-5, focus:-5,  mood:-10 },
    normal:  { energy:0,  focus:0,   mood:0 },
    walk:    { energy:+5, focus:+5,  mood:+10 }
  }
};

/* ---------- event pool ----------
   time: rough slot in minutes-from-9am used for scheduling spread
   drivers: which stress-driver buckets this choice's cost belongs to
   arche: which archetype this choice leans toward
*/
const POOL = [
  {
    id:'manager_talk', source:'Slack — Manager', slot:40,
    title:'"Can we talk later?"',
    body:'No context. No emoji. Just five words sitting in your DMs.',
    choices:[
      { label:'Assume something is wrong', deltas:{mood:-14, focus:-8}, drivers:{anticipation:10}, arche:'firefighter' },
      { label:'Ask for clarification now', deltas:{focus:-3, mood:+2}, drivers:{anticipation:2}, arche:'planner' },
      { label:'Let it sit, keep working', deltas:{focus:-2}, drivers:{anticipation:5}, arche:'protector' }
    ]
  },
  {
    id:'inbox_42', source:'Outlook', slot:60,
    title:'42 unread emails',
    body:'It was 12 when you sat down. It multiplied while you made coffee.',
    choices:[
      { label:'Read everything, top to bottom', deltas:{energy:-10, focus:-10}, drivers:{workload:10}, arche:'busy' },
      { label:'Scan and prioritize the top 5', deltas:{focus:-4}, drivers:{workload:4}, arche:'planner' },
      { label:'Close the tab, deal with it later', deltas:{mood:+2}, drivers:{workload:2}, arche:'protector', setFlag:'inbox_ignored' }
    ]
  },
  {
    id:'meeting_overrun', source:'Calendar', slot:110,
    title:'Meeting is 20 minutes over',
    body:'The agenda finished a while ago. Nobody has said anything.',
    choices:[
      { label:'Stay, say nothing', deltas:{energy:-10, mood:-6}, drivers:{workload:8}, arche:'firefighter' },
      { label:'Suggest wrapping up', deltas:{focus:-2, mood:+2}, drivers:{workload:2}, arche:'planner' },
      { label:'Quietly multitask through it', deltas:{focus:-12}, drivers:{workload:6}, arche:'busy' }
    ]
  },
  {
    id:'coworker_help', source:'In person', slot:130,
    title:'A coworker needs help',
    body:'"Got two minutes?" It is rarely two minutes.',
    choices:[
      { label:'Help immediately', deltas:{focus:-12, mood:+3}, drivers:{workload:8}, arche:'busy' },
      { label:'Schedule it for later today', deltas:{focus:-2}, drivers:{workload:2}, arche:'planner' },
      { label:'Decline, protect your focus block', deltas:{mood:-4, focus:+4}, drivers:{workload:0}, arche:'protector' }
    ]
  },
  {
    id:'production_issue', source:'PagerDuty', slot:160,
    title:'Unexpected outage',
    body:'A client-facing system just went down. People are already asking questions.',
    choices:[
      { label:'Stay calm, triage methodically', deltas:{energy:-10, focus:-8, mood:-4}, drivers:{workload:12}, arche:'protector' },
      { label:'Panic-jump between five threads at once', deltas:{energy:-18, focus:-16, mood:-10}, drivers:{workload:14, interruptions:6}, arche:'firefighter' },
      { label:'Wait for someone else to own it', deltas:{mood:-8}, drivers:{anticipation:8}, arche:'busy' }
    ]
  },
  {
    id:'slack_ping_1', source:'Slack — #general', slot:25,
    title:'A GIF war has broken out',
    body:'Seventeen notifications in ninety seconds. None of them are for you.',
    choices:[
      { label:'Mute the channel', deltas:{focus:+3}, drivers:{interruptions:0}, arche:'protector' },
      { label:'Glance at every one', deltas:{focus:-6}, drivers:{interruptions:8}, arche:'busy' }
    ]
  },
  {
    id:'client_escalation', source:'Email — Client', slot:190,
    title:'"This is unacceptable."',
    body:'A client escalation, cc-ing your director. The tone is sharp.',
    choices:[
      { label:'Draft a calm, thorough reply', deltas:{focus:-10, mood:-6}, drivers:{workload:10}, arche:'protector' },
      { label:'Fire back a quick defensive reply', deltas:{mood:-12, energy:-6}, drivers:{workload:6, anticipation:4}, arche:'firefighter' },
      { label:'Forward it to your manager', deltas:{mood:-2}, drivers:{workload:2}, arche:'planner' }
    ]
  },
  {
    id:'phone_call', source:'Phone', slot:75,
    title:'An unknown number is calling',
    body:'Your phone has been buzzing on the desk for ten seconds.',
    choices:[
      { label:'Answer it', deltas:{focus:-8}, drivers:{interruptions:8}, arche:'busy' },
      { label:'Let it go to voicemail', deltas:{focus:+2}, drivers:{interruptions:0}, arche:'protector' }
    ]
  },
  {
    id:'deep_work_block', source:'Calendar', slot:95,
    title:'A rare open 45 minutes',
    body:'Nothing is scheduled. Your focus block from three weeks ago finally arrived.',
    choices:[
      { label:'Protect it, close every tab', deltas:{focus:+7, mood:+2}, drivers:{recovery:10}, arche:'protector' },
      { label:'Use it to clear small tasks instead', deltas:{focus:-4}, drivers:{workload:4}, arche:'busy' }
    ]
  },
  {
    id:'micro_break', source:'You', slot:150,
    title:'You notice your shoulders are up by your ears',
    body:'A small, physical signal that you have been pushing for a while.',
    choices:[
      { label:'Take five minutes away from the screen', deltas:{energy:+5, mood:+3}, drivers:{recovery:10}, arche:'recovery' },
      { label:'Push through it', deltas:{energy:-8, mood:-4}, drivers:{workload:4}, arche:'firefighter' }
    ]
  },
  {
    id:'lunch', source:'Calendar', slot:205,
    title:'It is 12:30',
    body:'Your stomach has been reminding you for a while now.',
    choices:[
      { label:'Skip it, keep working', deltas:{energy:-14, mood:-8}, drivers:{workload:6}, arche:'busy' },
      { label:'Take a proper break away from your desk', deltas:{energy:+7, mood:+5, focus:+3}, drivers:{recovery:16}, arche:'recovery' },
      { label:'Eat at your desk while working', deltas:{energy:+2, focus:-6}, drivers:{workload:4}, arche:'firefighter' }
    ],
    mandatory: true
  },
  {
    id:'slack_ping_2', source:'Slack — DM', slot:220,
    title:'"quick q 🙏"',
    body:'It is never quick.',
    choices:[
      { label:'Answer right away', deltas:{focus:-6}, drivers:{interruptions:8}, arche:'busy' },
      { label:'Reply when you finish your current task', deltas:{focus:+2}, drivers:{interruptions:2}, arche:'planner' }
    ]
  },
  {
    id:'ignored_email_consequence', source:'Email', slot:260,
    title:'"Following up — again."',
    body:'The email you closed the tab on this morning has grown teeth.',
    requiresFlag:'inbox_ignored',
    choices:[
      { label:'Handle it now, apologize for the delay', deltas:{mood:-10, focus:-8}, drivers:{workload:10, anticipation:6}, arche:'firefighter' },
      { label:'Reply briefly, address it properly tomorrow', deltas:{mood:-4, focus:-2}, drivers:{workload:4}, arche:'planner' }
    ]
  },
  {
    id:'calendar_double_book', source:'Calendar', slot:240,
    title:'Two meetings, same slot',
    body:'Nobody noticed until now. Both organizers are messaging you.',
    choices:[
      { label:'Attend both, split attention', deltas:{focus:-14, mood:-6}, drivers:{workload:8, interruptions:6}, arche:'busy' },
      { label:'Pick one, send a clear note to the other', deltas:{focus:-2, mood:-2}, drivers:{workload:2}, arche:'planner' }
    ]
  },
  {
    id:'praise_moment', source:'Slack — Manager', slot:280,
    title:'"Great work on that last one."',
    body:'A short, genuine message. Easy to miss if you are moving fast.',
    choices:[
      { label:'Pause and actually take it in', deltas:{mood:+5}, drivers:{recovery:8}, arche:'recovery' },
      { label:'Say thanks and move straight on', deltas:{mood:+2}, drivers:{recovery:0}, arche:'busy' }
    ]
  },
  {
    id:'scope_creep', source:'Email — Stakeholder', slot:300,
    title:'"While you are at it, could you also..."',
    body:'A small ask, tacked onto the end of an unrelated thread.',
    choices:[
      { label:'Say yes to keep things smooth', deltas:{focus:-8, mood:-4}, drivers:{workload:8}, arche:'busy' },
      { label:'Push back and scope it properly', deltas:{mood:-2}, drivers:{workload:2}, arche:'planner' }
    ]
  },
  {
    id:'coffee_run', source:'You', slot:170,
    title:'The office is quiet for a second',
    body:'Nobody is asking you for anything, for once.',
    choices:[
      { label:'Get up, get water or coffee, stretch', deltas:{energy:+4, mood:+3}, drivers:{recovery:8}, arche:'recovery' },
      { label:'Use the gap to clear more inbox', deltas:{focus:-6}, drivers:{workload:6}, arche:'busy' }
    ]
  },
  {
    id:'notification_storm', source:'Phone + Slack + Email', slot:320,
    title:'Three things ping at once',
    body:'A calendar reminder, a Slack mention, and an email — all in the same second.',
    choices:[
      { label:'Handle all three immediately', deltas:{focus:-14, energy:-6}, drivers:{interruptions:14}, arche:'firefighter' },
      { label:'Silence notifications for the next hour', deltas:{focus:+8}, drivers:{interruptions:0}, arche:'protector' }
    ]
  },
  {
    id:'feedback_request', source:'Slack — Peer', slot:340,
    title:'"Can you review this before end of day?"',
    body:'A reasonable ask, with a deadline that is closer than it feels.',
    choices:[
      { label:'Drop what you are doing, review now', deltas:{focus:-10}, drivers:{workload:8}, arche:'busy' },
      { label:'Block 20 minutes for it later today', deltas:{focus:-2}, drivers:{workload:2}, arche:'planner' }
    ]
  },
  {
    id:'bad_news', source:'1:1', slot:360,
    title:'A project you cared about is being deprioritized',
    body:'Delivered plainly, in a scheduled 1:1. Nobody is at fault.',
    choices:[
      { label:'Sit with it for a moment before responding', deltas:{mood:-6}, drivers:{recovery:4}, arche:'recovery' },
      { label:'Immediately pivot to what is next', deltas:{mood:-10, focus:-4}, drivers:{workload:4, anticipation:4}, arche:'firefighter' }
    ]
  },
  {
    id:'walk_offer', source:'Coworker', slot:380,
    title:'"Want to grab a quick walk?"',
    body:'A coworker heading out for ten minutes, asking if you want in.',
    choices:[
      { label:'Go — step away from the desk', deltas:{energy:+4, mood:+3, focus:+2}, drivers:{recovery:10}, arche:'recovery' },
      { label:'Stay, there is too much to do', deltas:{mood:-4}, drivers:{workload:2}, arche:'busy' }
    ]
  }
];

const FINALE = {
  id:'finale', source:'Email — Urgent', slot:9999,
  title:'A last urgent request lands at 4:45',
  body:'Whatever is left of you has to deal with whatever is left of the day.',
  choices:[
    { label:'Push through and finish it properly', deltas:{energy:-16, focus:-14, mood:-6}, drivers:{workload:14}, arche:'firefighter' },
    { label:'Do a fast, imperfect version and stop', deltas:{energy:-6, focus:-6, mood:-2}, drivers:{workload:8}, arche:'planner' },
    { label:'Explain you will finish it first thing tomorrow', deltas:{mood:+3, energy:-3}, drivers:{workload:2}, arche:'protector' }
  ],
  mandatory: true
};

/* ============================================================
   DOM refs
   ============================================================ */
const $ = id => document.getElementById(id);
const screens = {
  intro: $('screen-intro'),
  setup: $('screen-setup'),
  day:   $('screen-day'),
  end:   $('screen-end')
};

function showScreen(name){
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  state.screen = name;
}

/* ============================================================
   INTRO -> SETUP
   ============================================================ */
$('btn-start').addEventListener('click', () => showScreen('setup'));

document.querySelectorAll('.setup-group').forEach(group => {
  const key = group.dataset.group;
  group.querySelectorAll('.option').forEach(btn => {
    btn.addEventListener('click', () => {
      group.querySelectorAll('.option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.setupChoices[key] = btn.dataset.value;
      checkSetupComplete();
    });
  });
});

function checkSetupComplete(){
  const done = ['sleep','breakfast','commute'].every(k => state.setupChoices[k]);
  $('btn-enter-office').disabled = !done;
}

$('btn-enter-office').addEventListener('click', () => {
  applySetup();
  buildQueue();
  showScreen('day');
  startDay();
});

function applySetup(){
  ['sleep','breakfast','commute'].forEach(key => {
    const mod = SETUP_MODS[key][state.setupChoices[key]];
    Object.keys(mod).forEach(r => state.resources[r] = clamp(state.resources[r] + mod[r]));
  });
  renderMeters(true);
}

/* ============================================================
   BUILD THE DAY'S QUEUE
   ============================================================ */
function buildQueue(){
  const mandatory = POOL.filter(e => e.mandatory);
  const optional = shuffle(POOL.filter(e => !e.mandatory && !e.requiresFlag));
  const chosen = optional.slice(0, 7);
  let all = [...chosen, ...mandatory].sort((a,b) => a.slot - b.slot);
  all.push(FINALE);

  // spread across the working day with light jitter, mapped to real time range
  const span = state.dayEnd - state.dayStart - 30;
  all = all.map((e, i) => {
    const frac = i / (all.length - 1);
    const time = Math.round(state.dayStart + 15 + frac * span + (Math.random()*10 - 5));
    return { ...e, time };
  });
  state.queue = all;

  // conditional follow-up events (delayed consequences) are pulled in from POOL on demand
}

/* ============================================================
   RUN THE DAY — timer loop
   ============================================================ */
const REAL_DURATION_MS = 5 * 60 * 1000; // ~5 minutes of real time
let simTotalRange, tickStart, lastSimTime;

// Passive drain across the whole day, independent of choices — this is the
// baseline cost of just being at work. Total points lost over the full
// 9:00-5:30 span if no event ever touched a resource.
const PASSIVE_DECAY_PER_DAY = { energy: 58, focus: 62, mood: 56 };

function startDay(){
  simTotalRange = state.dayEnd - state.dayStart;
  tickStart = performance.now();
  lastSimTime = state.dayStart;
  state.playing = true;
  logTimeline(state.dayStart, 'You sit down at your desk. The day begins.');
  scheduleNextEvent();
  state.tickHandle = requestAnimationFrame(tick);
}

function tick(now){
  if (!state.playing) return;
  const elapsed = now - tickStart;
  const frac = Math.min(elapsed / REAL_DURATION_MS, 1);
  state.time = state.dayStart + frac * simTotalRange;

  // passive drain scaled to however much sim-time just passed
  const deltaMin = state.time - lastSimTime;
  if (deltaMin > 0){
    Object.keys(PASSIVE_DECAY_PER_DAY).forEach(r => {
      const drain = (deltaMin / simTotalRange) * PASSIVE_DECAY_PER_DAY[r];
      state.resources[r] = clamp(state.resources[r] - drain);
    });
    renderMeters();
  }
  lastSimTime = state.time;

  renderClock();

  // check for a due event
  if (state.queue.length && state.time >= state.queue[0].time && !eventShowing()){
    const ev = state.queue.shift();
    presentEvent(ev);
  }

  if (frac >= 1 && !state.queue.length && !eventShowing()){
    state.playing = false;
    endDay();
    return;
  }
  state.tickHandle = requestAnimationFrame(tick);
}

function scheduleNextEvent(){ /* handled inside tick loop */ }

function eventShowing(){
  return $('event-card').classList.contains('visible');
}

/* ============================================================
   RENDER: clock + progress + meters
   ============================================================ */
function renderClock(){
  const totalMin = Math.round(state.time);
  let h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  $('clock-time').textContent = `${h12}:${m.toString().padStart(2,'0')}`;
  document.querySelector('.clock-label').textContent = ampm;

  const frac = (state.time - state.dayStart) / (state.dayEnd - state.dayStart);
  $('day-progress-fill').style.width = `${clamp(frac*100,0,100)}%`;
  $('inbox-count').textContent = state.inbox;
}

function renderMeters(instant){
  ['energy','focus','mood'].forEach(r => {
    const val = Math.round(clamp(state.resources[r]));
    $(`val-${r}`).textContent = val;
    const fill = $(`fill-${r}`);
    fill.style.width = `${val}%`;
    fill.classList.toggle('low', val <= 25);
  });
}

/* ============================================================
   EVENTS
   ============================================================ */
function presentEvent(ev){
  if (ev.requiresFlag && !state.flags_check) {} // placeholder, flags checked at build time for follow-ups
  $('workspace-idle').style.opacity = 0;
  const card = $('event-card');
  $('event-source').textContent = ev.source;
  $('event-title').textContent = ev.title;
  $('event-body').textContent = ev.body;
  const choicesEl = $('event-choices');
  choicesEl.innerHTML = '';

  ev.choices.forEach(choice => {
    const btn = document.createElement('button');
    btn.className = 'event-choice';
    btn.textContent = choice.label;
    btn.addEventListener('click', () => resolveChoice(ev, choice));
    choicesEl.appendChild(btn);
  });

  card.classList.add('visible');
  bumpInbox(ev);
}

function bumpInbox(ev){
  if (['inbox_42','scope_creep','client_escalation','feedback_request'].includes(ev.id)) {
    state.inbox = Math.max(0, state.inbox + (Math.random() > 0.5 ? 2 : -3));
  } else {
    state.inbox = Math.max(0, state.inbox + (Math.random() > 0.7 ? 1 : 0));
  }
}

function resolveChoice(ev, choice){
  // apply resource deltas
  Object.keys(choice.deltas || {}).forEach(r => {
    state.resources[r] = clamp(state.resources[r] + choice.deltas[r]);
  });
  renderMeters();

  // apply driver costs
  Object.keys(choice.drivers || {}).forEach(d => {
    state.drivers[d] += choice.drivers[d];
  });

  // archetype scoring
  if (choice.arche) state.archetypeScore[choice.arche] += 1;

  // full record for the end-of-day personalized debrief
  state.choiceLog.push({
    time: Math.round(state.time),
    eventTitle: ev.title,
    choiceLabel: choice.label,
    deltas: choice.deltas || {},
    drivers: choice.drivers || {},
    arche: choice.arche || null
  });

  // timeline
  logTimeline(Math.round(state.time), `${ev.title} → ${choice.label}`);

  // toast summary of biggest resource hit
  showToast(choice.deltas);

  // handle flags & follow-up injection
  if (choice.setFlag === 'inbox_ignored'){
    const followUp = POOL.find(e => e.id === 'ignored_email_consequence');
    if (followUp) {
      const t = Math.min(state.time + 60, state.dayEnd - 20);
      state.queue.push({ ...followUp, time: t });
      state.queue.sort((a,b) => a.time - b.time);
    }
  }

  // hide card, resume
  $('event-card').classList.remove('visible');
  $('workspace-idle').style.opacity = 1;
  $('idle-text').textContent = pickIdleLine();
}

const IDLE_LINES = [
  'The day is quiet for a moment.',
  'A short lull. Nothing pinging, for now.',
  'Time moves. Nobody needs anything right this second.',
  'A brief stretch of uninterrupted time.'
];
function pickIdleLine(){ return IDLE_LINES[Math.floor(Math.random()*IDLE_LINES.length)]; }

function showToast(deltas){
  if (!deltas) return;
  const entries = Object.entries(deltas);
  if (!entries.length) return;
  const [res, val] = entries.sort((a,b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  const sign = val > 0 ? '+' : '';
  const layer = $('toast-layer');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = `${capitalize(res)} ${sign}${val}`;
  layer.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function logTimeline(time, text){
  state.timeline.push({ time, text });
  const list = $('feed-list');
  const item = document.createElement('div');
  item.className = 'feed-item';
  item.innerHTML = `<span class="feed-time">${formatTime(time)}</span>${escapeHtml(text)}`;
  list.appendChild(item);
  while (list.children.length > 8) list.removeChild(list.firstChild);
}

/* ============================================================
   END OF DAY
   ============================================================ */
function endDay(){
  cancelAnimationFrame(state.tickHandle);
  const { energy, focus, mood } = state.resources;

  $('end-fill-energy').style.width = `${energy}%`;
  $('end-fill-focus').style.width = `${focus}%`;
  $('end-fill-mood').style.width = `${mood}%`;
  $('end-val-energy').textContent = Math.round(energy);
  $('end-val-focus').textContent = Math.round(focus);
  $('end-val-mood').textContent = Math.round(mood);

  renderDrivers();
  renderArchetype();
  renderEndTimeline();
  renderPersonalizedLesson();

  showScreen('end');
}

function renderDrivers(){
  const d = state.drivers;
  const total = Object.values(d).reduce((a,b) => a+b, 0) || 1;
  const labels = {
    interruptions: 'Interruptions',
    workload: 'Workload',
    anticipation: 'Anticipation',
    recovery: 'Recovery invested'
  };
  const list = $('drivers-list');
  list.innerHTML = '';
  Object.keys(labels).forEach(key => {
    const pct = Math.round((d[key] / total) * 100);
    const row = document.createElement('div');
    row.className = 'driver-row';
    row.innerHTML = `
      <div class="driver-top"><span>${labels[key]}</span><span>${pct}%</span></div>
      <div class="driver-bar"><div class="driver-bar-fill" style="width:${pct}%"></div></div>`;
    list.appendChild(row);
  });
}

const ARCHETYPES = {
  firefighter: {
    name: 'Reactive Firefighter',
    desc: 'You met almost everything head-on, the moment it arrived. That responsiveness is a real strength — but it left little budget in reserve for whatever came last.'
  },
  planner: {
    name: 'Balanced Planner',
    desc: 'You triaged instead of reacting, sorting what needed you now from what could wait. Your resources drained more slowly because your attention was not constantly redirected.'
  },
  protector: {
    name: 'Deep Work Protector',
    desc: 'You defended your focus deliberately, even when it meant saying no. That protection paid off in the moments that actually needed your full attention.'
  },
  busy: {
    name: 'Always Busy',
    desc: 'You said yes often, stayed available, and kept things moving for everyone around you. It came at a steady, quiet cost to your own focus and mood.'
  },
  recovery: {
    name: 'Recovery Champion',
    desc: 'You treated small breaks as part of the job, not a reward for finishing it. That habit of topping up kept your budget healthier than most days allow.'
  }
};

function renderArchetype(){
  const scores = state.archetypeScore;
  let winner = 'planner', best = -1;
  Object.keys(scores).forEach(k => { if (scores[k] > best){ best = scores[k]; winner = k; } });
  const a = ARCHETYPES[winner];
  $('end-archetype').textContent = a.name;
  $('end-archetype-desc').textContent = a.desc;
}

const DRIVER_PHRASES = {
  interruptions: 'constant interruptions — pings and asks that pulled you out of whatever you were doing',
  workload: 'sheer workload — the volume of things that needed handling',
  anticipation: 'anticipation — bracing for problems before they had even arrived',
  recovery: 'time spent recovering — breaks and pauses you chose to take'
};

function renderPersonalizedLesson(){
  const log = state.choiceLog;
  const parts = [];

  // biggest single hit to each resource, with the moment and choice that caused it
  const worst = {};
  log.forEach(entry => {
    ['energy','focus','mood'].forEach(r => {
      const d = entry.deltas[r];
      if (typeof d === 'number' && d < 0){
        if (!worst[r] || d < worst[r].delta) worst[r] = { delta: d, ...entry };
      }
    });
  });

  // pick the single worst moment overall (largest negative delta across all resources)
  let worstOverall = null;
  Object.entries(worst).forEach(([r, w]) => {
    if (!worstOverall || w.delta < worstOverall.delta) worstOverall = { resource: r, ...w };
  });

  if (worstOverall){
    parts.push(`Your ${worstOverall.resource} took its sharpest single hit at ${formatTime(worstOverall.time)}, during "${worstOverall.eventTitle}" — the moment you chose to "${worstOverall.choiceLabel.toLowerCase()}."`);
  }

  // a second distinct resource's worst moment, if it was a different event
  const other = Object.entries(worst).find(([r, w]) => !worstOverall || (r !== worstOverall.resource && w.eventTitle !== worstOverall.eventTitle));
  if (other){
    const [r, w] = other;
    parts.push(`Your ${r} dropped hardest after "${w.eventTitle}," when you chose to "${w.choiceLabel.toLowerCase()}."`);
  }

  // dominant stress driver
  const d = state.drivers;
  const total = Object.values(d).reduce((a,b) => a+b, 0);
  if (total > 0){
    const dominant = Object.keys(d).reduce((a,b) => d[a] >= d[b] ? a : b);
    const pct = Math.round((d[dominant] / total) * 100);
    if (dominant === 'recovery'){
      parts.push(`Recovery was the largest single category in your day at ${pct}% — the breaks you took were doing real work, even when they did not feel productive.`);
    } else {
      parts.push(`${capitalize(DRIVER_PHRASES[dominant].split(' — ')[0])} was the single largest drain on your budget today, at ${pct}% of everything you spent.`);
    }
  }

  // recovery/protective ratio
  const protectiveCount = log.filter(e => e.arche === 'recovery' || e.arche === 'protector').length;
  const total_choices = log.length;
  if (total_choices > 0){
    if (protectiveCount === 0){
      parts.push(`Not once today did you choose to protect your focus or step away — every single decision spent from the budget, none of them topped it up.`);
    } else if (protectiveCount <= 2){
      parts.push(`Only ${protectiveCount} of your ${total_choices} decisions today were about protecting your focus or recovering — the rest were spent reacting to whatever showed up.`);
    } else {
      parts.push(`${protectiveCount} of your ${total_choices} decisions today were about protecting your focus or recovering — a habit that visibly slowed the drain.`);
    }
  }

  parts.push('You did not fail because the day became stressful. You struggled because your stress budget was already spent when the unexpected happened. Stress is not something we eliminate. It is something we budget.');

  $('final-lesson').textContent = parts.join(' ');
}

function renderEndTimeline(){
  const el = $('end-timeline');
  el.innerHTML = '';
  state.timeline.forEach(item => {
    const row = document.createElement('div');
    row.className = 'feed-item';
    row.innerHTML = `<span class="feed-time">${formatTime(item.time)}</span>${escapeHtml(item.text)}`;
    el.appendChild(row);
  });
}

/* ============================================================
   REPLAY
   ============================================================ */
$('btn-replay').addEventListener('click', () => {
  Object.assign(state, {
    time: 540, resources: { energy:100, focus:100, mood:100 }, inbox: 6,
    timeline: [], choiceLog: [], drivers: { interruptions:0, workload:0, anticipation:0, recovery:0 },
    archetypeScore: { firefighter:0, planner:0, protector:0, busy:0, recovery:0 },
    queue: [], delayed: [], setupChoices: {}, playing: false
  });
  document.querySelectorAll('.option.selected').forEach(b => b.classList.remove('selected'));
  $('btn-enter-office').disabled = true;
  $('feed-list').innerHTML = '';
  renderMeters();
  showScreen('intro');
});

/* ============================================================
   UTILITIES
   ============================================================ */
function clamp(v, min=0, max=100){ return Math.max(min, Math.min(max, v)); }
function shuffle(arr){
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function formatTime(min){
  let h = Math.floor(min/60), m = Math.round(min%60);
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12; if (h12===0) h12=12;
  return `${h12}:${m.toString().padStart(2,'0')} ${ampm}`;
}
function capitalize(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
function escapeHtml(s){
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/* init */
renderMeters();

})();
