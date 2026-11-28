// FP3級 学習アプリ 画面まわり
import { FIELDS, KIND_LABEL, STORAGE_LIMIT, FILE_LIMIT } from "./config.js";
import * as D from "./data.js";
import * as S from "./stats.js";
import * as PL from "./player.js";

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
  else if (page === "listen") current = await listenView(ctx);
  else if (page === "exam") current = examView(a);
  else if (page === "cards") current = cardsView(a);
  else if (page === "jitsugi") current = jitsugiView();
  else if (page === "marks") current = marksView();
  else if (page === "fs") current = await fieldSlidesView(a, ctx);
  else current = homeView();
}

function setActiveNav(page) {
  const map = { home: "home", fields: "fields", field: "fields", m: "fields", quiz: "fields", record: "record", plan: "plan", admin: "admin", listen: "listen", exam: "fields", cards: "fields", jitsugi: "fields", marks: "fields", fs: "fields" };
  for (const a of nav.querySelectorAll("a")) a.classList.toggle("active", a.dataset.nav === map[page]);
  updateMini();
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
        <p><strong>メールが届いたら、どちらかの方法でログインします。</strong></p>
        <ol class="steps">
          <li><strong>パソコンや、Safariで開いている場合</strong><br>メールの「Sign in」を押すと、このアプリが開いてログインできます。</li>
          <li><strong>iPhoneのホーム画面に追加したアプリの場合</strong><br>メールの「Sign in」を<strong>長押し</strong>して「リンクをコピー」を選び、下に貼り付けて「ログイン」を押します。</li>
        </ol>
        <label>リンク（またはコード）を貼り付け<textarea id="code" rows="3" autocomplete="one-time-code" required></textarea></label>
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
      msg.textContent = "ログイン用のメールを送りました（迷惑メールフォルダも見てください）。メールは1時間に数通までしか送れないので、続けて何度も押さないでください。";
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
      const input = view.querySelector("#code").value.trim();
      if (/^\d{6,10}$/.test(input)) await D.verifyCode(view.querySelector("#email").value.trim(), input);
      else await D.verifyLink(input);
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
    ${(() => {
      const r = S.reviewSummary();
      if (!r.due && !r.later) return "";
      return `<section class="card review-card">
        <h2>🔁 今日の復習</h2>
        <p>${r.due ? `<strong>${r.due}問</strong> の復習があります。忘れる前に解いておきましょう。` : "今日の復習はありません。"}</p>
        <p class="note">これからの復習 ${r.later}問 ・ 卒業 ${r.graduated}問（まちがえた問題を1日後・3日後・7日後に出します）</p>
        ${r.due ? `<a class="btn primary" href="#/quiz/review">今日の復習を解く（${r.due}問）</a>` : ""}
      </section>`;
    })()}
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
      <h2>📝 模擬試験</h2>
      ${(() => {
        const last = [...state.exams].sort((a, b) => (a.finished_at < b.finished_at ? 1 : -1))[0];
        return last ? `<p>前回：${last.correct} / ${last.total}問 ${last.passed ? `<span class="ok">合格</span>` : `<span class="ng">不合格</span>`}</p>` : `<p class="muted">本番と同じ形（60問・90分）とミニ模試（20問・30分）で力だめし。</p>`;
      })()}
      <a class="btn primary" href="#/exam">模擬試験を受ける</a>
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
    <div class="toolbar"><a class="btn primary" href="#/exam">📝 模擬試験</a><a class="btn" href="#/cards">🃏 暗記カード</a><a class="btn" href="#/jitsugi">🧮 実技対策</a><a class="btn" href="#/marks">★ メモ・しおり</a><a class="btn" href="#/quiz/all">ランダムに20問</a><a class="btn" href="#/quiz/wrong">まちがえた問題</a></div>
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
      <div class="toolbar"><a class="btn primary" href="#/quiz/f-${key}">この分野の問題を解く</a>${D.mediaFor(`field-${key}`, "slides") ? `<a class="btn" href="#/fs/${key}">📑 まとめスライド</a>` : ""}</div>
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
    <section class="card memo">
      <div class="memo-head"><h2>📝 メモ</h2><button class="btn small star-btn" id="star-m"></button></div>
      <textarea id="memo" rows="3" placeholder="自分用のメモ（この端末に保存されます）"></textarea>
    </section>
    ${tabs.length === 2 && !D.mediaFor(mid, "audio") ? `<p class="note">音声・動画・スライドは、パソコンの「管理」からアップロードできます。</p>` : ""}`;

  const memoEl = view.querySelector("#memo");
  memoEl.value = getNotes()[mid] || "";
  memoEl.addEventListener("input", () => setNote(mid, memoEl.value));
  const starM = view.querySelector("#star-m");
  const drawStar = () => { starM.textContent = getStars().materials[mid] ? "★ あとで見る" : "☆ あとで見る"; };
  drawStar();
  starM.addEventListener("click", () => { toggleStar("materials", mid); drawStar(); });

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
  let speed = PL.P.speed;
  ctrl.innerHTML = `<button class="btn" data-seek="-15">↺ 15秒</button>
    <label class="speed-sel">速さ<select data-speed aria-label="再生速度">${PL.speedOptions(speed)}</select></label>
    <button class="btn" data-seek="15">15秒 ↻</button>`;
  panel.appendChild(ctrl);
  ctrl.addEventListener("click", (e) => {
    const t = e.target;
    if (t.dataset.seek) el.currentTime = Math.max(0, el.currentTime + Number(t.dataset.seek));
  });
  ctrl.querySelector("[data-speed]").addEventListener("change", (e) => {
    PL.setSpeed(e.target.value);
    speed = PL.P.speed;
    el.playbackRate = speed;
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
        return `<li>${q.kind === "choice" ? `<span class="tag">三択</span>` : ""}${esc(q.text)} ${mark}</li>`;
      })
      .join("")}</ol>`;
}

