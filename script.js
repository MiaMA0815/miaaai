/* ========== 配置 ========== */
const CONFIG = {
  // 你的后端接口地址，例如 "/api/chat"。留空则进入演示模式（模拟回复，不调用真实模型）
  API_URL: "",
};
// 人设：多语言 + 幽默风趣。后端会把它作为 system prompt 传给模型
const PERSONA = `You are Quip, a witty, warm and genuinely helpful AI companion.
- Always reply in the language the user writes in (Chinese, English or Japanese). If they switch languages, switch with them. Use natural, idiomatic phrasing, not translationese.
- Be funny in a dry, light, intelligent way: an occasional pun, playful analogy or self-aware aside. One joke per answer is plenty; never force it.
- Accuracy comes first. Give a real, useful answer, then add the charm.
- For serious topics (health, grief, legal, safety, someone clearly upset) drop the jokes and be calm and kind.
- Keep answers concise; use Markdown lists and code blocks when they help.`;
/*
  后端约定：POST JSON { messages:[{role,content}], system, lang }
  返回流式文本：
    - Content-Type 为 text/event-stream 时，每行 `data: {"text":"片段"}`，结束用 `data: [DONE]`
    - 否则直接返回纯文本流
*/

const I18N = {
  zh:{ tagline:"聪明，但不严肃", newChat:"＋ 新对话", chatTitle:"新对话", send:"发送", stop:"停止",
    placeholder:"想聊点什么？Enter 发送，Shift+Enter 换行", hello:"今天想聊点什么？",
    sub:"中文、English、日本語都行，我会跟着你的语言走。", err:"请求失败，请检查后端接口。", del:"删除对话",
    chips:["用三句话向外婆解释什么是区块链","帮我写一条拒绝加班的体面微信","How do I say 'I'm fine' in a way that means 'I'm not'?","「お疲れ様です」を英語でどう言えばいい？"],
    demo:"这是**演示模式**的回复，还没有连上真实模型（它现在的智商大概和一台计算器差不多）。\n\n要接入真实模型，把 `script.js` 顶部的 `API_URL` 改成你的后端接口就行：\n\n```js\nconsole.log('你好，世界');\n```" },
  en:{ tagline:"Smart, but not stuffy", newChat:"+ New chat", chatTitle:"New chat", send:"Send", stop:"Stop",
    placeholder:"What's on your mind? Enter to send, Shift+Enter for a new line", hello:"What shall we talk about?",
    sub:"English, 中文 or 日本語 — I'll follow your lead.", err:"Request failed. Please check your backend endpoint.", del:"Delete chat",
    chips:["Explain blockchain to my grandma in three sentences","Write a polite way to decline overtime","如何用英语委婉地说“我不同意”？","「よろしくお願いします」を英語にすると？"],
    demo:"This is **demo mode**: no real model is connected yet (my IQ is currently on par with a calculator).\n\nTo go live, set `API_URL` at the top of `script.js` to your backend endpoint:\n\n```js\nconsole.log('Hello, world');\n```" },
  ja:{ tagline:"賢いけど、堅くない", newChat:"＋ 新しいチャット", chatTitle:"新しいチャット", send:"送信", stop:"停止",
    placeholder:"何を話しましょう？Enterで送信、Shift+Enterで改行", hello:"今日は何を話しましょうか？",
    sub:"日本語・English・中文、どれでもOK。言葉に合わせます。", err:"リクエストに失敗しました。バックエンドを確認してください。", del:"チャットを削除",
    chips:["ブロックチェーンをおばあちゃんに3文で説明して","残業を角が立たないように断る文面を書いて","How do I politely say 'no' in Japanese?","“加油”用英语怎么说才自然？"],
    demo:"これは**デモモード**の返信です。まだ本物のモデルにはつながっていません（今の知能は電卓並みです）。\n\n接続するには、`script.js` の先頭にある `API_URL` をバックエンドのURLに変えてください：\n\n```js\nconsole.log('こんにちは');\n```" },
};
let lang = (() => { try{ const s = localStorage.getItem("ai-lang"); if(s) return s; }catch{}
  const n = (navigator.language||"zh").slice(0,2); return I18N[n] ? n : "zh"; })();
const t = k => I18N[lang][k];

/* ========== 状态 ========== */
const $ = id => document.getElementById(id);
const els = {sidebar:$("sidebar"),list:$("chatList"),msgs:$("messages"),input:$("input"),send:$("send"),title:$("title")};
const chatName = c => (c && c.title) || t("chatTitle");
let chats = load();
let currentId = chats[0]?.id || null;
let controller = null;

