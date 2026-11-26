// FP3級 学習アプリ 画面まわり
import { FIELDS, KIND_LABEL, STORAGE_LIMIT, FILE_LIMIT } from "./config.js";
import * as D from "./data.js";
import * as S from "./stats.js";

const { state } = D;
const view = document.getElementById("view");
const syncBadge = document.getElementById("sync-badge");
const nav = document.getElementById("nav");

// ===== 小さな道具 =====
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function fieldInfo(key) {
  return FIELDS.find((f) => f.key === key) || { key, name: key, short: key, color: "#718096" };
}
function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)}MB`;
}
function bar(rate, color) {
  return `<div class="bar"><span style="width:${Math.round((rate || 0) * 100)}%;${color ? `background:${color}` : ""}"></span></div>`;
}
function toast(msg) {
  document.querySelectorAll(".toast").forEach((x) => x.remove());
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}
function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed,form,link,meta").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "style") el.removeAttribute(attr.name);
      if ((name === "href" || name === "src") && !/^https:\/\//i.test(attr.value)) el.removeAttribute(attr.name);
    }
    if (el.tagName === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
  });
  return doc.body.firstChild.innerHTML;
}

// ===== 勉強時間の計測 =====
class Timer {
  constructor(source, maxSegment = 3 * 3600) {
    this.source = source;
    this.maxSegment = maxSegment;
    this.t0 = null;
  }
  start() {
    if (this.t0 == null) this.t0 = Date.now();
  }
  stop() {
    if (this.t0 == null) return;
    const sec = Math.min((Date.now() - this.t0) / 1000, this.maxSegment);
    this.t0 = null;
    D.addStudy(sec, this.source);
  }
}
const activeTimers = new Set();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    for (const t of activeTimers) if (t.pauseOnHide && t.t0 != null) { t.stop(); t.resumeOnShow = true; }
  } else {
    for (const t of activeTimers) if (t.resumeOnShow) { t.resumeOnShow = false; t.start(); }
  }
});

// ===== 画面の切り替え =====
let current = null; // { cleanup, live }
let renderToken = 0;

function parseRoute() {
  const parts = (location.hash.replace(/^#\/?/, "") || "").split("/").map(decodeURIComponent);
  return parts.filter((p) => p !== "");
}

async function render() {
  const token = ++renderToken;
  if (current && current.cleanup) current.cleanup();
  current = null;
  updateSyncBadge();
  window.scrollTo(0, 0);

  if (!state.user) {
    nav.hidden = true;
    current = loginView();
    return;
  }
  nav.hidden = false;
  const [page, a, b] = parseRoute();
  setActiveNav(page || "home");
  const ctx = { token, alive: () => token === renderToken };
  if (!page) current = homeView();
  else if (page === "fields") current = fieldsView();
  else if (page === "field") current = fieldView(a);
  else if (page === "m") current = await materialView(a, b, ctx);
  else if (page === "quiz") current = quizView(a);
  else if (page === "record") current = recordView(b);
  else if (page === "plan") current = planView();
  else if (page === "admin") current = adminView(ctx);
  else current = homeView();
}

function setActiveNav(page) {
  const map = { home: "home", fields: "fields", field: "fields", m: "fields", quiz: "fields", record: "record", plan: "plan", admin: "admin" };
  for (const a of nav.querySelectorAll("a")) a.classList.toggle("active", a.dataset.nav === map[page]);
}

function updateSyncBadge() {
  let text = "同期済み";
  let cls = "ok";
  if (!navigator.onLine) {
    text = state.queue.length ? `オフライン（未送信${state.queue.length}件）` : "オフライン";
    cls = "off";
  } else if (state.syncing) {
    text = "同期中…";
    cls = "busy";
  } else if (state.syncError) {
    text = "同期エラー";
    cls = "err";
  } else if (state.queue.length) {
    text = `未送信${state.queue.length}件`;
    cls = "busy";
  }
  syncBadge.textContent = state.user ? text : "";
  syncBadge.className = `badge ${cls}`;
}

D.onChange(() => {
  updateSyncBadge();
  const loggedIn = !!state.user;
  if (!current || !!current.isLogin === loggedIn || current.live) render();
});
window.addEventListener("hashchange", render);
window.addEventListener("online", updateSyncBadge);
window.addEventListener("offline", updateSyncBadge);

// ===== ログイン =====
function loginView() {
  view.innerHTML = `
    <section class="card login">
      <h1>FP3級 学習ノート</h1>
      <p>自分専用の学習アプリです。登録したメールアドレスでログインしてください。</p>
      <form id="f-email">
        <label>メールアドレス<input type="email" id="email" autocomplete="email" required></label>
        <button class="btn primary" type="submit">ログイン用のコードを送る</button>
      </form>
      <form id="f-code" hidden>
        <p class="note">メールに届いた数字のコードを入れてください。</p>
        <label>コード<input inputmode="numeric" autocomplete="one-time-code" id="code" required></label>
        <button class="btn primary" type="submit">ログイン</button>
        <button class="btn" type="button" id="back">メールアドレスを入れ直す</button>
      </form>
      <p class="note" id="login-msg"></p>
    </section>`;
  const msg = view.querySelector("#login-msg");
  const fEmail = view.querySelector("#f-email");
  const fCode = view.querySelector("#f-code");
  if (!navigator.onLine) msg.textContent = "ログインには電波が必要です。";
  fEmail.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = fEmail.querySelector("button");
    btn.disabled = true;
    msg.textContent = "送信中…";
    try {
      await D.sendCode(view.querySelector("#email").value.trim());
      fEmail.hidden = true;
      fCode.hidden = false;
      msg.textContent = "コードを送りました。メールを確認してください（迷惑メールフォルダも見てください）。";
      view.querySelector("#code").focus();
    } catch (err) {
      msg.textContent = `送れませんでした：${err.message}`;
    } finally {
      btn.disabled = false;
    }
  });
  fCode.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = fCode.querySelector("button");
    btn.disabled = true;
    msg.textContent = "確認中…";
    try {
      await D.verifyCode(view.querySelector("#email").value.trim(), view.querySelector("#code").value.trim());
      location.hash = "#/";
    } catch (err) {
      msg.textContent = `ログインできませんでした：${err.message}`;
      btn.disabled = false;
    }
  });
  view.querySelector("#back").addEventListener("click", () => {
    fCode.hidden = true;
    fEmail.hidden = false;
    msg.textContent = "";
  });
  return { isLogin: true };
}

// ===== ホーム =====
function emptyNotice() {
  return `<section class="card"><h2>はじめに</h2><p>まだ教材が入っていません。パソコンで「管理」を開いて、教材データ（fp3-seed.json）を取り込んでください。</p><a class="btn primary" href="#/admin">管理を開く</a></section>`;
}

function homeView() {
  if (!state.materials.length) {
    view.innerHTML = emptyNotice();
    return { live: true };
  }
  const days = S.daysUntilExam();
  const acc = S.accuracy();
  const p = S.plan();
  const todayList = p.schedule[0] ? p.schedule[0].materials : [];
  const wrong = S.wrongQuestions().length;
  view.innerHTML = `
    <section class="card hero">
      <div class="hero-days"><span>試験まで</span><strong>${days >= 0 ? days : 0}</strong><span>日</span></div>
      <div class="muted">試験日 ${esc(state.settings.exam_date)}</div>
    </section>
    <section class="grid4">
      <div class="stat"><span>全体の進み具合</span><strong>${S.pct(S.overallRate())}</strong></div>
      <div class="stat"><span>正解率</span><strong>${acc.rate == null ? "—" : S.pct(acc.rate)}</strong></div>
      <div class="stat"><span>連続</span><strong>${S.streak()}日</strong></div>
      <div class="stat"><span>勉強時間</span><strong>${S.fmtDuration(S.totalSeconds())}</strong></div>
    </section>
    <section class="card">
      <h2>今日やること</h2>
      ${
        todayList.length
          ? `<ul class="list">${todayList.map((m) => materialRow(m)).join("")}</ul>`
          : `<p>すべての教材が終わりました！ まちがえた問題の解き直しで仕上げましょう。</p>`
      }
      ${wrong ? `<a class="btn" href="#/quiz/wrong">まちがえた問題を解き直す（${wrong}問）</a>` : ""}
    </section>
    <section class="card">
      <h2>分野ごとの進み具合</h2>
      <ul class="list">
        ${FIELDS.map((f) => {
          const r = S.fieldRate(f.key);
          const fa = S.accuracy((q) => S.fieldOfMaterial(q.material_id) === f.key);
          return `<li><a class="row" href="#/field/${f.key}">
            <span class="dot" style="background:${f.color}"></span>
            <span class="grow"><span class="row-title">${esc(f.name)}</span>${bar(r, f.color)}</span>
            <span class="num">${S.pct(r)}<small>${fa.rate == null ? "" : `正解${S.pct(fa.rate)}`}</small></span>
          </a></li>`;
        }).join("")}
      </ul>
    </section>`;
  return { live: true };
}

function materialRow(m) {
  const f = fieldInfo(m.field);
  const r = S.materialRate(m.id);
  return `<li><a class="row" href="#/m/${encodeURIComponent(m.id)}">
    <span class="dot" style="background:${f.color}"></span>
    <span class="grow"><span class="row-title">${esc(m.title)}</span>${bar(r, f.color)}</span>
    <span class="num">${r >= 1 ? "完了" : S.pct(r)}</span>
  </a></li>`;
}

// ===== 教材一覧 =====
function fieldsView() {
  if (!state.materials.length) {
    view.innerHTML = emptyNotice();
    return { live: true };
  }
  view.innerHTML = `
    <div class="toolbar"><a class="btn" href="#/quiz/all">ランダムに20問</a><a class="btn" href="#/quiz/wrong">まちがえた問題</a></div>
    ${FIELDS.map((f) => {
      const ms = S.materialsOf(f.key);
      if (!ms.length) return "";
      return `<section class="card"><h2><a href="#/field/${f.key}" style="color:${f.color}">${esc(f.name)}</a> <small>${S.pct(S.fieldRate(f.key))}</small></h2>
        <ul class="list">${ms.map(materialRow).join("")}</ul></section>`;
    }).join("")}`;
  return { live: true };
}

function fieldView(key) {
  const f = fieldInfo(key);
  const ms = S.materialsOf(key);
  const acc = S.accuracy((q) => S.fieldOfMaterial(q.material_id) === key);
  view.innerHTML = `
    <a class="back" href="#/fields">‹ 教材一覧</a>
    <section class="card">
      <h1 style="color:${f.color}">${esc(f.name)}</h1>
      <p>進み具合 ${S.pct(S.fieldRate(key))} ・ 正解率 ${acc.rate == null ? "—" : S.pct(acc.rate)}（${acc.answered}問解答）</p>
      ${bar(S.fieldRate(key), f.color)}
      <div class="toolbar"><a class="btn primary" href="#/quiz/f-${key}">この分野の問題を解く</a></div>
    </section>
    <section class="card"><ul class="list">${ms.map(materialRow).join("")}</ul></section>`;
  return { live: true };
}

// ===== 教材ページ =====
async function materialView(mid, tab, ctx) {
  const m = state.materials.find((x) => x.id === mid);
  if (!m) {
    view.innerHTML = `<section class="card"><p>教材が見つかりません。</p><a class="btn" href="#/fields">教材一覧へ</a></section>`;
    return { live: true };
  }
  const f = fieldInfo(m.field);
  const tabs = [];
  if (D.mediaFor(mid, "audio")) tabs.push("audio");
  if (D.mediaFor(mid, "video")) tabs.push("video");
  if (D.mediaFor(mid, "slides")) tabs.push("slides");
  tabs.push("text");
  if (S.questionsOf(mid).length) tabs.push("quiz");
  const active = tabs.includes(tab) ? tab : tabs[0];

  view.innerHTML = `
    <a class="back" href="#/field/${m.field}">‹ ${esc(f.name)}</a>
    <section class="card">
      <h1>${esc(m.title)}</h1>
      <div id="chips" class="chips"></div>
    </section>
    <div class="tabs">${tabs
      .map((t) => `<a class="tab ${t === active ? "active" : ""}" href="#/m/${encodeURIComponent(mid)}/${t}">${KIND_LABEL[t]}</a>`)
      .join("")}</div>
    <section class="card" id="panel"></section>
    ${tabs.length === 2 && !D.mediaFor(mid, "audio") ? `<p class="note">音声・動画・スライドは、パソコンの「管理」からアップロードできます。</p>` : ""}`;

  const chips = view.querySelector("#chips");
  const drawChips = () => {
    chips.innerHTML = S.materialItems(mid)
      .map((i) => `<span class="chip ${i.done ? "done" : ""}">${i.done ? "✓ " : ""}${KIND_LABEL[i.kind]}</span>`)
      .join("");
  };
  drawChips();
  const off = D.onChange(drawChips);

  const panel = view.querySelector("#panel");
  let cleanupPanel = null;
  if (active === "audio" || active === "video") cleanupPanel = await mediaPanel(panel, m, active, ctx);
  else if (active === "slides") cleanupPanel = await slidesPanel(panel, m, ctx);
  else if (active === "text") cleanupPanel = textPanel(panel, m);
  else if (active === "quiz") quizPanel(panel, m);

  return {
    live: false,
    cleanup() {
      off();
      if (cleanupPanel) cleanupPanel();
    },
  };
}

function doneButton(mid, kind, labelDone, labelTodo) {
  const btn = document.createElement("button");
  btn.className = "btn done-toggle";
  const draw = () => {
    const done = D.getProgress(mid, kind).done;
    btn.textContent = done ? `✓ ${labelDone}` : labelTodo;
    btn.classList.toggle("is-done", done);
  };
  draw();
  btn.addEventListener("click", async () => {
    await D.setProgress(mid, kind, { done: !D.getProgress(mid, kind).done });
    draw();
  });
  return btn;
}

async function storageLine(panel, m, kind, onSaved) {
  const media = D.mediaFor(m.id, kind);
  const box = document.createElement("div");
  box.className = "save-line";
  const draw = async () => {
    const local = await D.localMedia(m.id, kind);
    box.innerHTML = local
      ? `<span>📱 この端末に保存済み（${mb(local.size)}）</span><button class="btn small" data-act="del">端末から消す</button>`
      : `<span>${navigator.onLine ? "ネットから再生中" : "電波がないため再生できません"}</span><button class="btn small primary" data-act="save" ${navigator.onLine ? "" : "disabled"}>この端末に保存（${mb(media.size_bytes)}）</button>`;
  };
  box.addEventListener("click", async (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (!act) return;
    e.target.disabled = true;
    if (act === "save") {
      try {
        await D.downloadMedia(m.id, kind, (r) => {
          e.target.textContent = `保存中… ${Math.round(r * 100)}%`;
        });
        toast("この端末に保存しました");
        if (onSaved) onSaved();
      } catch (err) {
        toast(`保存できませんでした：${err.message}`);
      }
    } else if (act === "del") {
      await D.removeLocal(m.id, kind);
      toast("端末から消しました");
    }
    await draw();
  });
  await draw();
  panel.appendChild(box);
  return draw;
}

async function mediaSource(m, kind) {
  const local = await D.localMedia(m.id, kind);
  if (local) return { url: URL.createObjectURL(local.blob), revoke: true };
  if (!navigator.onLine) return null;
  try {
    return { url: await D.signedUrl(D.mediaFor(m.id, kind).storage_path), revoke: false };
  } catch (e) {
    return null;
  }
}

async function mediaPanel(panel, m, kind, ctx) {
  const src = await mediaSource(m, kind);
  if (!ctx.alive()) {
    if (src && src.revoke) URL.revokeObjectURL(src.url);
    return null;
  }
  panel.innerHTML = "";
  const el = document.createElement(kind);
  el.controls = true;
  el.preload = "metadata";
  el.setAttribute("playsinline", "");
  el.className = kind === "video" ? "video" : "audio";
  if (src) el.src = src.url;
  panel.appendChild(el);

  const ctrl = document.createElement("div");
  ctrl.className = "player-ctrl";
  const speeds = [0.75, 1, 1.25, 1.5, 1.75, 2];
  let speed = Number(localStorage.getItem("fp3-speed")) || 1;
  ctrl.innerHTML = `<button class="btn" data-seek="-15">↺ 15秒</button><button class="btn" data-speed>${speed}倍</button><button class="btn" data-seek="15">15秒 ↻</button>`;
  panel.appendChild(ctrl);
  ctrl.addEventListener("click", (e) => {
    const t = e.target;
    if (t.dataset.seek) el.currentTime = Math.max(0, el.currentTime + Number(t.dataset.seek));
    if ("speed" in t.dataset) {
      speed = speeds[(speeds.indexOf(speed) + 1) % speeds.length] || 1;
      el.playbackRate = speed;
      t.textContent = `${speed}倍`;
      try { localStorage.setItem("fp3-speed", String(speed)); } catch (_) {}
    }
  });

  const label = kind === "audio" ? ["聞いた", "聞いたらチェック"] : ["見た", "見たらチェック"];
  panel.appendChild(doneButton(m.id, kind, ...label));
  await storageLine(panel, m, kind, null);

  const prog = D.getProgress(m.id, kind);
  el.addEventListener("loadedmetadata", () => {
    el.playbackRate = speed;
    if (prog.position_sec > 5 && el.duration && prog.position_sec < el.duration - 5) el.currentTime = prog.position_sec;
  });
  el.addEventListener("ratechange", () => {
    if (el.playbackRate !== speed) el.playbackRate = speed;
  });

  const timer = new Timer(kind);
  activeTimers.add(timer);
  let lastSave = 0;
  const savePos = (force) => {
    if (!el.duration) return;
    const now = Date.now();
    if (!force && now - lastSave < 10000) return;
    lastSave = now;
    const patch = { position_sec: el.currentTime };
    if (el.currentTime / el.duration > 0.95) patch.done = true;
    D.setProgress(m.id, kind, patch, { silent: !patch.done || D.getProgress(m.id, kind).done });
  };
  el.addEventListener("play", () => timer.start());
  el.addEventListener("pause", () => { timer.stop(); savePos(true); });
  el.addEventListener("ended", () => { timer.stop(); D.setProgress(m.id, kind, { done: true, position_sec: 0 }); });
  el.addEventListener("timeupdate", () => savePos(false));

  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: m.title, artist: "FP3級 学習ノート" });
    navigator.mediaSession.setActionHandler("seekbackward", () => { el.currentTime = Math.max(0, el.currentTime - 15); });
    navigator.mediaSession.setActionHandler("seekforward", () => { el.currentTime += 15; });
  }

  if (!src) {
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = "電波がない場所で使うには、電波のあるところで「この端末に保存」を押しておいてください。";
    panel.insertBefore(p, el);
  }
  return () => {
    savePos(true);
    el.pause();
    timer.stop();
    activeTimers.delete(timer);
    if (src && src.revoke) URL.revokeObjectURL(src.url);
  };
}

let pdfLoading = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfLoading) {
    pdfLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "vendor/pdf.min.js";
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
        resolve(window.pdfjsLib);
      };
      s.onerror = () => reject(new Error("PDFビューアを読み込めませんでした"));
      document.head.appendChild(s);
    });
  }
  return pdfLoading;
}

async function slidesPanel(panel, m, ctx) {
  const media = D.mediaFor(m.id, "slides");
  const timer = new Timer("slides", 1800);
  timer.pauseOnHide = true;
  activeTimers.add(timer);
  timer.start();
  panel.innerHTML = "";
  panel.appendChild(doneButton(m.id, "slides", "見た", "見たらチェック"));
  await storageLine(panel, m, "slides", () => render());
  const holder = document.createElement("div");
  holder.className = "slides";
  holder.textContent = "読み込み中…";
  panel.appendChild(holder);
  let objectUrl = null;
  try {
    const local = await D.localMedia(m.id, "slides");
    let blob = local ? local.blob : null;
    if (!blob) {
      if (!navigator.onLine) throw new Error("電波がないため表示できません。電波のあるところで「この端末に保存」を押しておいてください。");
      const res = await fetch(await D.signedUrl(media.storage_path));
      blob = await res.blob();
    }
    if (!ctx.alive()) return null;
    holder.textContent = "";
    if (media.mime.startsWith("image/")) {
      objectUrl = URL.createObjectURL(blob);
      const img = document.createElement("img");
      img.src = objectUrl;
      img.alt = m.title;
      holder.appendChild(img);
    } else {
      const pdfjs = await loadPdfJs();
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      const width = holder.clientWidth || 360;
      for (let i = 1; i <= pdf.numPages; i += 1) {
        if (!ctx.alive()) break;
        const page = await pdf.getPage(i);
        const vp1 = page.getViewport({ scale: 1 });
        const scale = (width / vp1.width) * (window.devicePixelRatio || 1);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = vp.width;
        canvas.height = vp.height;
        canvas.style.width = "100%";
        holder.appendChild(canvas);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      }
    }
  } catch (err) {
    holder.textContent = err.message;
  }
  return () => {
    timer.stop();
    activeTimers.delete(timer);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
}

function textPanel(panel, m) {
  const timer = new Timer("text", 1800);
  timer.pauseOnHide = true;
  activeTimers.add(timer);
  timer.start();
  panel.innerHTML = `<article class="doc">${sanitize(m.content_html)}</article>`;
  panel.appendChild(doneButton(m.id, "text", "読んだ", "読み終わったらチェック"));
  return () => {
    timer.stop();
    activeTimers.delete(timer);
  };
}

function quizPanel(panel, m) {
  const qs = S.questionsOf(m.id);
  const latest = S.latestAttempts();
  const acc = S.accuracy((q) => q.material_id === m.id);
  const wrong = qs.filter((q) => latest[q.id] && !latest[q.id].correct).length;
  panel.innerHTML = `
    <p>${qs.length}問 ・ 解答 ${acc.answered}問 ・ 正解率 ${acc.rate == null ? "—" : S.pct(acc.rate)}</p>
    <div class="toolbar">
      <a class="btn primary" href="#/quiz/m-${encodeURIComponent(m.id)}">全問解く</a>
      ${wrong ? `<a class="btn" href="#/quiz/mw-${encodeURIComponent(m.id)}">まちがえた問題（${wrong}問）</a>` : ""}
    </div>
    <ol class="qlist">${qs
      .map((q) => {
        const a = latest[q.id];
        const mark = a ? (a.correct ? `<span class="ok">○ 正解</span>` : `<span class="ng">× 不正解</span>`) : `<span class="muted">未解答</span>`;
        return `<li>${esc(q.text)} ${mark}</li>`;
      })
      .join("")}</ol>`;
}

// ===== ○×問題 =====
function quizView(scope = "all") {
  let list = [];
  let title = "";
  let back = "#/fields";
  const latest = S.latestAttempts();
  if (scope.startsWith("m-")) {
    const mid = scope.slice(2);
    list = S.questionsOf(mid);
    const m = state.materials.find((x) => x.id === mid);
    title = m ? m.title : "";
    back = `#/m/${encodeURIComponent(mid)}/quiz`;
  } else if (scope.startsWith("mw-")) {
    const mid = scope.slice(3);
    list = S.questionsOf(mid).filter((q) => latest[q.id] && !latest[q.id].correct);
    title = "まちがえた問題";
    back = `#/m/${encodeURIComponent(mid)}/quiz`;
  } else if (scope.startsWith("f-")) {
    const key = scope.slice(2);
    list = shuffle(state.questions.filter((q) => S.fieldOfMaterial(q.material_id) === key));
    title = fieldInfo(key).name;
    back = `#/field/${key}`;
  } else if (scope === "wrong") {
    list = shuffle(S.wrongQuestions());
    title = "まちがえた問題";
    back = "#/";
  } else {
    list = shuffle(state.questions).slice(0, 20);
    title = "ランダム20問";
  }
  const timer = new Timer("quiz", 1800);
  timer.pauseOnHide = true;
  activeTimers.add(timer);
  timer.start();

  let i = 0;
  let score = 0;
  const missed = [];
  const draw = () => {
    if (!list.length) {
      view.innerHTML = `<a class="back" href="${back}">‹ もどる</a><section class="card"><p>解く問題がありません。</p></section>`;
      return;
    }
    if (i >= list.length) {
      view.innerHTML = `<a class="back" href="${back}">‹ もどる</a>
        <section class="card result">
          <h1>${esc(title)}</h1>
          <p class="big">${score} / ${list.length} 問正解</p>
          ${bar(score / list.length)}
          <div class="toolbar">
            ${missed.length ? `<button class="btn primary" id="retry">まちがえた${missed.length}問をもう一度</button>` : ""}
            <a class="btn" href="${back}">終わる</a>
          </div>
        </section>`;
      const retry = view.querySelector("#retry");
      if (retry) retry.addEventListener("click", () => { list = shuffle(missed.splice(0)); i = 0; score = 0; draw(); });
      return;
    }
    const q = list[i];
    const m = state.materials.find((x) => x.id === q.material_id);
    view.innerHTML = `<a class="back" href="${back}">‹ やめる</a>
      <section class="card quiz">
        <div class="muted">${esc(title)} ・ ${i + 1} / ${list.length}${m && !scope.startsWith("m") ? ` ・ ${esc(m.title)}` : ""}</div>
        ${bar(i / list.length)}
        <p class="question">${esc(q.text)}</p>
        <div class="answer-btns"><button class="btn ans" data-a="1">○</button><button class="btn ans" data-a="0">×</button></div>
        <div id="feedback"></div>
      </section>`;
    view.querySelectorAll(".ans").forEach((b) =>
      b.addEventListener("click", async () => {
        const choice = b.dataset.a === "1";
        const correct = choice === q.answer;
        if (correct) score += 1;
        else missed.push(q);
        view.querySelectorAll(".ans").forEach((x) => { x.disabled = true; });
        b.classList.add(correct ? "right" : "wrong");
        view.querySelector("#feedback").innerHTML = `
          <p class="verdict ${correct ? "ok" : "ng"}">${correct ? "正解！" : "不正解…"}　答えは「${q.answer ? "○" : "×"}」</p>
          <p class="explain">${esc(q.explanation)}</p>
          <button class="btn primary" id="next">${i + 1 < list.length ? "次の問題へ" : "結果を見る"}</button>`;
        view.querySelector("#next").addEventListener("click", () => { i += 1; draw(); window.scrollTo(0, 0); });
        await D.addAttempt(q.id, correct);
      }),
    );
  };
  draw();
  return {
    live: false,
    cleanup() {
      timer.stop();
      activeTimers.delete(timer);
    },
  };
}

