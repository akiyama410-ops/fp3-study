// 進み具合・正解率・勉強時間などの計算
import { FIELDS } from "./config.js";
import { state, getProgress, mediaFor, today, localDay } from "./data.js";

export function sortedMaterials() {
  const order = Object.fromEntries(FIELDS.map((f, i) => [f.key, i]));
  return [...state.materials].sort((a, b) => (order[a.field] ?? 99) - (order[b.field] ?? 99) || a.sort - b.sort);
}

export function materialsOf(field) {
  return sortedMaterials().filter((m) => m.field === field);
}

export function questionsOf(mid) {
  return state.questions.filter((q) => q.material_id === mid).sort((a, b) => a.sort - b.sort);
}

// 問題ごとの最新の解答
export function latestAttempts() {
  const map = {};
  for (const a of state.attempts) {
    const cur = map[a.question_id];
    if (!cur || cur.answered_at <= a.answered_at) map[a.question_id] = a;
  }
  return map;
}

export function materialItems(mid) {
  const items = [];
  for (const kind of ["audio", "video", "slides"]) {
    if (mediaFor(mid, kind)) items.push({ kind, done: getProgress(mid, kind).done });
  }
  items.push({ kind: "text", done: getProgress(mid, "text").done });
  const qs = questionsOf(mid);
  if (qs.length) {
    const latest = latestAttempts();
    items.push({ kind: "quiz", done: qs.every((q) => latest[q.id]) });
  }
  return items;
}

export function materialRate(mid) {
  const items = materialItems(mid);
  if (!items.length) return 0;
  return items.filter((i) => i.done).length / items.length;
}

export function isComplete(mid) {
  return materialItems(mid).every((i) => i.done);
}

export function fieldRate(field) {
  const ms = materialsOf(field);
  if (!ms.length) return 0;
  return ms.reduce((s, m) => s + materialRate(m.id), 0) / ms.length;
}

export function overallRate() {
  const ms = state.materials;
  if (!ms.length) return 0;
  return ms.reduce((s, m) => s + materialRate(m.id), 0) / ms.length;
}

// 正解率（各問題の最新の解答で計算）
export function accuracy(filterFn = () => true) {
  const latest = latestAttempts();
  let answered = 0;
  let correct = 0;
  for (const q of state.questions) {
    if (!filterFn(q)) continue;
    const a = latest[q.id];
    if (!a) continue;
    answered += 1;
    if (a.correct) correct += 1;
  }
  return { answered, correct, rate: answered ? correct / answered : null };
}

export function fieldOfMaterial(mid) {
  const m = state.materials.find((x) => x.id === mid);
  if (m) return m.field;
  // 実技の問題は「jitsugi-分野」という教材IDにしている
  const j = /^jitsugi-(\w+)$/.exec(mid || "");
  return j ? j[1] : null;
}

export function isJitsugi(q) {
  return String(q.material_id || "").startsWith("jitsugi-");
}

export function wrongQuestions() {
  const latest = latestAttempts();
  return state.questions.filter((q) => latest[q.id] && !latest[q.id].correct);
}

// 勉強時間（日ごと・秒）
export function secondsByDay() {
  const map = {};
  for (const l of state.logs) map[l.day] = (map[l.day] || 0) + l.seconds;
  // ○×問題を解いた日も「勉強した日」に入れる
  for (const a of state.attempts) {
    const d = localDay(new Date(a.answered_at));
    if (!(d in map)) map[d] = 0;
  }
  return map;
}

export function totalSeconds() {
  return state.logs.reduce((s, l) => s + l.seconds, 0);
}

export function streak() {
  const map = secondsByDay();
  const d = new Date();
  if (!(today() in map)) d.setDate(d.getDate() - 1);
  let n = 0;
  while (localDay(d) in map) {
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function daysUntilExam() {
  const exam = new Date(`${state.settings.exam_date}T00:00:00`);
  const now = new Date(`${today()}T00:00:00`);
  return Math.round((exam - now) / 86400000);
}

// 試験日までの計画：最後の7日間は復習にあて、それまでに残りの教材を割り振る
export function plan() {
  const days = daysUntilExam();
  const remaining = sortedMaterials().filter((m) => !isComplete(m.id));
  const studyDays = Math.max(1, days - 7);
  const perDay = remaining.length ? Math.ceil(remaining.length / studyDays) : 0;
  const schedule = [];
  const d = new Date(`${today()}T00:00:00`);
  for (let i = 0; i < remaining.length; i += perDay) {
    schedule.push({ day: localDay(d), materials: remaining.slice(i, i + perDay) });
    d.setDate(d.getDate() + 1);
  }
  return { days, remaining, perDay, schedule, reviewFrom: days > 7 ? addDays(state.settings.exam_date, -7) : today() };
}

function addDays(dayStr, n) {
  const d = new Date(`${dayStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localDay(d);
}

export function fmtDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}時間${m}分` : `${m}分`;
}

export function pct(r) {
  return `${Math.round((r || 0) * 100)}%`;
}

// ===== 忘れる前に出る復習 =====
// まちがえた問題を、1日後 → 3日後 → 7日後 に出す。
// 予定日以降に正解すると次の間隔へ進み、まちがえると最初（1日後）にもどる。3回続けて正解したら卒業。
export const INTERVALS = [1, 3, 7];

function addDaysStr(dayStr, n) {
  const d = new Date(`${dayStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localDay(d);
}

export function reviewStates() {
  const byQ = {};
  for (const a of state.attempts) (byQ[a.question_id] = byQ[a.question_id] || []).push(a);
  const out = {};
  for (const [qid, list] of Object.entries(byQ)) {
    list.sort((x, y) => (x.answered_at < y.answered_at ? -1 : 1));
    let lastWrong = -1;
    list.forEach((a, i) => { if (!a.correct) lastWrong = i; });
    if (lastWrong < 0) continue; // 一度もまちがえていない
    let stage = 0;
    let base = localDay(new Date(list[lastWrong].answered_at));
    for (const a of list.slice(lastWrong + 1)) {
      const day = localDay(new Date(a.answered_at));
      if (day >= addDaysStr(base, INTERVALS[stage])) {
        stage += 1;
        base = day;
        if (stage >= INTERVALS.length) break;
      }
    }
    out[qid] = stage >= INTERVALS.length ? { stage, due: null } : { stage, due: addDaysStr(base, INTERVALS[stage]) };
  }
  return out;
}

export function dueReviews() {
  const st = reviewStates();
  const t = today();
  return state.questions.filter((q) => st[q.id] && st[q.id].due && st[q.id].due <= t);
}

export function reviewSummary() {
  const st = Object.values(reviewStates());
  const t = today();
  return {
    due: st.filter((s) => s.due && s.due <= t).length,
    later: st.filter((s) => s.due && s.due > t).length,
    graduated: st.filter((s) => !s.due).length,
  };
}
