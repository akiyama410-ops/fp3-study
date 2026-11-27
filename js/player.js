// 聞き流しプレイヤー（画面を切り替えても再生を続ける）
import * as D from "./data.js";
import { sortedMaterials } from "./stats.js";

const audio = new Audio();
audio.preload = "auto";

function readPref(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch (_) {
    return fallback;
  }
}
function writePref(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

export const P = {
  audio,
  queue: [], // 教材IDの並び
  index: -1,
  scope: readPref("fp3-listen-scope", "all"),
  shuffle: readPref("fp3-listen-shuffle", false),
  repeat: readPref("fp3-listen-repeat", false),
  speed: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].includes(Number(localStorage.getItem("fp3-speed"))) ? Number(localStorage.getItem("fp3-speed")) : 1,
  volume: readPref("fp3-volume", 1),
  sleepAt: null, // 止める時刻（ミリ秒）
  sleepEnd: false, // 今の音声が終わったら止める
  sleepChoice: "", // 画面の選択欄に出す値
  error: "",
  loading: false,
};

// iPhone・iPad では Web から音量を変えられない（本体のボタンだけ）
export const canSetVolume = (() => {
  const a = new Audio();
  a.volume = 0.5;
  return a.volume === 0.5;
})();
audio.volume = canSetVolume ? P.volume : 1;

