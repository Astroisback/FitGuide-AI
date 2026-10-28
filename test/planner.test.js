import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byId, PAIN_AREAS } from '../lib/catalog.js';
import { validateRequest, findCandidates, generatePlan, sanitizePlan, ValidationError } from '../lib/planner.js';

const base = { workoutType: 'calisthenics', duration: 45, level: 'beginner', focus: 'full', painAreas: [] };

test('validateRequest accepts valid input and rejects bad input', () => {
  assert.equal(validateRequest(base).duration, 45);
  assert.throws(() => validateRequest({ ...base, workoutType: 'yoga' }), ValidationError);
  assert.throws(() => validateRequest({ ...base, duration: 5 }), ValidationError);
  assert.throws(() => validateRequest({ ...base, painAreas: ['__proto__'] }), ValidationError);
  assert.throws(() => validateRequest({ ...base, notes: 'x'.repeat(301) }), ValidationError);
});

test('every workout type and focus combination yields candidates', () => {
  for (const workoutType of ['powerlifting', 'bodybuilding', 'calisthenics', 'cardio', 'olympic', 'mobility']) {
    for (const focus of ['full', 'upper', 'lower', 'core']) {
      const { pool } = findCandidates(validateRequest({ ...base, workoutType, focus }));
      assert.ok(pool.length > 0, `${workoutType}/${focus} has no exercises`);
    }
  }
});

test('painful muscles are never the primary target of a main exercise', () => {
  const req = validateRequest({ ...base, workoutType: 'bodybuilding', focus: 'upper', painAreas: ['shoulder', 'traps'] });
  const { pool, painRelief, painMuscles } = findCandidates(req);
  assert.deepEqual([...painMuscles].sort(), ['shoulders', 'traps']);
  for (const e of pool) assert.ok(!e.primaryMuscles.some((m) => painMuscles.includes(m)), e.name);
  assert.ok(painRelief.length > 0);
});

test('offline plan fits the time budget and includes images', async () => {
  for (const workoutType of ['powerlifting', 'bodybuilding', 'calisthenics', 'cardio', 'olympic', 'mobility']) {
    for (const duration of [15, 30, 45, 90, 120]) {
      for (const painAreas of [[], ['lowerBack', 'shoulder']]) {
        const plan = await generatePlan(validateRequest({ ...base, workoutType, duration, painAreas }));
        const label = `${workoutType} ${duration}min pain=${painAreas.length}`;
        assert.equal(plan.source, 'offline');
        assert.ok(plan.exercises.length >= 2, label);
        assert.ok(plan.estimatedMinutes <= duration + 2, `${label}: ${plan.estimatedMinutes}`);
        if (duration >= 30) assert.ok(plan.estimatedMinutes >= duration * 0.55, `${label}: ${plan.estimatedMinutes}`);
        for (const ex of plan.exercises) assert.ok(ex.images[0].startsWith('https://'));
      }
    }
  }
});

test('sanitizePlan drops unknown ids and clamps numbers', () => {
  const req = validateRequest(base);
  const [a, b] = findCandidates(req).pool;
  const plan = sanitizePlan(
    { title: 'T', summary: 'S', warmup: ['w'], cooldown: ['c'], exercises: [
      { id: a.id, sets: 99, reps: '10', restSec: -5 },
      { id: 'Fake_Exercise', sets: 3, reps: '10', restSec: 60 },
      { id: a.id, sets: 3, reps: '10', restSec: 60 },
      { id: b.id, sets: 'x', reps: '', restSec: 60 },
    ] },
    new Set([a.id, b.id]), new Set(), req
  );
  assert.deepEqual(plan.exercises.map((e) => e.id), [a.id, b.id]);
  assert.equal(plan.exercises[0].sets, 10);
  assert.equal(plan.exercises[0].restSec, 0);
  assert.equal(plan.exercises[1].sets, 3);
  assert.equal(plan.exercises[1].reps, '8-15');
});

test('uses Gemini output when the API responds, falls back when it fails', async () => {
  const req = validateRequest({ ...base, painAreas: ['knees'] });
  let sentPrompt = '';
  const okFetch = async (url, init) => {
    sentPrompt = JSON.parse(init.body).contents[0].parts[0].text;
    const ids = [...sentPrompt.matchAll(/^(\S+) \| /gm)].map((m) => m[1]);
    const plan = { title: 'AI plan', summary: 's', warmup: ['jog'], cooldown: ['stretch'],
      exercises: ids.slice(0, 4).map((id) => ({ id, sets: 3, reps: '10', restSec: 60, tip: 't' })) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(plan) }] } }] }));
  };
  const plan = await generatePlan(req, { apiKey: 'k', model: 'm', fetchImpl: okFetch });
  assert.equal(plan.source, 'gemini');
  assert.equal(plan.title, 'AI plan');
  assert.ok(plan.exercises.every((e) => byId.has(e.id)));
  assert.match(sentPrompt, /Knees/);

  const badFetch = async () => new Response('quota', { status: 429 });
  const fallback = await generatePlan(req, { apiKey: 'k', model: 'm', fetchImpl: badFetch });
  assert.equal(fallback.source, 'offline');
  assert.ok(fallback.warning);
});

test('focus area is kept when enough pain-free exercises exist', () => {
  const req = validateRequest({ ...base, workoutType: 'powerlifting', duration: 60, level: 'intermediate', focus: 'lower', painAreas: ['knees'] });
  const c = findCandidates(req);
  const lower = ['quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors'];
  if (!c.focusRelaxed) {
    for (const e of c.pool) assert.ok(e.primaryMuscles.some((m) => lower.includes(m)), e.name);
  }
  for (const e of c.pool) assert.ok(!e.primaryMuscles.some((m) => c.painMuscles.includes(m)), e.name);
});

test('pain area map only references muscles that exist in the dataset', () => {
  const known = new Set([...byId.values()].flatMap((e) => e.primaryMuscles));
  for (const [key, p] of Object.entries(PAIN_AREAS)) for (const m of p.muscles) assert.ok(known.has(m), `${key}: ${m}`);
});
