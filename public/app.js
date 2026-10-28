const $ = (sel) => document.querySelector(sel);

// Builds DOM nodes with textContent so API data is never parsed as HTML.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const fmtRest = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)}m${sec % 60 ? ` ${sec % 60}s` : ''}` : `${sec}s`);
const fmtMin = (sec) => `${Math.max(1, Math.round(sec / 60))} min`;

let lastPlan = null;

async function init() {
  let opts;
  try {
    const res = await fetch('/api/options');
    opts = await res.json();
  } catch {
    showError('Could not reach the server. Is it running?');
    return;
  }

  const badge = $('#ai-badge');
  badge.textContent = opts.aiEnabled ? 'Gemini AI: on' : 'Offline mode (no API key)';
  badge.classList.add(opts.aiEnabled ? 'on' : 'off');

  $('#workout-types').append(
    ...opts.workoutTypes.map((t, i) =>
      h('label', { class: 'choice' },
        h('input', { type: 'radio', name: 'workoutType', value: t.value, checked: i === 0 }),
        h('span', { class: 'choice-body' }, h('strong', {}, t.label), h('small', {}, t.description))
      )
    )
  );

  const range = $('#duration');
  Object.assign(range, { min: opts.duration.min, max: opts.duration.max, step: opts.duration.step, value: opts.duration.default });
  const updateDuration = () => ($('#duration-out').textContent = `${range.value} min`);
  range.addEventListener('input', updateDuration);
  updateDuration();

  $('#level').append(...opts.levels.map((l) => h('option', { value: l.value }, l.label)));
  $('#focus').append(...opts.focusAreas.map((f) => h('option', { value: f.value }, f.label)));
  $('#pain-areas').append(
    ...opts.painAreas.map((p) =>
      h('label', { class: 'chip' }, h('input', { type: 'checkbox', name: 'painAreas', value: p.value }), h('span', {}, p.label))
    )
  );

  $('#plan-form').addEventListener('submit', onSubmit);
  $('#detail .close').addEventListener('click', () => $('#detail').close());
  $('#detail').addEventListener('click', (e) => e.target === $('#detail') && $('#detail').close());
}

function showError(msg) {
  const el = $('#form-error');
  el.textContent = msg;
  el.hidden = !msg;
}

async function onSubmit(e) {
  e.preventDefault();
  showError('');
  const form = new FormData(e.target);
  const payload = {
    workoutType: form.get('workoutType'),
    duration: Number(form.get('duration')),
    level: form.get('level'),
    focus: form.get('focus'),
    painAreas: form.getAll('painAreas'),
    notes: String(form.get('notes') ?? ''),
  };

  const btn = $('#submit');
  btn.disabled = true;
  btn.textContent = 'Building your plan…';
  const result = $('#result');
  result.hidden = false;
  result.replaceChildren(h('div', { class: 'card loading' }, h('div', { class: 'spinner' }), 'Asking the AI coach for the best exercises…'));
  result.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    lastPlan = data;
    renderPlan(data);
  } catch (err) {
    result.hidden = true;
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate my workout';
  }
}

function exerciseCard(ex, index, kind) {
  return h('article', { class: `exercise ${kind}` },
    h('div', { class: 'thumbs' },
      ex.images.slice(0, 2).map((src, i) =>
        h('img', { src, alt: `${ex.name} – ${i === 0 ? 'start' : 'end'} position`, loading: 'lazy' })
      )
    ),
    h('div', { class: 'ex-body' },
      h('h3', {}, h('span', { class: 'num' }, index + 1), ex.name),
      h('ul', { class: 'stats' },
        h('li', {}, h('b', {}, ex.sets), ' sets'),
        h('li', {}, h('b', {}, ex.reps), ' reps'),
        h('li', {}, h('b', {}, fmtRest(ex.restSec)), ' rest'),
        h('li', {}, '≈ ', h('b', {}, fmtMin(ex.estimatedSec)))
      ),
      h('p', { class: 'muscles' },
        ex.primaryMuscles.map((m) => h('span', { class: 'tag' }, titleCase(m))),
        h('span', { class: 'tag muted' }, titleCase(ex.equipment))
      ),
      ex.tip && h('p', { class: 'tip' }, '💡 ', ex.tip),
      h('button', { type: 'button', class: 'link', onclick: () => openDetail(ex) }, 'How to do it →')
    )
  );
}

function openDetail(ex) {
  $('#detail-body').replaceChildren(
    h('h2', {}, ex.name),
    h('div', { class: 'detail-imgs' }, ex.images.map((src) => h('img', { src, alt: ex.name }))),
    h('p', {}, h('b', {}, 'Primary: '), ex.primaryMuscles.map(titleCase).join(', ') || '–'),
    ex.secondaryMuscles.length ? h('p', {}, h('b', {}, 'Secondary: '), ex.secondaryMuscles.map(titleCase).join(', ')) : null,
    h('p', {}, h('b', {}, 'Prescription: '), `${ex.sets} sets × ${ex.reps}, rest ${fmtRest(ex.restSec)}`),
    h('h3', {}, 'Steps'),
    h('ol', {}, ex.instructions.map((s) => h('li', {}, s)))
  );
  $('#detail').showModal();
}

function listSection(title, items) {
  return h('section', { class: 'card' }, h('h2', {}, title), h('ul', { class: 'bullets' }, items.map((i) => h('li', {}, i))));
}

function renderPlan(plan) {
  const out = [];
  out.push(
    h('section', { class: 'card plan-head' },
      h('div', {},
        h('h2', {}, plan.title),
        h('p', {}, plan.summary),
        h('p', { class: 'meta' },
          h('span', { class: 'tag' }, `⏱ ≈ ${plan.estimatedMinutes} min`),
          h('span', { class: 'tag' }, `${plan.exercises.length} exercises`),
          h('span', { class: `tag ${plan.source === 'gemini' ? 'ai' : 'muted'}` }, plan.source === 'gemini' ? '✨ Generated by Gemini' : 'Built-in planner')
        ),
        plan.warning && h('p', { class: 'warning' }, plan.warning),
        plan.notice && h('p', { class: 'warning' }, plan.notice)
      ),
      h('div', { class: 'actions' },
        h('button', { type: 'button', onclick: () => window.print() }, 'Print / Save PDF'),
        h('button', { type: 'button', onclick: () => $('#plan-form').requestSubmit() }, 'Regenerate')
      )
    )
  );

  out.push(listSection(`🔥 Warm-up (≈${plan.warmupMin} min)`, plan.warmup));
  out.push(
    h('section', { class: 'card' },
      h('h2', {}, '🏋️ Main workout'),
      h('div', { class: 'exercise-list' }, plan.exercises.map((ex, i) => exerciseCard(ex, i, 'main')))
    )
  );
  if (plan.painRelief.length) {
    out.push(
      h('section', { class: 'card relief' },
        h('h2', {}, '🩹 Gentle relief for your sore areas'),
        h('p', { class: 'muted' }, 'Do these slowly. They should feel like a mild stretch, never sharp pain.'),
        h('div', { class: 'exercise-list' }, plan.painRelief.map((ex, i) => exerciseCard(ex, i, 'relief')))
      )
    );
  }
  out.push(listSection(`🧘 Cool-down (≈${plan.cooldownMin} min)`, plan.cooldown));
  out.push(h('p', { class: 'safety' }, '⚠️ ', plan.safetyNote));

  $('#result').replaceChildren(...out);
}

init();
