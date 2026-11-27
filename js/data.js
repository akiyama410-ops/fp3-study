// 学習データの管理と、保管庫（Supabase）との同期。
// 書き込みはまずこの端末に保存し、電波があるときに保管庫へ送ります。
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { kv, blobs, clearAll } from "./store.js";

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
});

const DEFAULT_EXAM = "2027-01-31";
const KEYS = ["materials", "questions", "media", "settings", "progress", "attempts", "logs", "exams", "queue", "lastSync"];

export const state = {
  user: null,
  materials: [],
  questions: [],
  media: [],
  settings: { exam_date: DEFAULT_EXAM },
  progress: {},
  attempts: [],
  logs: [],
  exams: [], // 模擬試験の結果
  examsReady: true, // 保管庫に模擬試験の表があるか（追加の設定をしたか）
  queue: [],
  lastSync: null,
  syncing: false,
  syncError: "",
};

const listeners = new Set();
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of listeners) {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  }
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function today() {
  return localDay(new Date());
}
export function localDay(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function save(...keys) {
  for (const k of keys) await kv.set(k, state[k]);
}

export async function init() {
  for (const k of KEYS) {
    const v = await kv.get(k);
    if (v !== undefined) state[k] = v;
  }
  if (!state.settings || !state.settings.exam_date) state.settings = { exam_date: DEFAULT_EXAM };
  const { data } = await sb.auth.getSession();
  state.user = data.session ? data.session.user : null;
  sb.auth.onAuthStateChange((_event, session) => {
    const before = state.user && state.user.id;
    state.user = session ? session.user : null;
    if ((state.user && state.user.id) !== before) emit();
  });
  window.addEventListener("online", () => sync());
  emit();
}

// ===== ログイン =====
export function appUrl() {
  return location.origin + location.pathname;
}

export async function sendCode(email) {
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: appUrl() },
  });
  if (error) throw error;
}

// メールの「Sign in」リンクを貼り付けてログインする（ホーム画面に追加したアプリ用）
export async function verifyLink(text) {
  const m = /https?:\/\/\S+/.exec(String(text).trim());
  if (!m) throw new Error("リンクが見つかりません。メールのリンクを長押しして「リンクをコピー」してから貼り付けてください。");
  let url;
  try {
    url = new URL(m[0]);
  } catch (_) {
    throw new Error("リンクの形がちがいます。");
  }
  const tokenHash = url.searchParams.get("token") || url.searchParams.get("token_hash");
  if (!tokenHash) throw new Error("このリンクにはログイン用の情報が入っていません。");
  const type = url.searchParams.get("type") || "magiclink";
  const { data, error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) throw error;
  state.user = data.user;
  emit();
  await sync();
}

export async function verifyCode(email, token) {
  const { data, error } = await sb.auth.verifyOtp({ email, token, type: "email" });
  if (error) throw error;
  state.user = data.user;
  emit();
  await sync();
}

export async function signOut() {
  await sb.auth.signOut();
  await clearAll();
  location.reload();
}

// ===== 同期 =====
const PK = {
  progress: "user_id,material_id,kind",
  quiz_attempts: "user_id,id",
  study_logs: "user_id,id",
  settings: "user_id",
  exam_results: "user_id,id",
};

function enqueue(table, row) {
  state.queue.push({ table, row });
}

async function flush() {
  while (state.queue.length) {
    const table = state.queue[0].table;
    const batch = [];
    for (const item of state.queue) {
      if (item.table !== table || batch.length >= 200) break;
      batch.push({ ...item.row, user_id: state.user.id });
    }
    // 同じキーの行が同じ送信に2回入るとエラーになるので、最後のものだけ残す
    const keyCols = PK[table].split(",");
    const unique = new Map();
    for (const r of batch) unique.set(keyCols.map((c) => r[c]).join("|"), r);
    const { error } = await sb.from(table).upsert([...unique.values()], { onConflict: PK[table] });
    if (error) throw error;
    state.queue.splice(0, batch.length);
    await save("queue");
  }
}