// ===== 記録 =====
function recordView(monthStr) {
  const byDay = S.secondsByDay();
  const base = monthStr && /^\d{4}-\d{2}$/.test(monthStr) ? new Date(`${monthStr}-01T00:00:00`) : new Date();
  const y = base.getFullYear();
  const mo = base.getMonth();
  const first = new Date(y, mo, 1);
  const lastDay = new Date(y, mo + 1, 0).getDate();
  const prev = new Date(y, mo - 1, 1);
  const next = new Date(y, mo + 1, 1);
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const cells = [];
  for (let k = 0; k < first.getDay(); k += 1) cells.push(`<div class="cal-cell empty"></div>`);
  for (let d = 1; d <= lastDay; d += 1) {
    const ds = D.localDay(new Date(y, mo, d));
    const sec = byDay[ds];
    const min = sec ? Math.round(sec / 60) : 0;
    const lvl = ds in byDay ? (min >= 60 ? 4 : min >= 30 ? 3 : min >= 10 ? 2 : 1) : 0;
    cells.push(`<div class="cal-cell lv${lvl} ${ds === D.today() ? "today" : ""}"><span>${d}</span>${min ? `<small>${min}分</small>` : ""}</div>`);
  }
  const daysStudied = Object.keys(byDay).length;
  const acc = S.accuracy();
  view.innerHTML = `
    <section class="grid4">
      <div class="stat"><span>合計の勉強時間</span><strong>${S.fmtDuration(S.totalSeconds())}</strong></div>
      <div class="stat"><span>勉強した日</span><strong>${daysStudied}日</strong></div>
      <div class="stat"><span>連続</span><strong>${S.streak()}日</strong></div>
      <div class="stat"><span>正解率</span><strong>${acc.rate == null ? "—" : S.pct(acc.rate)}</strong></div>
    </section>
    <section class="card">
      <div class="cal-head"><a class="btn small" href="#/record/m/${key(prev)}">‹</a><h2>${y}年${mo + 1}月</h2><a class="btn small" href="#/record/m/${key(next)}">›</a></div>
      <div class="cal">${["日", "月", "火", "水", "木", "金", "土"].map((w) => `<div class="cal-w">${w}</div>`).join("")}${cells.join("")}</div>
    </section>
    <section class="card">
      <h2>分野ごとの成績</h2>
      <table class="table"><thead><tr><th>分野</th><th>進み具合</th><th>正解率</th><th>解答数</th></tr></thead><tbody>
      ${FIELDS.map((f) => {
        const a = S.accuracy((q) => S.fieldOfMaterial(q.material_id) === f.key);
        const total = state.questions.filter((q) => S.fieldOfMaterial(q.material_id) === f.key).length;
        return `<tr><td><span class="dot" style="background:${f.color}"></span>${esc(f.short)}</td><td>${S.pct(S.fieldRate(f.key))}</td><td>${a.rate == null ? "—" : S.pct(a.rate)}</td><td>${a.answered}/${total}</td></tr>`;
      }).join("")}
      </tbody></table>
    </section>`;
  return { live: true };
}