function load(){ try{ return JSON.parse(localStorage.getItem("ai-chats")||"[]"); }catch{ return []; } }
function save(){ try{ localStorage.setItem("ai-chats", JSON.stringify(chats)); }catch{} }
const current = () => chats.find(c => c.id === currentId);

/* ========== Markdown（轻量） ========== */
const esc = s => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
function inline(s){
  return s.replace(/`([^`]+)`/g,"<code>$1</code>")
          .replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>")
          .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function block(t){
  let html = "", list = null;
  const close = () => { if(list){ html += `</${list}>`; list = null; } };
  t.split("\n").forEach(line => {
    let m;
    if((m = line.match(/^\s*[-*]\s+(.*)/))){ if(list!=="ul"){close();html+="<ul>";list="ul";} html+=`<li>${inline(m[1])}</li>`; }
    else if((m = line.match(/^\s*\d+\.\s+(.*)/))){ if(list!=="ol"){close();html+="<ol>";list="ol";} html+=`<li>${inline(m[1])}</li>`; }
    else if((m = line.match(/^#{1,6}\s+(.*)/))){ close(); html+=`<h4>${inline(m[1])}</h4>`; }
    else if(!line.trim()){ close(); }
    else { close(); html+=`<p>${inline(line)}</p>`; }
  });
  close(); return html;
}
function md(src){
  return src.split("```").map((p,i) => {
    if(i%2===1){ const nl = p.indexOf("\n"); const code = nl>-1 ? p.slice(nl+1) : p; return `<pre><code>${esc(code.replace(/\n$/,""))}</code></pre>`; }
    return block(esc(p));
  }).join("");
}

/* ========== 渲染 ========== */
function renderList(){
  els.list.innerHTML = "";
  chats.forEach(c => {
    const d = document.createElement("div");
    d.className = "chat-item" + (c.id===currentId ? " active" : "");
    d.innerHTML = `<span>${esc(chatName(c))}</span><button aria-label="${t("del")}">✕</button>`;
    d.onclick = () => { currentId = c.id; closeSide(); renderAll(); };
    d.querySelector("button").onclick = e => { e.stopPropagation(); removeChat(c.id); };
    els.list.appendChild(d);
  });
}
function row(role, content){
  const r = document.createElement("div");
  r.className = "row " + (role==="user" ? "user" : "ai");
  const b = document.createElement("div");
  b.className = "bubble";
  if(role==="user") b.textContent = content; else b.innerHTML = md(content);
  if(role!=="user") r.insertAdjacentHTML("afterbegin", '<div class="avatar">Q</div>');
  r.appendChild(b); els.msgs.appendChild(r);
  return b;
}
function renderMessages(){
  els.msgs.innerHTML = "";
  const c = current();
  if(!c || !c.messages.length){
    els.msgs.innerHTML = `<div class="empty"><h2>${t("hello")}</h2><p>${t("sub")}</p>
      <div class="chips">${t("chips").map(x=>`<button class="chip">${esc(x)}</button>`).join("")}</div></div>`;
    els.msgs.querySelectorAll(".chip").forEach(b => b.onclick = () => send(b.textContent));
  } else c.messages.forEach(m => row(m.role, m.content));
  els.title.textContent = chatName(c);
  els.msgs.scrollTop = els.msgs.scrollHeight;
}
const renderAll = () => { renderList(); renderMessages(); };

/* ========== 对话管理 ========== */
function newChat(){
  const c = current();
  if(c && !c.messages.length){ closeSide(); return; }
  const n = {id: Date.now().toString(36), title:"", messages:[]};
  chats.unshift(n); currentId = n.id; save(); closeSide(); renderAll(); els.input.focus();
}
function removeChat(id){
  chats = chats.filter(c => c.id !== id);
  if(currentId === id) currentId = chats[0]?.id || null;
  save(); function applyLang(){
  document.documentElement.lang = {zh:"zh-CN",en:"en",ja:"ja"}[lang];
  document.querySelectorAll("[data-i18n]").forEach(e => e.textContent = t(e.dataset.i18n));
  els.input.placeholder = t("placeholder");
  els.send.textContent = controller ? t("stop") : t("send");
  document.querySelectorAll(".lang button").forEach(b => b.classList.toggle("on", b.dataset.lang === lang));
  if(!controller) renderAll(); else renderList();
}
document.querySelectorAll(".lang button").forEach(b => b.onclick = () => {
  lang = b.dataset.lang; try{ localStorage.setItem("ai-lang", lang); }catch{} applyLang();
});
applyLang();
}