async function selectAll(table, order) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select("*").range(from, from + 999);
    if (order) q = q.order(order);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function pull() {
  const [materials, questions, media, progress, attempts, logs, settings] = await Promise.all([
    selectAll("materials", "sort"),
    selectAll("questions", "sort"),
    selectAll("media"),
    selectAll("progress"),
    selectAll("quiz_attempts", "answered_at"),
    selectAll("study_logs", "created_at"),
    selectAll("settings"),
  ]);
  // 模擬試験の表は追加の設定（002_choice_and_exams.sql）を実行するまで無いので、無くても止めない
  let exams = null;
  try {
    exams = await selectAll("exam_results", "finished_at");
    state.examsReady = true;
  } catch (e) {
    state.examsReady = false;
  }
  state.materials = materials.map(({ user_id, ...m }) => m);
  state.questions = questions.map(({ user_id, ...q }) => q);
  state.media = media.map(({ user_id, ...m }) => m);
  state.progress = {};
  for (const { user_id, ...p } of progress) state.progress[`${p.material_id}:${p.kind}`] = p;
  state.attempts = attempts.map(({ user_id, ...a }) => a);
  state.logs = logs.map(({ user_id, ...l }) => l);
  if (settings[0]) state.settings = { exam_date: settings[0].exam_date };
  if (exams) {
    // 設定の追加前にこの端末だけに保存していた結果があれば、保管庫に送る
    const ids = new Set(exams.map((x) => x.id));
    const localOnly = state.exams.filter((x) => !ids.has(x.id));
    for (const x of localOnly) enqueue("exam_results", x);
    state.exams = [...exams.map(({ user_id, ...x }) => x), ...localOnly];
    if (localOnly.length) {
      await save("queue");
      schedulePush();
    }
  }
  state.lastSync = new Date().toISOString();
  await save("materials", "questions", "media", "progress", "attempts", "logs", "exams", "settings", "lastSync");
}

let syncPromise = null;
export function sync() {
  if (!state.user || !navigator.onLine) return Promise.resolve();
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    state.syncing = true;
    emit();
    try {
      await flush();
      await pull();
      state.syncError = "";
    } catch (e) {
      console.error(e);
      state.syncError = e.message || String(e);
    } finally {
      state.syncing = false;
      syncPromise = null;
      emit();
    }
  })();
  return syncPromise;
}

// 書き込みの直後など、今動いている同期が終わってから、もう一度最新を取りに行く
async function resync() {
  if (syncPromise) await syncPromise;
  return sync();
}

let pushTimer = null;
function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    if (!state.user || !navigator.onLine) return;
    try {
      await flush();
      state.syncError = "";
    } catch (e) {
      state.syncError = e.message || String(e);
    }
    emit();
  }, 1500);
}

// ===== 学習の記録 =====
export function getProgress(mid, kind) {
  return state.progress[`${mid}:${kind}`] || { material_id: mid, kind, done: false, position_sec: 0 };
}

export async function setProgress(mid, kind, patch, { silent = false } = {}) {
  const row = { ...getProgress(mid, kind), ...patch, updated_at: new Date().toISOString() };
  state.progress[`${mid}:${kind}`] = row;
  enqueue("progress", row);
  await save("progress", "queue");
  schedulePush();
  if (!silent) emit();
}

export async function addAttempt(questionId, correct) {
  const row = { id: uuid(), question_id: questionId, correct, answered_at: new Date().toISOString() };
  state.attempts.push(row);
  enqueue("quiz_attempts", row);
  await save("attempts", "queue");
  schedulePush();
}

export async function addStudy(seconds, source) {
  seconds = Math.round(seconds);
  if (seconds < 5) return;
  const row = { id: uuid(), day: today(), seconds, source, created_at: new Date().toISOString() };
  state.logs.push(row);
  enqueue("study_logs", row);
  await save("logs", "queue");
  schedulePush();
}

export async function addExamResult(row) {
  const full = { id: uuid(), finished_at: new Date().toISOString(), ...row };
  state.exams.push(full);
  if (state.examsReady) enqueue("exam_results", full);
  await save("exams", "queue");
  schedulePush();
  emit();
}

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  enqueue("settings", { ...state.settings, updated_at: new Date().toISOString() });
  await save("settings", "queue");
  schedulePush();
  emit();
}

