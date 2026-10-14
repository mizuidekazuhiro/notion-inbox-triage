export const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b1722">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Notion Flow">
<meta name="description" content="Notion Inbox・実行タスクを一つの画面から管理">
<link rel="manifest" href="/mobile/manifest.webmanifest">
<link rel="apple-touch-icon" href="/mobile/icon.png?size=180">
<link rel="icon" href="/mobile/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/mobile/styles.css">
<title>Notion Flow</title>
</head>
<body>
<div class="app">
<header class="header">
  <div class="brand"><div class="brand-icon" aria-hidden="true">✦</div>
  <div><p class="eyebrow">PERSONAL CONTROL</p><h1>Notion Flow</h1></div></div>
  <button id="lock" class="top-button" hidden aria-label="接続解除">解除</button>
</header>

<section id="auth" class="glass intro" aria-label="接続">
  <div class="intro-symbol" aria-hidden="true">⌁</div>
  <h2>Notionと接続</h2>
  <p>現在のiPhoneショートカットで利用している <strong>X-Shortcut-Token</strong> を入力してください。Notion APIキーは入力しません。</p>
  <form id="login-form">
    <label for="access-key">認証キー</label>
    <input id="access-key" name="access-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="X-Shortcut-Token" required>
    <button class="primary" type="submit">接続する <span aria-hidden="true">→</span></button>
  </form>
  <p class="footnote">認証キーは入力時のみ使用し、ログイン状態は安全なCookieで保持します。通常は次回以降の入力が不要です（30日間有効・利用時に更新）。ブラウザとホーム画面アプリでは最初の認証がそれぞれ必要な場合があります。</p>
</section>

<main id="dashboard" hidden>
<div class="overview">
  <div><p class="eyebrow">WORKSPACE</p><h2 id="welcome">タスクを整理する</h2></div>
  <div class="overview-actions"><button id="new-task" class="create-button" type="button" aria-label="新しいタスクを登録"><span aria-hidden="true">＋</span> タスク</button><button id="refresh" class="circle-button" aria-label="更新">↻</button></div>
</div>
<nav class="tabs" aria-label="機能の切り替え">
 <button class="tab selected" id="tab-inbox" data-tab="inbox" aria-current="page"><span>Inbox</span><b id="inbox-count">—</b></button>
 <button class="tab" id="tab-tasks" data-tab="tasks"><span>Tasks</span><b id="task-count">—</b></button>
</nav>
<section id="inbox-panel" class="panel" aria-labelledby="tab-inbox">
  <div class="section-heading"><div><p class="eyebrow">CAPTURE</p><h3>未処理のInbox</h3></div><span id="inbox-caption" class="muted">読み込み中</span></div>
  <div id="inbox-list" class="list"></div>
</section>
<section id="tasks-panel" class="panel" aria-labelledby="tab-tasks" hidden>
  <div class="section-heading"><div><p class="eyebrow">FOCUS</p><h3>Do / Waiting</h3></div></div>
  <div class="segmented" role="group" aria-label="タスクを絞り込む">
   <button class="selected" data-status-filter="all">すべて</button>
   <button data-status-filter="Do">Do</button>
   <button data-status-filter="Waiting">Waiting</button>
  </div>
  <div id="tasks-list" class="list"></div>
</section>
</main>
<footer><span id="status-line" role="status" aria-live="polite">Notionのデータは認証後に読み込みます</span></footer>
</div>

<div id="modal" class="modal-overlay" hidden>
 <div class="modal-scrim" data-close></div>
 <section class="modal glass" role="dialog" aria-modal="true" aria-labelledby="modal-title">
   <div class="modal-top"><div class="modal-handle"></div><button id="modal-close" class="top-button" aria-label="閉じる">閉じる</button></div>
   <p id="modal-kicker" class="eyebrow"></p>
   <h2 id="modal-title"></h2>
   <p id="modal-description" class="muted"></p>
   <div id="modal-body"></div>
 </section>
</div>