/* ========== 流式请求 ========== */
async function* demoStream(){
  for(const ch of t("demo")){ await new Promise(r => setTimeout(r, 16)); yield ch; }
}
async function* streamReply(messages, signal){
  if(!CONFIG.API_URL){ yield* demoStream(); return; }
  const res = await fetch(CONFIG.API_URL, {method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({messages, system: PERSONA, lang}), signal});
  if(!res.ok) throw new Error(`${t("err")} (${res.status})`);
  const reader = res.body.getReader(), dec = new TextDecoder();
  const sse = (res.headers.get("content-type")||"").includes("text/event-stream");
  let buf = "";
  while(true){
    const {done, value} = await reader.read(); if(done) break;
    const chunk = dec.decode(value, {stream:true});
    if(!sse){ yield chunk; continue; }
    buf += chunk; const lines = buf.split("\n"); buf = lines.pop();
    for(const l of lines){
      if(!l.startsWith("data:")) continue;
      const d = l.slice(5).trim(); if(d==="[DONE]") return;
      try{ const j = JSON.parse(d); yield j.text ?? j.delta?.text ?? ""; }catch{}
    }
  }
}

async function send(text){
  text = (text ?? els.input.value).trim();
  if(!text || controller) return;
  let c = current();
  if(!c){ c = {id:Date.now().toString(36), title:"", messages:[]}; chats.unshift(c); currentId = c.id; }
  if(!c.messages.length) c.title = text.slice(0, 24);
  c.messages.push({role:"user", content:text});
  els.input.value = ""; grow(); save(); function applyLang(){
  document.documentElement.lang = {zh:"zh-CN",en:"en",ja:"ja"}[lang];
  document.querySelectorAll("[data-i18n]").forEach(e => e.textContent = t(e.dataset.i18n));
  els.input.placeholder = t("placeholder");
  els.send.textContent = controller ? t("stop") : t("send");
  document.querySelectorAll(".lang button").forEach(b => b.classList.toggle("on", b.dataset.lang === lang));
  if(!controller) renderAll(); else renderList();
}
document.querySelectorAll(".lang button").forEach(b => b.onclick = () => {
  lang = b.dataset.lang; try{ localStorage.setItem("ai-lang", lang); }catch{} applyLang();
});
applyLang();

  const bubble = row("ai", ""); bubble.classList.add("cursor");
  let reply = "";
  controller = new AbortController();
  els.send.textContent = t("stop");
  try{
    for await(const part of streamReply(c.messages, controller.signal)){
      reply += part; bubble.innerHTML = md(reply); bubble.classList.add("cursor");
      els.msgs.scrollTop = els.msgs.scrollHeight;
    }
  }catch(e){
    if(e.name !== "AbortError"){ const m = e instanceof TypeError ? t("err") : e.message; bubble.insertAdjacentHTML("beforeend", `<p class="error">${esc(m)}</p>`); }
  }
  bubble.classList.remove("cursor");
  if(reply) c.messages.push({role:"assistant", content:reply});
  controller = null; els.send.textContent = t("send"); save(); renderList();
}

/* ========== 交互 ========== */
function grow(){ els.input.style.height = "auto"; els.input.style.height = els.input.scrollHeight + "px"; }
const closeSide = () => els.sidebar.classList.remove("open");
els.input.addEventListener("input", grow);
els.input.addEventListener("keydown", e => { if(e.key==="Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); send(); } });
els.send.onclick = () => controller ? controller.abort() : send();
$("newChat").onclick = newChat;
$("menuBtn").onclick = () => els.sidebar.classList.add("open");
$("scrim").onclick = closeSide;
function applyLang(){
  document.documentElement.lang = {zh:"zh-CN",en:"en",ja:"ja"}[lang];
  document.querySelectorAll("[data-i18n]").forEach(e => e.textContent = t(e.dataset.i18n));
  els.input.placeholder = t("placeholder");
  els.send.textContent = controller ? t("stop") : t("send");
  document.querySelectorAll(".lang button").forEach(b => b.classList.toggle("on", b.dataset.lang === lang));
  if(!controller) renderAll(); else renderList();
}
document.querySelectorAll(".lang button").forEach(b => b.onclick = () => {
  lang = b.dataset.lang; try{ localStorage.setItem("ai-lang", lang); }catch{} applyLang();
});
applyLang();