// ===== ○×問題・三択問題 =====
const NUM = ["1", "2", "3"];
function answerButtons(q, selected) {
  if (q.kind === "choice") {
    return `<div class="choice-btns">${(q.choices || [])
      .map((c, k) => `<button class="btn ans choice ${selected === String(k) ? "sel" : ""}" data-a="${k}"><span class="num">${NUM[k]}</span><span>${esc(c)}</span></button>`)
      .join("")}</div>`;
  }
  return `<div class="answer-btns"><button class="btn ans ${selected === "1" ? "sel" : ""}" data-a="1">○</button><button class="btn ans ${selected === "0" ? "sel" : ""}" data-a="0">×</button></div>`;
}
function isCorrect(q, value) {
  if (value == null) return false;
  if (q.kind === "choice") return Number(value) === Number(q.answer_index);
  return (value === "1") === q.answer;
}
function answerLabel(q) {
  if (q.kind === "choice") return `${NUM[q.answer_index]}. ${(q.choices || [])[q.answer_index] || ""}`;
  return q.answer ? "○" : "×";
}
function valueLabel(q, value) {
  if (value == null) return "未解答";
  if (q.kind === "choice") return `${NUM[value]}. ${(q.choices || [])[value] || ""}`;
  return value === "1" ? "○" : "×";
}
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
    list = shuffle(state.questions.filter((q) => S.fieldOfMaterial(q.material_id) === key && !S.isJitsugi(q)));
    title = fieldInfo(key).name;
    back = `#/field/${key}`;
  } else if (scope === "wrong") {
    list = shuffle(S.wrongQuestions());
    title = "まちがえた問題";
    back = "#/";
  } else if (scope.startsWith("j-")) {
    const key = scope.slice(2);
    list = shuffle(state.questions.filter((q) => S.isJitsugi(q) && (key === "all" || S.fieldOfMaterial(q.material_id) === key)));
    title = key === "all" ? "実技の練習" : `実技の練習（${fieldInfo(key).short}）`;
    back = "#/jitsugi";
  } else if (scope === "starred") {
    const stars = getStars();
    list = state.questions.filter((q) => stars.questions[q.id]);
    title = "★ あとで見る問題";
    back = "#/marks";
  } else if (scope === "review") {
    list = shuffle(S.dueReviews());
    title = "今日の復習";
    back = "#/";
  } else {
    list = shuffle(state.questions.filter((q) => !S.isJitsugi(q))).slice(0, 20);
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
        ${answerButtons(q)}
        <div id="feedback"></div>
      </section>`;
    view.querySelectorAll(".ans").forEach((b) =>
      b.addEventListener("click", async () => {
        const correct = isCorrect(q, b.dataset.a);
        if (correct) score += 1;
        else missed.push(q);
        view.querySelectorAll(".ans").forEach((x) => { x.disabled = true; });
        b.classList.add(correct ? "right" : "wrong");
        view.querySelector("#feedback").innerHTML = `
          <p class="verdict ${correct ? "ok" : "ng"}">${correct ? "正解！" : "不正解…"}　答えは「${esc(answerLabel(q))}」</p>
          <p class="explain">${esc(q.explanation)}</p>
          <button class="btn small star-btn" id="star-q">${getStars().questions[q.id] ? "★ あとで見る（登録済み）" : "☆ あとで見るに入れる"}</button>
          <button class="btn primary" id="next">${i + 1 < list.length ? "次の問題へ" : "結果を見る"}</button>`;
        view.querySelector("#next").addEventListener("click", () => { i += 1; draw(); window.scrollTo(0, 0); });
        view.querySelector("#star-q").addEventListener("click", (e) => {
          const on = toggleStar("questions", q.id);
          e.target.textContent = on ? "★ あとで見る（登録済み）" : "☆ あとで見るに入れる";
        });
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

// ===== 模擬試験 =====
const EXAM = {
  full: { label: "本番形式", total: 60, ox: 30, choice: 30, minutes: 90, pass: 36 },
  mini: { label: "ミニ模試", total: 20, ox: 10, choice: 10, minutes: 30, pass: 12 },
  jitsugi: { label: "実技模試（FP協会）", total: 20, ox: 0, choice: 20, minutes: 60, pass: 12, jitsugi: true },
};
const EXAM_KEY = "fp3-exam";
const EXAM_LAST_KEY = "fp3-exam-last";
function loadJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch (_) {
    return null;
  }
}
function saveJson(key, v) {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch (_) {}
}

// 6分野から、なるべく同じ数ずつ選ぶ
function spread(n) {
  const base = Math.floor(n / FIELDS.length);
  const counts = Object.fromEntries(FIELDS.map((f) => [f.key, base]));
  for (const f of shuffle(FIELDS).slice(0, n - base * FIELDS.length)) counts[f.key] += 1;
  return counts;
}
function pickExam(mode) {
  const cfg = EXAM[mode];
  const byKind = (kind) => state.questions.filter((q) => (q.kind || "ox") === kind && !!cfg.jitsugi === S.isJitsugi(q));
  const pick = (pool, n) => {
    const counts = spread(n);
    let out = [];
    for (const f of FIELDS) out = out.concat(shuffle(pool.filter((q) => S.fieldOfMaterial(q.material_id) === f.key)).slice(0, counts[f.key]));
    if (out.length < n) {
      const rest = shuffle(pool.filter((q) => !out.includes(q)));
      out = out.concat(rest.slice(0, n - out.length));
    }
    return shuffle(out);
  };
  const choice = pick(byKind("choice"), cfg.choice);
  // 三択が足りないときは○×で補う
  const ox = pick(byKind("ox"), cfg.ox + (cfg.choice - choice.length));
  return [...ox, ...choice].map((q) => q.id);
}

function examView(sub) {
  const active = loadJson(EXAM_KEY);
  if (sub === "run") return examRun();
  if (sub === "result") return examResult();
  const hasChoice = state.questions.some((q) => q.kind === "choice");
  const history = [...state.exams].sort((a, b) => (a.finished_at < b.finished_at ? 1 : -1)).slice(0, 10);
  view.innerHTML = `
    <a class="back" href="#/fields">‹ 教材一覧</a>
    <section class="card">
      <h1>📝 模擬試験</h1>
      <p class="note">学科（本番形式・ミニ模試）は、前半が○×問題、後半が三択問題です。実技模試は、日本FP協会の資産設計提案業務の形（資料を読んで計算する問題）です。どれも6分野からかたよりなく出題し、時間になると自動で採点します。</p>
      ${hasChoice ? "" : `<p class="note err">三択問題がまだ入っていないため、今は○×問題だけで出題します。</p>`}
      ${
        active
          ? `<div class="resume"><p><strong>${esc(EXAM[active.mode].label)}</strong>の途中です（${Object.keys(active.answers).length} / ${active.ids.length}問 解答済み）</p>
             <div class="toolbar"><a class="btn primary" href="#/exam/run">続きから解く</a><button class="btn" id="abandon">やめる</button></div></div>`
          : `<div class="exam-modes">
              ${["full", "mini", "jitsugi"]
                .map((k) => {
                  const c = EXAM[k];
                  return `<button class="exam-mode" data-mode="${k}"><strong>${esc(c.label)}</strong><span>${c.total}問・${c.minutes}分</span><small>${c.pass}問以上で合格</small></button>`;
                })
                .join("")}
            </div>`
      }
    </section>
    <section class="card">
      <h2>これまでの結果</h2>
      ${
        history.length
          ? `<table class="table"><thead><tr><th>日時</th><th>種類</th><th>点数</th><th></th></tr></thead><tbody>${history
              .map(
                (r) => `<tr><td>${esc(new Date(r.finished_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }))}</td>
                  <td>${esc((EXAM[r.mode] || {}).label || r.mode)}</td><td>${r.correct} / ${r.total}</td>
                  <td>${r.passed ? `<span class="ok">合格</span>` : `<span class="ng">不合格</span>`}</td></tr>`,
              )
              .join("")}</tbody></table>`
          : `<p class="muted">まだ受けていません。</p>`
      }
      ${state.examsReady ? "" : `<p class="note">※保管庫の追加の設定がまだなので、結果はこの端末だけに保存されます（設定後、自動で保管庫に送られます）。</p>`}
    </section>`;
  view.querySelectorAll("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      const mode = b.dataset.mode;
      const ids = pickExam(mode);
      if (!ids.length) {
        toast(EXAM[mode].jitsugi ? "実技の問題がまだ入っていません。管理画面で新しい教材データを取り込んでください" : "問題がありません。先に教材データを取り込んでください");
        return;
      }
      const now = Date.now();
      saveJson(EXAM_KEY, { mode, ids, answers: {}, flags: {}, cur: 0, startedAt: now, deadline: now + EXAM[mode].minutes * 60000 });
      location.hash = "#/exam/run";
    }),
  );
  const ab = view.querySelector("#abandon");
  if (ab) ab.addEventListener("click", () => {
    if (!confirm("途中の模擬試験をやめますか？（解答は記録されません）")) return;
    saveJson(EXAM_KEY, null);
    render();
  });
  return { live: true };
}

function examRun() {
  const ex = loadJson(EXAM_KEY);
  if (!ex) {
    location.hash = "#/exam";
    return { live: false };
  }
  const cfg = EXAM[ex.mode];
  const qmap = Object.fromEntries(state.questions.map((q) => [q.id, q]));
  const qs = ex.ids.map((id) => qmap[id]).filter(Boolean);
  const timer = new Timer("exam", 3 * 3600);
  timer.pauseOnHide = true;
  activeTimers.add(timer);
  timer.start();
  let showGrid = false;
  const persist = () => saveJson(EXAM_KEY, ex);

  const remaining = () => Math.max(0, Math.round((ex.deadline - Date.now()) / 1000));
  const draw = () => {
    const i = Math.min(ex.cur, qs.length - 1);
    const q = qs[i];
    const answered = Object.keys(ex.answers).length;
    const part = cfg.jitsugi ? "実技" : q.kind === "choice" ? "三択問題" : "○×問題";
    view.innerHTML = `
      <div class="exam-head">
        <span>${esc(cfg.label)}</span>
        <span id="clock" class="clock">${fmtTime(remaining())}</span>
        <button class="btn small" id="grid-btn">${showGrid ? "問題にもどる" : `一覧（${answered}/${qs.length}）`}</button>
      </div>
      ${
        showGrid
          ? `<section class="card"><p class="note">番号を押すとその問題へ。緑＝解答済み、★＝見直し。</p>
             <div class="qgrid">${qs
               .map((x, k) => `<button class="qcell ${ex.answers[x.id] != null ? "done" : ""} ${k === i ? "cur" : ""}" data-go="${k}">${k + 1}${ex.flags[x.id] ? "★" : ""}</button>`)
               .join("")}</div></section>`
          : `<section class="card quiz">
              <div class="muted">${part} ・ ${i + 1} / ${qs.length}</div>
              ${bar(answered / qs.length)}
              <p class="question">${esc(q.text)}</p>
              ${answerButtons(q, ex.answers[q.id])}
              <label class="check flag"><input type="checkbox" id="flag" ${ex.flags[q.id] ? "checked" : ""}> ★ あとで見直す</label>
              <div class="exam-nav">
                <button class="btn" id="prev" ${i === 0 ? "disabled" : ""}>‹ 前へ</button>
                ${i + 1 < qs.length ? `<button class="btn primary" id="next">次へ ›</button>` : `<button class="btn primary" id="submit2">提出する</button>`}
              </div>
            </section>`
      }
      <button class="btn wide" id="submit">提出して採点する</button>`;
    view.querySelector("#grid-btn").addEventListener("click", () => { showGrid = !showGrid; draw(); });
    view.querySelector("#submit").addEventListener("click", () => submit(false));
    if (showGrid) {
      view.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => {
        ex.cur = Number(b.dataset.go);
        showGrid = false;
        persist();
        draw();
      }));
      return;
    }
    view.querySelectorAll(".ans").forEach((b) => b.addEventListener("click", () => {
      ex.answers[q.id] = b.dataset.a;
      persist();
      view.querySelectorAll(".ans").forEach((x) => x.classList.toggle("sel", x === b));
    }));
    view.querySelector("#flag").addEventListener("change", (e) => {
      if (e.target.checked) ex.flags[q.id] = true;
      else delete ex.flags[q.id];
      persist();
    });
    view.querySelector("#prev").addEventListener("click", () => { ex.cur = i - 1; persist(); draw(); window.scrollTo(0, 0); });
    const nx = view.querySelector("#next");
    if (nx) nx.addEventListener("click", () => { ex.cur = i + 1; persist(); draw(); window.scrollTo(0, 0); });
    const s2 = view.querySelector("#submit2");
    if (s2) s2.addEventListener("click", () => submit(false));
  };

  let done = false;
  const submit = async (timeUp) => {
    if (done) return;
    const unanswered = qs.length - Object.keys(ex.answers).length;
    if (!timeUp && !confirm(unanswered ? `まだ${unanswered}問 解答していません。提出して採点しますか？` : "提出して採点しますか？")) return;
    done = true;
    clearInterval(tick);
    timer.stop();
    const byField = {};
    let correct = 0;
    for (const q of qs) {
      const f = S.fieldOfMaterial(q.material_id) || "other";
      byField[f] = byField[f] || { c: 0, t: 0 };
      byField[f].t += 1;
      const v = ex.answers[q.id];
      const ok = isCorrect(q, v);
      if (ok) {
        correct += 1;
        byField[f].c += 1;
      }
      if (v != null) await D.addAttempt(q.id, ok);
    }
    const total = qs.length;
    const passLine = Math.ceil((cfg.pass / cfg.total) * total);
    const result = {
      mode: ex.mode,
      total,
      correct,
      passed: correct >= passLine,
      by_field: byField,
      duration_sec: Math.round((Math.min(Date.now(), ex.deadline) - ex.startedAt) / 1000),
    };
    saveJson(EXAM_LAST_KEY, { ...result, ids: ex.ids, answers: ex.answers, timeUp: !!timeUp });
    saveJson(EXAM_KEY, null);
    await D.addExamResult(result);
    location.hash = "#/exam/result";
  };

  const tick = setInterval(() => {
    const r = remaining();
    const c = document.getElementById("clock");
    if (c) {
      c.textContent = fmtTime(r);
      c.classList.toggle("warn", r <= 300);
    }
    if (r <= 0) {
      toast("時間になりました。採点します");
      submit(true);
    }
  }, 1000);
  if (remaining() <= 0) setTimeout(() => submit(true), 0);
  draw();
  return {
    live: false,
    cleanup() {
      clearInterval(tick);
      timer.stop();
      activeTimers.delete(timer);
    },
  };
}

function examResult() {
  const r = loadJson(EXAM_LAST_KEY);
  if (!r) {
    location.hash = "#/exam";
    return { live: false };
  }
  const cfg = EXAM[r.mode];
  const qmap = Object.fromEntries(state.questions.map((q) => [q.id, q]));
  const qs = r.ids.map((id) => qmap[id]).filter(Boolean);
  const wrong = qs.filter((q) => !isCorrect(q, r.answers[q.id]));
  view.innerHTML = `
    <a class="back" href="#/exam">‹ 模擬試験</a>
    <section class="card result">
      <h1>${esc(cfg.label)}の結果</h1>
      ${r.timeUp ? `<p class="note">時間切れのため、自動で採点しました。</p>` : ""}
      <p class="big">${r.correct} / ${r.total} 問正解</p>
      <p class="verdict ${r.passed ? "ok" : "ng"}">${r.passed ? "合格ライン突破！🎉" : "あと少し！"}（合格ライン ${Math.ceil((cfg.pass / cfg.total) * r.total)}問）</p>
      ${bar(r.correct / r.total)}
      <p class="muted">かかった時間：${fmtTime(r.duration_sec)}</p>
    </section>
    <section class="card">
      <h2>分野ごとの成績</h2>
      <table class="table"><tbody>${FIELDS.filter((f) => r.by_field[f.key])
        .map((f) => {
          const b = r.by_field[f.key];
          return `<tr><td><span class="dot" style="background:${f.color}"></span>${esc(f.short)}</td><td>${b.c} / ${b.t}</td><td style="width:40%">${bar(b.c / b.t, f.color)}</td></tr>`;
        })
        .join("")}</tbody></table>
    </section>
    <section class="card">
      <h2>まちがえた問題（${wrong.length}問）</h2>
      ${wrong.length ? `<a class="btn primary" href="#/quiz/wrong">まちがえた問題を解き直す</a>` : `<p>全問正解です！</p>`}
      <ol class="review">${wrong
        .map((q) => `<li><p>${esc(q.text)}</p>
          <p class="small">あなたの答え：<span class="ng">${esc(valueLabel(q, r.answers[q.id]))}</span> ／ 正解：<span class="ok">${esc(answerLabel(q))}</span></p>
          <p class="explain">${esc(q.explanation)}</p></li>`)
        .join("")}</ol>
    </section>`;
  return { live: false };
}

// ===== 暗記カード =====
const CARD_KEY = "fp3-cards";
function cardsOf(m) {
  const doc = new DOMParser().parseFromString(`<div>${m.content_html}</div>`, "text/html");
  const h = [...doc.querySelectorAll("h2")].find((x) => x.textContent.includes("覚えるべき数字"));
  if (!h) return [];
  let el = h.nextElementSibling;
  while (el && el.tagName !== "TABLE" && el.tagName !== "H2") el = el.nextElementSibling;
  if (!el || el.tagName !== "TABLE") return [];
  return [...el.querySelectorAll("tr")]
    .map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim()))
    .filter((c) => c.length >= 2 && c[0] && c[1])
    .map((c, i) => ({ id: `${m.id}:${i}`, mid: m.id, field: m.field, front: c[0], back: c[1] }));
}

function cardsView(scope = "all") {
  const marks = loadJson(CARD_KEY) || {};
  const mats = S.sortedMaterials().filter((m) => scope === "all" || m.field === scope);
  const all = mats.flatMap(cardsOf);
  const known = (c) => marks[c.id] === "known";
  let onlyTodo = loadJson("fp3-cards-todo") ?? true;
  let deck = [];
  let i = 0;
  let flipped = false;
  const timer = new Timer("cards", 1800);
  timer.pauseOnHide = true;
  activeTimers.add(timer);
  timer.start();

  const build = () => {
    deck = shuffle(onlyTodo ? all.filter((c) => !known(c)) : all);
    i = 0;
    flipped = false;
  };
  const draw = () => {
    const done = all.filter(known).length;
    const c = deck[i];
    const m = c && state.materials.find((x) => x.id === c.mid);
    view.innerHTML = `
      <a class="back" href="#/fields">‹ 教材一覧</a>
      <section class="card">
        <h1>🃏 暗記カード</h1>
        <div class="scope">
          <a class="pill ${scope === "all" ? "on" : ""}" href="#/cards/all">すべて</a>
          ${FIELDS.map((f) => `<a class="pill ${scope === f.key ? "on" : ""}" href="#/cards/${f.key}"><span class="dot" style="background:${f.color}"></span>${esc(f.short)}</a>`).join("")}
        </div>
        <p>覚えた <strong>${done}</strong> / ${all.length}枚</p>
        ${bar(all.length ? done / all.length : 0)}
        <label class="check"><input type="checkbox" id="todo" ${onlyTodo ? "checked" : ""}> まだ覚えていないカードだけ</label>
      </section>
      ${
        c
          ? `<section class="card flash ${flipped ? "flipped" : ""}" id="flash" role="button" tabindex="0" aria-label="カードをめくる">
              <div class="muted small">${esc(m ? m.title : "")} ・ ${i + 1} / ${deck.length}</div>
              <p class="flash-front">${esc(c.front)}</p>
              ${flipped ? `<p class="flash-back">${esc(c.back)}</p>` : `<p class="note">タップしてめくる</p>`}
            </section>
            ${flipped ? `<div class="answer-btns"><button class="btn" id="later">もう一度</button><button class="btn primary" id="got">覚えた ✓</button></div>` : ""}`
          : `<section class="card"><p>${all.length ? "このカードは全部覚えました！🎉" : "カードがありません。"}</p>
              ${all.length ? `<button class="btn" id="reset">覚えた印を消して、最初からやり直す</button>` : ""}</section>`
      }`;
    const flash = view.querySelector("#flash");
    if (flash) flash.addEventListener("click", () => { flipped = !flipped; draw(); });
    view.querySelector("#todo").addEventListener("change", (e) => {
      onlyTodo = e.target.checked;
      saveJson("fp3-cards-todo", onlyTodo);
      build();
      draw();
    });
    const mark = (v) => {
      if (v) marks[c.id] = "known";
      else delete marks[c.id];
      saveJson(CARD_KEY, marks);
      if (!v) deck.push(c); // 「もう一度」は最後にもう一回出す
      i += 1;
      flipped = false;
      draw();
    };
    const got = view.querySelector("#got");
    if (got) got.addEventListener("click", () => mark(true));
    const later = view.querySelector("#later");
    if (later) later.addEventListener("click", () => mark(false));
    const reset = view.querySelector("#reset");
    if (reset) reset.addEventListener("click", () => {
      if (!confirm("この範囲の「覚えた」の印を消しますか？")) return;
      for (const x of all) delete marks[x.id];
      saveJson(CARD_KEY, marks);
      build();
      draw();
    });
  };
  build();
  draw();
  return {
    live: false,
    cleanup() {
      timer.stop();
      activeTimers.delete(timer);
    },
  };
}

// ===== メモ・しおり（この端末だけに保存） =====
function getNotes() {
  return loadJson("fp3-notes") || {};
}
function setNote(mid, text) {
  const n = getNotes();
  if (text.trim()) n[mid] = text;
  else delete n[mid];
  saveJson("fp3-notes", n);
}
function getStars() {
  const s = loadJson("fp3-stars") || {};
  return { materials: s.materials || {}, questions: s.questions || {} };
}
function toggleStar(kind, id) {
  const s = getStars();
  if (s[kind][id]) delete s[kind][id];
  else s[kind][id] = new Date().toISOString();
  saveJson("fp3-stars", s);
  return !!s[kind][id];
}

function marksView() {
  const stars = getStars();
  const notes = getNotes();
  const mats = S.sortedMaterials();
  const starMats = mats.filter((m) => stars.materials[m.id]);
  const noteMats = mats.filter((m) => notes[m.id]);
  const starQs = state.questions.filter((q) => stars.questions[q.id]);
  view.innerHTML = `
    <a class="back" href="#/fields">‹ 教材一覧</a>
    <section class="card">
      <h1>★ メモ・しおり</h1>
      <p class="note">メモと「あとで見る」の印は、この端末だけに保存されます。</p>
    </section>
    <section class="card">
      <h2>★ あとで見る教材（${starMats.length}）</h2>
      ${starMats.length ? `<ul class="list">${starMats.map(materialRow).join("")}</ul>` : `<p class="muted">教材ページの「☆ あとで見る」を押すと、ここに並びます。</p>`}
    </section>
    <section class="card">
      <h2>★ あとで見る問題（${starQs.length}）</h2>
      ${starQs.length ? `<a class="btn primary" href="#/quiz/starred">まとめて解く</a><ol class="qlist">${starQs.map((q) => `<li>${esc(q.text.split("\n")[0])}</li>`).join("")}</ol>` : `<p class="muted">問題の答えのあとに出る「☆ あとで見るに入れる」を押すと、ここに並びます。</p>`}
    </section>
    <section class="card">
      <h2>📝 メモ（${noteMats.length}）</h2>
      ${noteMats.length ? `<ul class="list">${noteMats.map((m) => `<li><a class="row" href="#/m/${encodeURIComponent(m.id)}"><span class="grow"><span class="row-title">${esc(m.title)}</span><span class="note">${esc(notes[m.id].slice(0, 80))}</span></span></a></li>`).join("")}</ul>` : `<p class="muted">教材ページの下にメモを書くと、ここに並びます。</p>`}
    </section>`;
  return { live: true };
}

// ===== 実技対策（日本FP協会・資産設計提案業務） =====
function jitsugiView() {
  const js = state.questions.filter((q) => S.isJitsugi(q));
  const acc = S.accuracy((q) => S.isJitsugi(q));
  view.innerHTML = `
    <a class="back" href="#/fields">‹ 教材一覧</a>
    <section class="card">
      <h1>🧮 実技対策</h1>
      <p class="note">日本FP協会の実技試験（資産設計提案業務）の形で、資料を読んで計算する問題を練習します。本番は20問・60分です。</p>
      ${js.length ? `<p>問題 ${js.length}問 ・ 正解率 ${acc.rate == null ? "—" : S.pct(acc.rate)}（${acc.answered}問解答）</p>
        <div class="toolbar"><a class="btn primary" href="#/quiz/j-all">全分野から練習</a><a class="btn" href="#/exam">実技模試を受ける</a></div>` : `<p class="note err">実技の問題がまだ入っていません。パソコンの「管理」で新しい教材データを取り込んでください。</p>`}
    </section>
    ${js.length ? `<section class="card"><h2>分野ごとに練習</h2><ul class="list">${FIELDS.map((f) => {
      const n = js.filter((q) => S.fieldOfMaterial(q.material_id) === f.key).length;
      const a = S.accuracy((q) => S.isJitsugi(q) && S.fieldOfMaterial(q.material_id) === f.key);
      return n ? `<li><a class="row" href="#/quiz/j-${f.key}"><span class="dot" style="background:${f.color}"></span><span class="grow"><span class="row-title">${esc(f.name)}</span></span><span class="num">${n}問<small>${a.rate == null ? "" : `正解${S.pct(a.rate)}`}</small></span></a></li>` : "";
    }).join("")}</ul></section>` : ""}`;
  return { live: true };
}

// ===== 分野のまとめスライド =====
async function fieldSlidesView(key, ctx) {
  const f = fieldInfo(key);
  const pseudo = { id: `field-${key}`, title: `${f.name} まとめ`, field: key };
  view.innerHTML = `<a class="back" href="#/field/${key}">‹ ${esc(f.name)}</a>
    <section class="card"><h1>📑 ${esc(f.name)} まとめスライド</h1></section>
    <section class="card" id="panel"></section>`;
  if (!D.mediaFor(pseudo.id, "slides")) {
    view.querySelector("#panel").innerHTML = `<p>まとめスライドはまだアップロードされていません。パソコンの「管理」から、教材で「【まとめ】${esc(f.name)}」を選んでアップロードできます。</p>`;
    return { live: true };
  }
  const cleanup = await slidesPanel(view.querySelector("#panel"), pseudo, ctx);
  return { live: false, cleanup: () => cleanup && cleanup() };
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
          <label>教材<select id="up-mat"><optgroup label="教材">${mats.map((m) => `<option value="${esc(m.id)}">${esc(m.title)}</option>`).join("")}</optgroup>
            <optgroup label="分野のまとめ（スライドだけ）">${FIELDS.map((f) => `<option value="field-${f.key}">【まとめ】${esc(f.name)}</option>`).join("")}</optgroup></select></label>
          <label>種類<select id="up-kind"><option value="audio">音声</option><option value="video">動画</option><option value="slides">スライド（PDF・画像）</option></select></label>
          <label class="file">ファイルを選ぶ<input type="file" id="up-file"></label>
          <button class="btn primary" type="submit">アップロード</button>
          <p class="note" id="up-msg"></p>
        </form>
      </section>

      <section class="card">
        <h2>アップロード済みのファイル</h2>
        <table class="table small"><thead><tr><th>教材</th><th>音声</th><th>動画</th><th>スライド</th></tr></thead><tbody>
        ${[...mats, ...FIELDS.map((f) => ({ id: `field-${f.key}`, title: `【まとめ】${f.name}` }))]
          .map(
            (m) => `<tr><td>${esc(m.title)}</td>${["audio", "video", "slides"]
              .map((k) => {
                const md = D.mediaFor(m.id, k);
                if (!md) return `<td class="muted">—</td>`;
                return `<td><span class="fname">${esc(md.file_name || "（名前なし）")}</span>${mb(md.size_bytes)}${localKeys.has(`${m.id}:${k}`) ? " 📱" : ""}<br><button class="link-btn" data-del="${esc(m.id)}|${k}">削除</button></td>`;
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
      if (mid.startsWith("field-") && kind !== "slides") { msg.textContent = "分野のまとめには、スライド（PDF）だけアップロードできます。"; return; }
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

// ===== 聞き流し =====
function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function sleepLabel() {
  if (PL.P.sleepEnd) return "この音声が終わったら止まります";
  if (PL.P.sleepAt) return `あと ${Math.max(1, Math.ceil((PL.P.sleepAt - Date.now()) / 60000))}分で止まります`;
  return "";
}

async function listenView(ctx) {
  const P = PL.P;
  let localKeys = new Set(await D.localKeys());
  if (!ctx.alive()) return null;
  let scope = P.queue.length ? P.scope : P.scope || "all";

  const draw = () => {
    const playingId = PL.currentId();
    const pm = playingId && state.materials.find((x) => x.id === playingId);
    const scopeTracks = PL.tracksFor(scope);
    const queue = P.queue.length ? P.queue : scopeTracks;
    const showingCurrent = P.queue.length && P.scope === scope;
    const list = showingCurrent ? P.queue : scopeTracks;
    view.innerHTML = `
      <section class="card">
        <h1>🎧 聞き流し</h1>
        <div class="scope">
          <button class="pill ${scope === "all" ? "on" : ""}" data-scope="all">すべて（${PL.tracksFor("all").length}）</button>
          ${FIELDS.map((f) => `<button class="pill ${scope === f.key ? "on" : ""}" data-scope="${f.key}"><span class="dot" style="background:${f.color}"></span>${esc(f.short)}（${PL.tracksFor(f.key).length}）</button>`).join("")}
        </div>
        <div class="opts">
          <button class="pill ${P.shuffle ? "on" : ""}" id="o-shuffle">🔀 ランダム</button>
          <button class="pill ${P.repeat ? "on" : ""}" id="o-repeat">🔁 くり返し</button>
          <label class="sleep">🌙 スリープ
            <select id="o-sleep">
              <option value="">なし</option>
              <option value="15">15分</option><option value="30">30分</option><option value="45">45分</option><option value="60">60分</option><option value="90">90分</option>
              <option value="end">この音声の終わりまで</option>
            </select>
          </label>
        </div>
        <button class="btn primary wide" id="start">▶ ${scope === "all" ? "すべて" : esc(fieldInfo(scope).name)}を${P.shuffle ? "ランダムに" : "順番に"}再生</button>
        ${scopeTracks.length ? "" : `<p class="note">この範囲には、まだ音声がアップロードされていません。パソコンの「管理」からアップロードできます。</p>`}
      </section>

      <section class="card player ${pm ? "" : "idle"}">
        <div class="now">
          <div class="muted small">${pm ? `${esc(fieldInfo(pm.field).name)} ・ ${P.index + 1} / ${queue.length}${P.shuffle ? " ・ ランダム" : ""}` : "停止中"}</div>
          <div class="now-title">${pm ? esc(pm.title) : "下の一覧から選ぶか、上の再生ボタンを押してください"}</div>
        </div>
        <input type="range" id="seek" min="0" max="1000" value="0" ${pm ? "" : "disabled"} aria-label="再生位置">
        <div class="times"><span id="t-cur">0:00</span><span id="t-dur">0:00</span></div>
        <div class="transport">
          <button class="icon" id="p-prev" aria-label="前の音声">⏮</button>
          <button class="icon" id="p-back" aria-label="15秒戻る">↺<small>15</small></button>
          <button class="icon big" id="p-play" aria-label="再生・一時停止">${PL.isPlaying() ? "⏸" : "▶"}</button>
          <button class="icon" id="p-fwd" aria-label="15秒進む">↻<small>15</small></button>
          <button class="icon" id="p-next" aria-label="次の音声">⏭</button>
        </div>
        <div class="extras">
          <label class="speed-sel">速さ<select id="p-speed" aria-label="再生速度">${PL.speedOptions(P.speed)}</select></label>
          ${
            PL.canSetVolume
              ? `<label class="vol">🔈<input type="range" id="vol" min="0" max="100" value="${Math.round(P.volume * 100)}" aria-label="音量">🔊</label>`
              : `<span class="note">音量はiPhoneの横のボタンで調整してください</span>`
          }
        </div>
        <p class="note" id="sleep-note">${esc(sleepLabel())}</p>
        ${P.error ? `<p class="note err">${esc(P.error)}</p>` : ""}
        ${P.loading ? `<p class="note">読み込み中…</p>` : ""}
      </section>

      <section class="card">
        <h2>${showingCurrent ? "再生リスト" : "この範囲の音声"}</h2>
        <ol class="tracks">
          ${list
            .map((id, i) => {
              const m = state.materials.find((x) => x.id === id);
              if (!m) return "";
              const heard = D.getProgress(id, "audio").done;
              const saved = localKeys.has(`${id}:audio`);
              return `<li class="${id === playingId ? "playing" : ""}"><button class="track" data-i="${i}" data-id="${esc(id)}">
                <span class="dot" style="background:${fieldInfo(m.field).color}"></span>
                <span class="grow">${esc(m.title)}</span>
                <span class="marks">${saved ? "📱" : ""}${heard ? `<span class="ok">✓</span>` : ""}</span>
              </button></li>`;
            })
            .join("")}
        </ol>
        <p class="note">✓ は聞いた音声、📱 はこの端末に保存済み（電波なしで聞ける）の音声です。</p>
      </section>`;

    const sleepSel = view.querySelector("#o-sleep");
    sleepSel.value = P.sleepAt || P.sleepEnd ? P.sleepChoice : "";
    bind();
    tick();
  };

  const tick = () => {
    const a = P.audio;
    const cur = view.querySelector("#t-cur");
    if (!cur) return;
    cur.textContent = fmtTime(a.currentTime);
    view.querySelector("#t-dur").textContent = fmtTime(a.duration);
    const seekEl = view.querySelector("#seek");
    if (!seeking && a.duration) seekEl.value = String(Math.round((a.currentTime / a.duration) * 1000));
    view.querySelector("#sleep-note").textContent = sleepLabel();
  };

  let seeking = false;
  const bind = () => {
    view.querySelectorAll("[data-scope]").forEach((b) =>
      b.addEventListener("click", () => {
        scope = b.dataset.scope;
        draw();
      }),
    );
    view.querySelector("#o-shuffle").addEventListener("click", () => PL.setShuffle(!PL.P.shuffle));
    view.querySelector("#o-repeat").addEventListener("click", () => PL.setRepeat(!PL.P.repeat));
    view.querySelector("#o-sleep").addEventListener("change", (e) => {
      const v = e.target.value;
      PL.setSleep(v === "" ? null : v === "end" ? "end" : Number(v));
      toast(v === "" ? "スリープタイマーを止めました" : "スリープタイマーをセットしました");
    });
    view.querySelector("#start").addEventListener("click", () => PL.start(scope));
    view.querySelector("#p-play").addEventListener("click", () => (PL.currentId() ? PL.toggle() : PL.start(scope)));
    view.querySelector("#p-prev").addEventListener("click", () => PL.prev());
    view.querySelector("#p-next").addEventListener("click", () => PL.next());
    view.querySelector("#p-back").addEventListener("click", () => PL.skip(-15));
    view.querySelector("#p-fwd").addEventListener("click", () => PL.skip(15));
    view.querySelector("#p-speed").addEventListener("change", (e) => PL.setSpeed(e.target.value));
    const seekEl = view.querySelector("#seek");
    seekEl.addEventListener("input", () => {
      seeking = true;
      const a = P.audio;
      if (a.duration) view.querySelector("#t-cur").textContent = fmtTime((seekEl.value / 1000) * a.duration);
    });
    seekEl.addEventListener("change", () => {
      seeking = false;
      if (P.audio.duration) PL.seek((seekEl.value / 1000) * P.audio.duration);
    });
    const vol = view.querySelector("#vol");
    if (vol) vol.addEventListener("input", () => PL.setVolume(vol.value / 100));
    view.querySelectorAll(".track").forEach((b) =>
      b.addEventListener("click", () => {
        if (P.queue.length && P.scope === scope) PL.playAt(Number(b.dataset.i));
        else PL.start(scope, b.dataset.id);
      }),
    );
  };

  const off = PL.onPlayer((kind) => {
    if (!ctx.alive()) return;
    if (kind === "tick") tick();
    else draw();
  });
  const offData = D.onChange(async () => {
    localKeys = new Set(await D.localKeys());
    if (ctx.alive()) draw();
  });
  draw();
  return {
    live: false,
    cleanup() {
      off();
      offData();
    },
  };
}

// 聞き流し中に、ほかの画面の下に出す小さなプレイヤー
const mini = document.getElementById("mini");
function updateMini() {
  const id = PL.currentId();
  const onListen = parseRoute()[0] === "listen";
  if (!id || !state.user || onListen) {
    mini.hidden = true;
    document.body.classList.remove("has-mini");
    return;
  }
  const m = state.materials.find((x) => x.id === id);
  mini.hidden = false;
  document.body.classList.add("has-mini");
  mini.innerHTML = `<a href="#/listen" class="mini-title">🎧 ${esc(m ? m.title : "")}</a>
    <button class="icon" data-mini="play" aria-label="再生・一時停止">${PL.isPlaying() ? "⏸" : "▶"}</button>
    <button class="icon" data-mini="next" aria-label="次の音声">⏭</button>`;
}
mini.addEventListener("click", (e) => {
  const act = e.target.closest("[data-mini]");
  if (!act) return;
  if (act.dataset.mini === "play") PL.toggle();
  else PL.next();
});
PL.onPlayer((kind) => {
  if (kind !== "tick") updateMini();
});

// ===== 起動 =====
(async () => {
  if ("serviceWorker" in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
    // 新しい版が届いたら、読み込み直して反映する（聞き流し中は止めないように、お知らせだけ）
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloading) return;
      if (PL.isPlaying()) {
        toast("アプリの新しい版が届きました。次に開いたときに反映されます。");
        return;
      }
      reloading = true;
      location.reload();
    });
  }
  const hash = location.hash;
  await D.init();
  // メールのリンクから戻ってきたときの後片付け
  if (/access_token=|error_description=/.test(hash)) {
    const err = /error_description=([^&]+)/.exec(hash);
    history.replaceState(null, "", location.pathname + "#/");
    if (err) toast(`ログインできませんでした：${decodeURIComponent(err[1].replace(/\+/g, " "))}`);
  }
  render();
  D.sync();
  setInterval(() => { if (state.user && navigator.onLine) D.sync(); }, 5 * 60 * 1000);
})();