const subs = new Set();
export function onPlayer(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
function notify(kind = "change") {
  for (const fn of subs) {
    try {
      fn(kind);
    } catch (e) {
      console.error(e);
    }
  }
}

export function currentId() {
  return P.index >= 0 ? P.queue[P.index] : null;
}
export function isPlaying() {
  return !audio.paused && !audio.ended && !!audio.src;
}

function shuffled(list) {
  const b = [...list];
  for (let i = b.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

// 範囲（"all" か 分野キー）の中で、音声がある教材
export function tracksFor(scope) {
  return sortedMaterials()
    .filter((m) => D.mediaFor(m.id, "audio") && (scope === "all" || m.field === scope))
    .map((m) => m.id);
}

let objectUrl = null;
async function sourceFor(mid) {
  const local = await D.localMedia(mid, "audio");
  if (local) return { url: URL.createObjectURL(local.blob), blob: true };
  if (!navigator.onLine) return null;
  try {
    return { url: await D.signedUrl(D.mediaFor(mid, "audio").storage_path), blob: false };
  } catch (_) {
    return null;
  }
}

function nextIndex(i) {
  if (i + 1 < P.queue.length) return i + 1;
  return P.repeat && P.queue.length ? 0 : -1;
}

let doneMarked = false;
let loadToken = 0;
async function loadIndex(i, autoplay) {
  const token = ++loadToken;
  P.loading = true;
  P.error = "";
  notify();
  for (let tries = 0; tries < P.queue.length && i >= 0; tries += 1) {
    const mid = P.queue[i];
    const src = await sourceFor(mid);
    if (token !== loadToken) return;
    if (src) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = src.blob ? src.url : null;
      audio.src = src.url;
      audio.playbackRate = P.speed;
      P.index = i;
      doneMarked = false;
      P.loading = false;
      updateMediaSession();
      notify();
      if (autoplay) audio.play().catch(() => notify());
      return;
    }
    i = nextIndex(i);
  }
  P.loading = false;
  P.error = navigator.onLine
    ? "再生できる音声がありません。"
    : "電波がないため再生できません。電波のあるところで「この端末に保存」をしておくと、電波なしでも聞けます。";
  audio.pause();
  notify();
}

// 範囲を決めて再生を始める
export async function start(scope, startId) {
  P.scope = scope;
  writePref("fp3-listen-scope", scope);
  let list = tracksFor(scope);
  if (P.shuffle) {
    list = shuffled(list);
    if (startId) list = [startId, ...list.filter((x) => x !== startId)];
  }
  P.queue = list;
  const i = startId ? Math.max(0, list.indexOf(startId)) : 0;
  if (!list.length) {
    P.index = -1;
    P.error = "この範囲には、まだ音声がアップロードされていません。";
    notify();
    return;
  }
  await loadIndex(i, true);
}

export function playAt(i) {
  if (i >= 0 && i < P.queue.length) loadIndex(i, true);
}

export function toggle() {
  if (!audio.src) return start(P.scope);
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

export function next() {
  const i = nextIndex(P.index);
  if (i < 0) {
    audio.pause();
    return;
  }
  loadIndex(i, true);
}

export function prev() {
  if (audio.currentTime > 5 || P.index <= 0) {
    if (P.index <= 0 && P.repeat && audio.currentTime <= 5 && P.queue.length > 1) loadIndex(P.queue.length - 1, true);
    else audio.currentTime = 0;
    return;
  }
  loadIndex(P.index - 1, true);
}

export function skip(sec) {
  if (!audio.duration) return;
  audio.currentTime = Math.min(Math.max(0, audio.currentTime + sec), audio.duration - 0.5);
}

export function seek(sec) {
  if (audio.duration) audio.currentTime = Math.min(Math.max(0, sec), audio.duration - 0.5);
}

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

// 速さを変える（教材ページの音声・動画と共通の設定）
export function setSpeed(v) {
  const n = Number(v);
  P.speed = SPEEDS.includes(n) ? n : 1;
  audio.playbackRate = P.speed;
  try {
    localStorage.setItem("fp3-speed", String(P.speed));
  } catch (_) {}
  notify();
}

export function speedOptions(current) {
  return SPEEDS.map((v) => `<option value="${v}" ${v === current ? "selected" : ""}>${v}倍</option>`).join("");
}

export function setVolume(v) {
  P.volume = Math.min(1, Math.max(0, v));
  audio.volume = P.volume;
  writePref("fp3-volume", P.volume);
  notify("tick");
}

export function setRepeat(on) {
  P.repeat = on;
  writePref("fp3-listen-repeat", on);
  notify();
}

export function setShuffle(on) {
  P.shuffle = on;
  writePref("fp3-listen-shuffle", on);
  // 再生中なら、今の音声はそのままで、残りの順番を並べかえる
  if (P.queue.length && P.index >= 0) {
    const cur = P.queue[P.index];
    const all = tracksFor(P.scope);
    P.queue = on ? [cur, ...shuffled(all.filter((x) => x !== cur))] : all;
    P.index = Math.max(0, P.queue.indexOf(cur));
  }
  notify();
}

// minutes: 数字（分）／ "end"（今の音声が終わったら）／ null（なし）
export function setSleep(minutes) {
  P.sleepAt = typeof minutes === "number" ? Date.now() + minutes * 60000 : null;
  P.sleepEnd = minutes === "end";
  P.sleepChoice = minutes == null ? "" : String(minutes);
  notify();
}

function checkSleep() {
  if (P.sleepAt && Date.now() >= P.sleepAt) {
    P.sleepAt = null;
    P.sleepChoice = "";
    audio.pause();
    notify();
  }
}
setInterval(checkSleep, 1000);

// ===== 勉強時間・「聞いた」の記録 =====
let playStart = null;
function stopTimer() {
  if (playStart == null) return;
  D.addStudy(Math.min((Date.now() - playStart) / 1000, 3 * 3600), "listen");
  playStart = null;
}

audio.addEventListener("play", () => {
  if (playStart == null) playStart = Date.now();
  // ほかの画面の音声・動画は止める
  document.querySelectorAll("audio, video").forEach((el) => el.pause());
  updateMediaSession();
  notify();
});
audio.addEventListener("pause", () => {
  stopTimer();
  notify();
});
audio.addEventListener("ratechange", () => {
  if (audio.playbackRate !== P.speed) audio.playbackRate = P.speed;
});
audio.addEventListener("timeupdate", () => {
  checkSleep();
  const mid = currentId();
  if (mid && !doneMarked && audio.duration && audio.currentTime / audio.duration > 0.95) {
    doneMarked = true;
    if (!D.getProgress(mid, "audio").done) D.setProgress(mid, "audio", { done: true });
  }
  notify("tick");
});
audio.addEventListener("ended", () => {
  stopTimer();
  const mid = currentId();
  if (mid && !D.getProgress(mid, "audio").done) D.setProgress(mid, "audio", { done: true });
  if (P.sleepEnd) {
    P.sleepEnd = false;
    P.sleepChoice = "";
    notify();
    return;
  }
  next();
});
audio.addEventListener("error", () => {
  P.error = "この音声を再生できませんでした。次の音声に進みます。";
  notify();
  setTimeout(() => next(), 1500);
});

// 教材ページの音声・動画を再生したら、聞き流しは止める
document.addEventListener("play", (e) => { if (e.target !== audio) audio.pause(); }, true);

// ===== ロック画面・イヤホンのボタン =====
function updateMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const mid = currentId();
  const m = mid && D.state.materials.find((x) => x.id === mid);
  if (m) navigator.mediaSession.metadata = new MediaMetadata({ title: m.title, artist: "FP3級 学習ノート（聞き流し）" });
  const set = (action, fn) => {
    try {
      navigator.mediaSession.setActionHandler(action, fn);
    } catch (_) {}
  };
  set("play", () => audio.play().catch(() => {}));
  set("pause", () => audio.pause());
  set("previoustrack", () => prev());
  set("nexttrack", () => next());
  set("seekbackward", () => skip(-15));
  set("seekforward", () => skip(15));
  set("seekto", (d) => seek(d.seekTime));
}