// ===== 教材データの取り込み（管理画面） =====
export async function importSeed(seed) {
  if (!seed || !Array.isArray(seed.materials) || !Array.isArray(seed.questions)) {
    throw new Error("ファイルの形がちがいます（fp3-seed.json を選んでください）");
  }
  const uid = state.user.id;
  const now = new Date().toISOString();
  const mats = seed.materials.map((m) => ({
    user_id: uid,
    id: String(m.id),
    field: String(m.field),
    sort: Number(m.sort),
    title: String(m.title),
    content_html: String(m.content_html),
    updated_at: now,
  }));
  const qs = seed.questions.map((q) => ({
    user_id: uid,
    id: String(q.id),
    material_id: String(q.material_id),
    sort: Number(q.sort),
    text: String(q.text),
    explanation: String(q.explanation || ""),
    ...(q.kind === "choice"
      ? { kind: "choice", answer: null, choices: (q.choices || []).map(String), answer_index: Number(q.answer_index) }
      : { kind: "ox", answer: Boolean(q.answer) }),
  }));
  const hasChoice = qs.some((q) => q.kind === "choice");
  if (hasChoice && !state.examsReady) {
    throw new Error("三択問題を入れるには、先に保管庫の追加の設定（002_choice_and_exams.sql）を実行してください");
  }
  // 三択がないデータは、追加の設定の前でも入るように「kind」を送らない
  if (!hasChoice) for (const q of qs) delete q.kind;
  for (let i = 0; i < mats.length; i += 5) {
    const { error } = await sb.from("materials").upsert(mats.slice(i, i + 5), { onConflict: "user_id,id" });
    if (error) throw error;
  }
  for (let i = 0; i < qs.length; i += 100) {
    const { error } = await sb.from("questions").upsert(qs.slice(i, i + 100), { onConflict: "user_id,id" });
    if (error) {
      if (hasChoice && /kind|choices|answer_index|column/i.test(error.message || "")) {
        throw new Error("三択問題を入れるには、先に保管庫の追加の設定（002_choice_and_exams.sql）を実行してください");
      }
      throw error;
    }
  }
  await resync();
  return { materials: mats.length, questions: qs.length };
}

// ===== ファイル（音声・動画・スライド） =====
export function mediaFor(mid, kind) {
  return state.media.find((m) => m.material_id === mid && m.kind === kind) || null;
}

function extOf(name) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name);
  return m ? m[1].toLowerCase() : "bin";
}

export async function uploadMedia(mid, kind, file) {
  const uid = state.user.id;
  const old = mediaFor(mid, kind);
  const path = `${uid}/${mid}/${kind}-${Date.now()}.${extOf(file.name)}`;
  const mime = file.type || "application/octet-stream";
  const up = await sb.storage.from("media").upload(path, file, { contentType: mime, upsert: false });
  if (up.error) throw up.error;
  const row = {
    user_id: uid,
    material_id: mid,
    kind,
    storage_path: path,
    file_name: file.name,
    mime,
    size_bytes: file.size,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("media").upsert(row, { onConflict: "user_id,material_id,kind" });
  if (error) {
    await sb.storage.from("media").remove([path]);
    throw error;
  }
  if (old && old.storage_path !== path) await sb.storage.from("media").remove([old.storage_path]);
  await blobs.del(`${mid}:${kind}`);
  await resync();
}

export async function deleteMedia(mid, kind) {
  const m = mediaFor(mid, kind);
  if (!m) return;
  const { error } = await sb.from("media").delete().eq("material_id", mid).eq("kind", kind);
  if (error) throw error;
  await sb.storage.from("media").remove([m.storage_path]);
  await blobs.del(`${mid}:${kind}`);
  await resync();
}

export async function signedUrl(path) {
  const { data, error } = await sb.storage.from("media").createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

// この端末に保存されているファイル（古いものは null）
export async function localMedia(mid, kind) {
  const m = mediaFor(mid, kind);
  const saved = await blobs.get(`${mid}:${kind}`);
  if (!saved) return null;
  if (m && saved.storage_path !== m.storage_path) return null;
  return saved;
}

export async function downloadMedia(mid, kind, onProgress) {
  const m = mediaFor(mid, kind);
  if (!m) throw new Error("ファイルがまだアップロードされていません");
  const url = await signedUrl(m.storage_path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ダウンロードに失敗しました（${res.status}）`);
  let blob;
  if (res.body && onProgress) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(got / (m.size_bytes || got));
    }
    blob = new Blob(chunks, { type: m.mime });
  } else {
    blob = await res.blob();
  }
  await blobs.set(`${mid}:${kind}`, { blob, storage_path: m.storage_path, mime: m.mime, size: blob.size });
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  return blob;
}

export async function removeLocal(mid, kind) {
  await blobs.del(`${mid}:${kind}`);
}

export async function localKeys() {
  return blobs.keys();
}