// ===== 計画 =====
function planView() {
  const p = S.plan();
  view.innerHTML = `
    <section class="card">
      <h2>試験日</h2>
      <form id="exam-form" class="inline">
        <input type="date" id="exam" value="${esc(state.settings.exam_date)}" required>
        <button class="btn primary" type="submit">保存</button>
      </form>
      <p>試験まで <strong>${Math.max(0, p.days)}日</strong> ・ 残りの教材 <strong>${p.remaining.length}個</strong></p>
      ${p.remaining.length ? `<p>1日 <strong>${p.perDay}教材</strong> ずつ進めると、${esc(p.reviewFrom)} からの最後の1週間を復習にあてられます。</p>` : `<p>全部の教材が終わりました！ 試験日までは、まちがえた問題の解き直しと、苦手な分野の音声の聞き直しをしましょう。</p>`}
    </section>
    ${p.schedule.length ? `<section class="card"><h2>これからの予定</h2><ul class="plan">${p.schedule
      .slice(0, 30)
      .map((s) => `<li><div class="plan-day">${esc(s.day)}${s.day === D.today() ? "（今日）" : ""}</div><ul class="list">${s.materials.map(materialRow).join("")}</ul></li>`)
      .join("")}</ul></section>` : ""}
    <section class="card"><h2>最後の1週間（復習）</h2><ul><li>まちがえた問題を全部解き直す</li><li>正解率の低い分野の音声をもう一度聞く</li><li>各教材の「覚えるべき数字の一覧」を見直す</li></ul>
      <a class="btn" href="#/quiz/wrong">まちがえた問題を解く</a></section>`;
  view.querySelector("#exam-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await D.saveSettings({ exam_date: view.querySelector("#exam").value });
    toast("試験日を保存しました");
  });
  return { live: true };
}

