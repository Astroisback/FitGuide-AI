import { readFileSync } from 'node:fs';

const IMAGE_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';

const rawExercises = JSON.parse(
  readFileSync(new URL('../data/exercises.json', import.meta.url), 'utf8')
);

// Every recommendation must show a picture, so skip the few entries without images.
export const exercises = rawExercises.filter((e) => e.images?.length).map((e) => ({
  id: e.id,
  name: e.name,
  category: e.category,
  level: e.level,
  equipment: e.equipment ?? 'none',
  mechanic: e.mechanic,
  primaryMuscles: e.primaryMuscles ?? [],
  secondaryMuscles: e.secondaryMuscles ?? [],
  instructions: e.instructions ?? [],
  images: (e.images ?? []).map((p) => IMAGE_BASE + p),
}));

export const byId = new Map(exercises.map((e) => [e.id, e]));

const FREE_WEIGHTS = ['dumbbell', 'cable', 'machine', 'barbell', 'e-z curl bar'];

// `scheme` holds default training parameters; workSec/restSec are per set and drive the time estimate.
export const WORKOUT_TYPES = {
  powerlifting: {
    label: 'Powerlifting',
    description: 'Heavy squat, bench and deadlift style strength work',
    match: (e) =>
      e.category === 'powerlifting' ||
      (e.category === 'strength' && e.equipment === 'barbell' && e.mechanic === 'compound'),
    scheme: { sets: 5, reps: '3-5', workSec: 30, restSec: 180 },
  },
  bodybuilding: {
    label: 'Bodybuilding',
    description: 'Hypertrophy-focused training for muscle size',
    match: (e) => e.category === 'strength' && FREE_WEIGHTS.includes(e.equipment),
    scheme: { sets: 4, reps: '8-12', workSec: 45, restSec: 75 },
  },
  calisthenics: {
    label: 'Calisthenics',
    description: 'Bodyweight strength and skill training, no equipment',
    match: (e) => e.equipment === 'body only' && ['strength', 'plyometrics'].includes(e.category),
    scheme: { sets: 3, reps: '8-15', workSec: 40, restSec: 60 },
  },
  cardio: {
    label: 'Cardio / Fat loss',
    description: 'Conditioning circuits and plyometrics to burn calories',
    match: (e) =>
      e.category === 'cardio' ||
      e.category === 'plyometrics' ||
      (e.category === 'strength' && ['body only', 'kettlebells'].includes(e.equipment)),
    scheme: { sets: 3, reps: '40 sec', workSec: 40, restSec: 20 },
  },
  olympic: {
    label: 'Olympic weightlifting',
    description: 'Snatch, clean and jerk and their variations',
    match: (e) => e.category === 'olympic weightlifting',
    scheme: { sets: 5, reps: '2-3', workSec: 25, restSec: 150 },
  },
  mobility: {
    label: 'Flexibility / Mobility',
    description: 'Stretching routines for flexibility and recovery',
    match: (e) => e.category === 'stretching',
    scheme: { sets: 2, reps: '30 sec hold', workSec: 30, restSec: 15 },
  },
};

const UPPER = ['chest', 'shoulders', 'triceps', 'biceps', 'lats', 'middle back', 'traps', 'forearms', 'neck'];
const LOWER = ['quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors'];

export const FOCUS_AREAS = {
  full: { label: 'Full body', muscles: null },
  upper: { label: 'Upper body', muscles: UPPER },
  lower: { label: 'Lower body / Legs', muscles: LOWER },
  push: { label: 'Push (chest, shoulders, triceps)', muscles: ['chest', 'shoulders', 'triceps'] },
  pull: { label: 'Pull (back, biceps)', muscles: ['lats', 'middle back', 'biceps', 'traps', 'forearms'] },
  arms: { label: 'Arms', muscles: ['biceps', 'triceps', 'forearms'] },
  core: { label: 'Core / Abs', muscles: ['abdominals', 'lower back'] },
};

export const PAIN_AREAS = {
  neck: { label: 'Neck', muscles: ['neck', 'traps'] },
  shoulder: { label: 'Shoulder', muscles: ['shoulders'] },
  traps: { label: 'Traps', muscles: ['traps'] },
  chest: { label: 'Chest', muscles: ['chest'] },
  elbow: { label: 'Elbow', muscles: ['biceps', 'triceps', 'forearms'] },
  hands: { label: 'Hands / Wrists', muscles: ['forearms'] },
  upperBack: { label: 'Upper back', muscles: ['middle back', 'lats'] },
  lowerBack: { label: 'Lower back', muscles: ['lower back'] },
  hips: { label: 'Hips', muscles: ['glutes', 'abductors', 'adductors'] },
  knees: { label: 'Knees', muscles: ['quadriceps', 'hamstrings'] },
  ankles: { label: 'Ankles / Calves', muscles: ['calves'] },
};

export const LEVELS = {
  beginner: { label: 'Beginner', allowed: ['beginner', 'intermediate'] },
  intermediate: { label: 'Intermediate', allowed: ['beginner', 'intermediate'] },
  expert: { label: 'Advanced', allowed: ['beginner', 'intermediate', 'expert'] },
};

export function publicOptions() {
  const pick = (obj, extra = () => ({})) =>
    Object.entries(obj).map(([value, v]) => ({ value, label: v.label, ...extra(v) }));
  return {
    workoutTypes: pick(WORKOUT_TYPES, (v) => ({ description: v.description })),
    focusAreas: pick(FOCUS_AREAS),
    painAreas: pick(PAIN_AREAS),
    levels: pick(LEVELS),
    duration: { min: 15, max: 120, step: 5, default: 45 },
  };
}