<script defer src="/mobile/client.js"></script>
</body>
</html>`;

export const css = `
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif;
--text:#f1f8ff;--muted:#9bb0c0;--line:rgba(184,225,246,.15);--glass:rgba(17,37,54,.64);--cyan:#81dded;--danger:#f6a6a7}
*{box-sizing:border-box}
html{min-height:100%;background:#07111c}
body{margin:0;min-height:100vh;color:var(--text);background:
radial-gradient(ellipse at 79% -12%,rgba(42,147,165,.55),transparent 48%),
radial-gradient(ellipse at 0 56%,rgba(27,73,125,.42),transparent 55%),
linear-gradient(155deg,#0e2231 0%,#08111c 70%);background-attachment:fixed}
button,input,select{font:inherit}
button{cursor:pointer;-webkit-tap-highlight-color:transparent}
button:disabled{cursor:wait;opacity:.55}
button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid var(--cyan);outline-offset:3px}
.app{max-width:620px;min-height:100vh;margin:auto;padding:calc(env(safe-area-inset-top) + 23px) 19px calc(env(safe-area-inset-bottom) + 42px)}
.header,.overview,.section-heading,.brand,.modal-top{display:flex;justify-content:space-between;align-items:center;gap:15px}
.header{margin-bottom:36px}.brand{justify-content:flex-start}.brand-icon{height:46px;width:46px;display:grid;place-items:center;font-size:25px;border-radius:15px;background:linear-gradient(130deg,rgba(150,244,255,.32),rgba(47,135,162,.14));border:1px solid rgba(200,242,255,.3);box-shadow:inset 0 1px 0 rgba(255,255,255,.2)}
.eyebrow{letter-spacing:.16em;font-size:10px;font-weight:740;color:#92bed1;margin:0 0 6px}
h1{font-size:23px;letter-spacing:-.055em;margin:0;font-weight:760}h2{font-size:24px;letter-spacing:-.045em;margin:0}h3{font-size:17px;letter-spacing:-.02em;margin:0}
p{line-height:1.58}.muted{font-size:12px;color:var(--muted)}
.top-button,.circle-button{background:rgba(137,181,210,.1);color:#dceaf4;border:1px solid var(--line);border-radius:14px;min-width:44px;min-height:43px;padding:0 12px}
.circle-button{font-size:28px;line-height:1}
.glass{background:var(--glass);border:1px solid rgba(186,233,248,.19);box-shadow:0 16px 65px rgba(0,0,0,.16),inset 0 1px 0 rgba(255,255,255,.08);-webkit-backdrop-filter:blur(22px);backdrop-filter:blur(22px)}
.intro{border-radius:27px;padding:25px 22px 20px;margin-top:60px}
.intro-symbol{font-size:44px;color:var(--cyan);margin-bottom:12px}.intro>p{font-size:13px;color:#aec2d1;margin-bottom:22px}.intro strong{color:#e2f8ff}
label{display:block;font-size:12px;color:#bed3df;font-weight:650;margin:17px 0 8px}
input,select{width:100%;min-height:48px;border:1px solid rgba(173,213,232,.21);border-radius:13px;background:rgba(6,18,29,.65);color:white;padding:12px}
select{appearance:auto}
.primary{width:100%;min-height:51px;border:none;background:linear-gradient(120deg,#9deefa,#66c5d9);color:#092532;font-weight:800;border-radius:14px;margin-top:18px;display:flex;justify-content:space-between;align-items:center;padding:0 18px}
.primary.secondary{background:rgba(137,190,210,.17);color:#dff4ff;border:1px solid var(--line);justify-content:center}
.footnote{font-size:11px!important;line-height:1.65;color:#8da9ba!important;margin:17px 0 0!important}
.overview{margin-top:-9px;margin-bottom:22px}.overview h2{font-size:25px}
.overview-actions{display:flex;align-items:center;gap:7px}
.create-button{background:linear-gradient(135deg,rgba(156,230,239,.28),rgba(81,172,191,.20));border:1px solid rgba(159,230,237,.5);color:#ddfaff;border-radius:14px;min-height:43px;padding:0 12px;font-weight:750;font-size:12px;box-shadow:inset 0 1px 0 rgba(255,255,255,.15);white-space:nowrap;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.create-button span{font-size:21px;line-height:0;vertical-align:-2px}
.create-button:disabled{opacity:.55}
.modal .create-form{display:block}
.modal .create-form input,.modal .create-form select,.modal .create-form textarea{width:100%;min-height:45px;background:rgba(6,18,29,.65);color:#f5fbff}
.modal .create-form textarea{padding:12px;resize:vertical;min-height:76px;border:1px solid rgba(173,213,232,.21);border-radius:13px;font:inherit;font-size:13px}
.modal .create-form .field-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.modal .field-note{font-size:11px;line-height:1.5;color:#9cb7c6;margin:8px 0}
.modal .create-form label{margin-top:13px}
.modal .create-form .primary{margin-top:20px}

.tabs{display:grid;grid-template-columns:1fr 1fr;background:rgba(4,15,24,.45);padding:5px;border:1px solid var(--line);border-radius:18px;gap:6px}
.tab{border:none;background:transparent;color:#8faaba;border-radius:13px;min-height:48px;font-weight:690;display:flex;align-items:center;justify-content:center;gap:10px}
.tab.selected{background:rgba(110,191,213,.18);color:#edfaff;box-shadow:inset 0 1px 0 rgba(255,255,255,.1)}
.tab b{font-size:11px;background:rgba(255,255,255,.12);padding:4px 8px;border-radius:9px}
.panel{margin-top:28px}.section-heading{margin:0 2px 18px}
.list{display:flex;flex-direction:column;gap:9px}
.item{border:1px solid rgba(176,218,233,.15);background:rgba(17,40,55,.53);border-radius:18px;width:100%;min-height:75px;padding:15px;text-align:left;color:var(--text);display:flex;align-items:center;gap:13px;box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}
.item:active{transform:scale(.99)}
.item-text{min-width:0;flex:1}.item-title{display:block;font-weight:650;font-size:14px;line-height:1.46;overflow-wrap:anywhere}
.item-meta{display:block;color:var(--muted);font-size:11px;margin-top:6px;line-height:1.35}
.item-symbol{font-size:19px;height:41px;min-width:41px;display:grid;place-items:center;border-radius:14px;background:rgba(124,197,216,.12);color:#aee8f2}
.item-arrow{color:#6797aa;font-size:23px}
.pill{display:inline-flex;align-items:center;padding:5px 8px;border-radius:9px;font-size:10px;font-weight:750;white-space:nowrap}
.pill.do{color:#ffe7af;background:rgba(220,165,66,.16)}
.pill.waiting{color:#9cdcf1;background:rgba(60,164,206,.18)}
.pill.parent{color:#d1c8f8;background:rgba(130,105,208,.18)}
.segmented{display:flex;gap:6px;background:rgba(4,15,24,.4);border-radius:14px;padding:4px;margin:0 0 18px;border:1px solid var(--line)}
.segmented button{flex:1;border:0;border-radius:10px;background:transparent;color:#9db7c7;min-height:41px;font-weight:700;font-size:12px}
.segmented button.selected{background:rgba(121,206,222,.22);color:#eaf9ff}
.group-title{font-size:11px;font-weight:750;letter-spacing:.07em;color:#b6d9e5;margin:24px 3px 10px}
.group-caption{color:#93adbd;font-weight:500;letter-spacing:normal;margin-left:7px}
details.management{border-top:1px solid var(--line);margin-top:19px;padding-top:15px}
details.management summary{font-size:12px;color:#c0d8e2;font-weight:750;cursor:pointer;padding:8px 2px 16px}
details.management[open] summary{color:#e6f5fb}
.empty{border:1px dashed rgba(186,228,238,.2);padding:32px 19px;text-align:center;border-radius:18px;color:#9bb6c5;font-size:13px}
.warning{padding:12px;background:rgba(239,170,72,.13);border:1px solid rgba(238,179,86,.23);color:#ffdca6;border-radius:12px;font-size:12px;margin:12px 0}
footer{text-align:center;font-size:11px;color:#87a0ad;max-width:500px;margin:32px auto 0}
.modal-overlay{position:fixed;inset:0;z-index:20;display:flex;align-items:flex-end;justify-content:center;padding:0}
.modal-overlay[hidden],[hidden]{display:none!important}
.modal-scrim{background:rgba(0,7,13,.76);position:absolute;inset:0}
.modal{position:relative;z-index:1;border-radius:26px 26px 0 0;width:100%;max-width:620px;max-height:88dvh;overflow-y:auto;padding:14px 24px calc(24px + env(safe-area-inset-bottom));background:rgba(15,35,48,.96)}
.modal-top{margin-bottom:16px;justify-content:flex-end}.modal-handle{width:38px;height:5px;border-radius:12px;background:#7298a6;position:absolute;left:calc(50% - 19px);top:12px}
.modal h2{font-size:21px;line-height:1.4}.modal>.muted{margin:9px 0 18px}
.modal .choice-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
.modal .choice{min-height:47px;border-radius:13px;border:1px solid var(--line);background:rgba(110,176,196,.11);color:#e7f3ff;font-weight:700}
.modal .choice.selected{background:rgba(125,225,240,.26);border-color:rgba(153,231,245,.65)}
.modal .help{font-size:12px;color:#91abb8;margin-top:14px}
.modal .detail-link{display:block;color:#a6e2f0;font-size:12px;margin:22px 0;text-decoration:none}
.modal .danger{font-size:11px;color:#f4bac2}
@media(min-width:760px){.modal-overlay{align-items:center}.modal{border-radius:26px;max-height:84vh}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
`;
export const manifest = JSON.stringify({
  id:"/mobile",name:"Notion Flow — Inbox & Tasks",short_name:"Notion Flow",
  start_url:"/mobile",scope:"/mobile",display:"standalone",
  background_color:"#07111c",theme_color:"#0b1722",lang:"ja",
  icons:[
    {src:"/mobile/icon.png?size=192",sizes:"192x192",type:"image/png",purpose:"any maskable"},
    {src:"/mobile/icon.png?size=512",sizes:"512x512",type:"image/png",purpose:"any maskable"}
  ]
});
export const serviceWorker = `
const CACHE = "notion-flow-shell-v1";
const RESOURCES = ["/mobile","/mobile/client.js","/mobile/styles.css","/mobile/manifest.webmanifest"];
self.addEventListener("install",event=>event.waitUntil(
 caches.open(CACHE).then(c=>c.addAll(RESOURCES)).then(()=>self.skipWaiting())
));
self.addEventListener("activate",event=>event.waitUntil(
 caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())
));
self.addEventListener("fetch",event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=="GET"||url.origin!==self.location.origin) return;
 if(!RESOURCES.includes(url.pathname)) return;
 event.respondWith(fetch(event.request).then(response=>{
  if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(event.request,copy)));}
  return response;
 }).catch(()=>caches.match(event.request)));
});
`;