// ===== 管理 =====
function adminView(ctx) {
  const draw = async () => {
    if (!ctx.alive()) return;
    const used = state.media.reduce((s, m) => s + Number(m.size_bytes || 0), 0);
    const localKeys = new Set(await D.localKeys());
    let estimate = "";
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      if (est.usage != null) estimate = `この端末で使っている容量：${mb(est.usage)}`;
    }
    if (!ctx.alive()) return;
    const mats = S.sortedMaterials();
    view.innerHTML = `
      <section class="card">
        <h2>アカウント</h2>
        <p>${esc(state.user.email)}</p>
        <p class="muted">最後の同期：${state.lastSync ? esc(new Date(state.lastSync).toLocaleString("ja-JP")) : "まだ"}${state.syncError ? ` ／ エラー：${esc(state.syncError)}` : ""}</p>
        <div class="toolbar"><button class="btn" id="sync-now">今すぐ同期</button><button class="btn" id="logout">ログアウト</button></div>
      </section>

      <section class="card">
        <h2>教材データ</h2>
        <p>教材 ${state.materials.length}個 ・ ○×問題 ${state.questions.length}問</p>
        <label class="file">fp3-seed.json を選んで取り込む<input type="file" id="seed" accept="application/json,.json"></label>
        <p class="note">同じファイルをもう一度取り込むと、教材の文章が新しいものに置きかわります（学習の記録は消えません）。</p>
      </section>

      <section class="card">
        <h2>ファイルのアップロード</h2>
        <p>保管庫の使用量：<strong>${mb(used)}</strong> / ${mb(STORAGE_LIMIT)}（残り ${mb(Math.max(0, STORAGE_LIMIT - used))}）</p>
        ${bar(used / STORAGE_LIMIT, used > STORAGE_LIMIT * 0.9 ? "#c53030" : undefined)}
        <p class="note">1ファイル50MBまで。家族カレンダーのプロジェクトと容量を分け合うので、少し余裕を残しておきましょう。</p>
        <form id="up-form" class="stack">
          <label>教材<select id="up-mat">${mats.map((m) => `<option value="${esc(m.id)}">${esc(m.title)}</option>`).join("")}</select></label>
          <label>種類<select id="up-kind"><option value="audio">音声</option><option value="video">動画</option><option value="slides">スライド（PDF・画像）</option></select></label>
          <label class="file">ファイルを選ぶ<input type="file" id="up-file"></label>
          <button class="btn primary" type="submit">アップロード</button>
          <p class="note" id="up-msg"></p>
        </form>
      </section>

      <section class="card">
        <h2>アップロード済みのファイル</h2>
        <table class="table small"><thead><tr><th>教材</th><th>音声</th><th>動画</th><th>スライド</th></tr></thead><tbody>
        ${mats
          .map(
            (m) => `<tr><td>${esc(m.title)}</td>${["audio", "video", "slides"]
              .map((k) => {
                const md = D.mediaFor(m.id, k);
                if (!md) return `<td class="muted">—</td>`;
                return `<td>${mb(md.size_bytes)}${localKeys.has(`${m.id}:${k}`) ? " 📱" : ""}<br><button class="link-btn" data-del="${esc(m.id)}|${k}">削除</button></td>`;
              })
              .join("")}</tr>`,
          )
          .join("")}
        </tbody></table>
        <p class="note">📱 はこの端末に保存済みのしるしです。</p>
      </section>

      <section class="card">
        <h2>この端末に保存（電波なしで使うため）</h2>
        <p class="note">${esc(estimate)}</p>
        <label class="check"><input type="checkbox" id="dl-video"> 動画もまとめて保存する</label>
        <div class="toolbar"><button class="btn primary" id="dl-all">まとめてこの端末に保存</button><button class="btn" id="clear-local">この端末の保存ファイルを全部消す</button></div>
        <p class="note" id="dl-msg"></p>
      </section>

      <section class="card">
        <h2>iPhoneのホーム画面に追加するには</h2>
        <ol><li>Safariでこのページを開く</li><li>下の「共有」ボタン（□に↑）を押す</li><li>「ホーム画面に追加」を押す</li></ol>
      </section>`;
    bind();
  };

  const bind = () => {
    view.querySelector("#sync-now").addEventListener("click", async () => { await D.sync(); toast(state.syncError ? "同期できませんでした" : "同期しました"); draw(); });
    view.querySelector("#logout").addEventListener("click", () => {
      if (confirm("ログアウトすると、この端末に保存したファイルと記録も消えます（保管庫の記録は残ります）。ログアウトしますか？")) D.signOut();
    });
    view.querySelector("#seed").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const res = await D.importSeed(JSON.parse(await file.text()));
        toast(`教材${res.materials}個・問題${res.questions}問を取り込みました`);
      } catch (err) {
        toast(`取り込めませんでした：${err.message}`);
      }
      draw();
    });
    view.querySelector("#up-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = view.querySelector("#up-msg");
      const file = view.querySelector("#up-file").files[0];
      const mid = view.querySelector("#up-mat").value;
      const kind = view.querySelector("#up-kind").value;
      if (!file) { msg.textContent = "ファイルを選んでください。"; return; }
      if (file.size > FILE_LIMIT) { msg.textContent = `ファイルが大きすぎます（${mb(file.size)}）。50MB以下にしてください。`; return; }
      const type = file.type || "";
      const okType = kind === "audio" ? type.startsWith("audio/") || /\.(m4a|mp3|wav|aac)$/i.test(file.name)
        : kind === "video" ? type.startsWith("video/") || /\.(mp4|mov|m4v)$/i.test(file.name)
        : type === "application/pdf" || type.startsWith("image/") || /\.(pdf|png|jpe?g)$/i.test(file.name);
      if (!okType) { msg.textContent = "選んだ種類とファイルの形式が合っていません。"; return; }
      const used = state.media.reduce((s, m) => s + Number(m.size_bytes || 0), 0);
      const old = D.mediaFor(mid, kind);
      if (used - (old ? old.size_bytes : 0) + file.size > STORAGE_LIMIT) { msg.textContent = "保管庫の容量が足りません。いらないファイルを削除してください。"; return; }
      if (old && !confirm("この教材にはもうファイルがあります。置きかえますか？")) return;
      const btn = e.target.querySelector("button[type=submit]");
      btn.disabled = true;
      msg.textContent = `アップロード中…（${mb(file.size)}）`;
      try {
        await D.uploadMedia(mid, kind, file);
        toast("アップロードしました");
        draw();
      } catch (err) {
        msg.textContent = `アップロードできませんでした：${err.message}`;
        btn.disabled = false;
      }
    });
    view.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        const [mid, kind] = b.dataset.del.split("|");
        if (!confirm("このファイルを保管庫から削除しますか？（元に戻せません）")) return;
        try { await D.deleteMedia(mid, kind); toast("削除しました"); } catch (err) { toast(`削除できませんでした：${err.message}`); }
        draw();
      }),
    );
    view.querySelector("#dl-all").addEventListener("click", async (e) => {
      const msg = view.querySelector("#dl-msg");
      const withVideo = view.querySelector("#dl-video").checked;
      if (!navigator.onLine) { msg.textContent = "電波のあるところで実行してください。"; return; }
      e.target.disabled = true;
      const targets = state.media.filter((m) => withVideo || m.kind !== "video");
      let n = 0;
      for (const m of targets) {
        n += 1;
        if (await D.localMedia(m.material_id, m.kind)) continue;
        msg.textContent = `保存中… ${n} / ${targets.length}`;
        try { await D.downloadMedia(m.material_id, m.kind); } catch (err) { msg.textContent = `一部保存できませんでした：${err.message}`; }
      }
      toast("まとめて保存しました");
      draw();
    });
    view.querySelector("#clear-local").addEventListener("click", async () => {
      if (!confirm("この端末に保存した音声・動画・スライドを全部消しますか？（保管庫には残ります）")) return;
      for (const k of await D.localKeys()) {
        const [mid, kind] = k.split(":");
        await D.removeLocal(mid, kind);
      }
      toast("消しました");
      draw();
    });
  };
  view.innerHTML = `<p class="muted">読み込み中…</p>`;
  draw();
  return { live: false };
}

// ===== 起動 =====
(async () => {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  await D.init();
  render();
  D.sync();
  setInterval(() => { if (state.user && navigator.onLine) D.sync(); }, 5 * 60 * 1000);
})();
