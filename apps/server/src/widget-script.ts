/**
 * Generates the self-contained embeddable widget JavaScript.
 * This is served at GET /widget.js — merchants add a single <script> tag to their site.
 *
 * The widget creates:
 * - A floating chat bubble (FAB) in the bottom-right (or left)
 * - A popup chat window with SSE streaming
 * - Full markdown rendering (bold, code, citations)
 * - Tool call indicators
 *
 * Configuration is via data-* attributes on the <script> tag:
 * - data-tenant-id: tenant identifier
 * - data-key: public widget token (NOT the LLM API key)
 * - data-accent: brand color (hex)
 * - data-title: chat header title
 * - data-position: "right" (default) or "left"
 */

export function getWidgetScript(apiBase: string): string {
  return `(function(){
  var s = document.currentScript;
  var tenantId = s.getAttribute("data-tenant-id") || "";
  var widgetKey = s.getAttribute("data-key") || "";
  var accent = s.getAttribute("data-accent") || "#6366F1";
  var position = s.getAttribute("data-position") || "right";
  var title = s.getAttribute("data-title") || "Support";
  var API = "${apiBase}";

  if (!widgetKey) { console.error("[helpdesk.ai] Missing data-key attribute"); return; }

  ${getWidgetStyles()}

  ${getWidgetDOM()}

  ${getWidgetLogic()}
})();`;
}

function getWidgetStyles(): string {
  return `// Inject styles
  var style = document.createElement("style");
  style.textContent = [
    ".hd-fab{position:fixed;bottom:24px;" + (position === "left" ? "left" : "right") + ":24px;width:56px;height:56px;" +
      "background:" + accent + ";color:#fff;border:0;border-radius:50%;cursor:pointer;z-index:99999;" +
      "box-shadow:0 6px 20px rgba(0,0,0,0.3);display:grid;place-items:center;transition:transform .12s}",
    ".hd-fab:hover{transform:translateY(-2px)}",
    ".hd-fab svg{width:24px;height:24px}",
    ".hd-popup{position:fixed;bottom:96px;" + (position === "left" ? "left" : "right") + ":24px;width:400px;" +
      "height:min(600px,calc(100vh - 140px));background:#131317;border:1px solid #2A2A32;" +
      "border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,0.5);display:none;flex-direction:column;" +
      "overflow:hidden;z-index:99998;font-family:-apple-system,system-ui,sans-serif;color:#FAFAFA}",
    ".hd-popup.open{display:flex;animation:hd-pop .2s ease-out}",
    "@keyframes hd-pop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}",
    ".hd-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;" +
      "border-bottom:1px solid #1F1F25;background:#0E0E11}",
    ".hd-hd-l{display:flex;align-items:center;gap:10px}",
    ".hd-avatar{width:32px;height:32px;background:linear-gradient(135deg," + accent + "," + accent + "cc);" +
      "border-radius:8px;display:grid;place-items:center;font-weight:600;font-size:13px;color:#fff}",
    ".hd-hd-title{font-size:13px;font-weight:600}",
    ".hd-hd-sub{font-size:10.5px;color:#8B8B94;margin-top:2px;display:flex;align-items:center;gap:4px}",
    ".hd-close{background:none;border:none;color:#8B8B94;cursor:pointer;padding:4px}",
    ".hd-close:hover{color:#FAFAFA}",
    ".hd-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;min-height:0}",
    ".hd-msg-user{align-self:flex-end;max-width:80%;background:rgba(99,102,241,0.12);" +
      "border:1px solid rgba(99,102,241,0.18);padding:9px 12px;border-radius:14px 14px 4px 14px;font-size:13.5px}",
    ".hd-msg-bot{display:flex;gap:8px;align-items:flex-start}",
    ".hd-msg-icon{width:24px;height:24px;background:#18181C;border:1px solid #2A2A32;border-radius:6px;" +
      "display:grid;place-items:center;flex-shrink:0;margin-top:2px}",
    ".hd-msg-icon svg{width:14px;height:14px;color:#C5C5CC}",
    ".hd-msg-body{font-size:13.5px;line-height:1.55;color:#FAFAFA;max-width:100%}",
    ".hd-msg-body p{margin:0 0 8px}",
    ".hd-msg-body p:last-child{margin:0}",
    ".hd-msg-body code{font-family:ui-monospace,monospace;font-size:12px;background:#18181C;" +
      "border:1px solid #2A2A32;padding:1px 5px;border-radius:3px;color:#818CF8}",
    ".hd-msg-body pre{background:#08080A;border:1px solid #1F1F25;border-radius:6px;padding:12px;" +
      "margin:8px 0;overflow-x:auto;font-size:12px;color:#C5C5CC}",
    ".hd-tool{margin:4px 0 4px 28px;padding:6px 10px;background:#131317;border:1px solid #1F1F25;" +
      "border-radius:6px;font-size:11px;color:#8B8B94;font-family:ui-monospace,monospace}",
    ".hd-dots{display:flex;gap:4px;padding:8px 0}",
    ".hd-dots i{width:5px;height:5px;border-radius:50%;background:#5C5C66;animation:hd-dot 1.2s infinite}",
    ".hd-dots i:nth-child(2){animation-delay:.15s}",
    ".hd-dots i:nth-child(3){animation-delay:.3s}",
    "@keyframes hd-dot{0%,80%,100%{opacity:.3}40%{opacity:1}}",
    ".hd-empty{margin:auto;text-align:center;padding:40px 16px}",
    ".hd-empty-title{font-size:15px;font-weight:500;margin-top:12px}",
    ".hd-empty-sub{font-size:12.5px;color:#8B8B94;margin-top:6px}",
    ".hd-compose{border-top:1px solid #1F1F25;padding:12px;background:#131317}",
    ".hd-compose-row{display:flex;gap:8px;background:#18181C;border:1px solid #2A2A32;" +
      "border-radius:8px;padding:4px 4px 4px 12px}",
    ".hd-compose-row:focus-within{border-color:#36363F}",
    ".hd-input{flex:1;background:none;border:none;outline:none;color:#FAFAFA;font-family:inherit;" +
      "font-size:13.5px;padding:8px 0;resize:none;max-height:120px}",
    ".hd-input::placeholder{color:#5C5C66}",
    ".hd-send{width:28px;height:28px;background:" + accent + ";color:#fff;border:none;border-radius:6px;" +
      "cursor:pointer;display:grid;place-items:center;flex-shrink:0}",
    ".hd-send:disabled{background:#18181C;color:#5C5C66;cursor:not-allowed}",
    ".hd-foot{text-align:center;padding:6px;font-size:10px;color:#5C5C66}",
    ".hd-foot a{color:#8B8B94;text-decoration:none}",
    ".hd-foot a:hover{color:#FAFAFA}"
  ].join("\\n");
  document.head.appendChild(style);`;
}

function getWidgetDOM(): string {
  return `// Create FAB button
  var fab = document.createElement("button");
  fab.className = "hd-fab";
  fab.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h10v7H7l-3 2v-2H3V4z"/></svg>';

  // Create popup
  var popup = document.createElement("div");
  popup.className = "hd-popup";
  popup.innerHTML = '<div class="hd-hd">' +
    '<div class="hd-hd-l">' +
      '<div class="hd-avatar">' + title[0] + '</div>' +
      '<div><div class="hd-hd-title">' + title + '</div>' +
      '<div class="hd-hd-sub"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#34D399;box-shadow:0 0 8px #34D399"></span> Online</div></div>' +
    '</div>' +
    '<button class="hd-close" id="hd-close"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6l4 4 4-4"/></svg></button>' +
  '</div>' +
  '<div class="hd-msgs" id="hd-msgs">' +
    '<div class="hd-empty">' +
      '<svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="' + accent + '" stroke-width="1.3">' +
        '<path d="M8 2L3 5v6l5 3 5-3V5L8 2z"/><path d="M8 5v6M5 6.5l3 1.5 3-1.5"/>' +
      '</svg>' +
      '<div class="hd-empty-title">Hi! How can I help?</div>' +
      '<div class="hd-empty-sub">Ask anything — I\\u0027ll search the docs and cite sources.</div>' +
    '</div>' +
  '</div>' +
  '<div class="hd-compose">' +
    '<div class="hd-compose-row">' +
      '<textarea class="hd-input" id="hd-input" rows="1" placeholder="Ask a question..."></textarea>' +
      '<button class="hd-send" id="hd-send" disabled><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5 8h6M8 5l3 3-3 3"/></svg></button>' +
    '</div>' +
    '<div class="hd-foot">powered by <a href="https://helpdesk-ai-web.onrender.com" target="_blank">helpdesk.ai</a></div>' +
  '</div>';

  document.body.appendChild(fab);
  document.body.appendChild(popup);`;
}

function getWidgetLogic(): string {
  return `// State
  var open = false;
  var sessionId = "widget-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  var sending = false;
  var msgs = document.getElementById("hd-msgs");
  var input = document.getElementById("hd-input");
  var sendBtn = document.getElementById("hd-send");

  fab.onclick = function() { open = !open; popup.classList.toggle("open", open); if(open) input.focus(); };
  document.getElementById("hd-close").onclick = function() { open = false; popup.classList.remove("open"); };

  input.oninput = function() {
    sendBtn.disabled = !input.value.trim() || sending;
    input.style.height = "auto";
    input.style.height = Math.min(120, input.scrollHeight) + "px";
  };
  input.onkeydown = function(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
  sendBtn.onclick = send;

  function addMsg(type, html) {
    var empty = msgs.querySelector(".hd-empty");
    if (empty) empty.remove();
    var div = document.createElement("div");
    if (type === "user") { div.className = "hd-msg-user"; div.textContent = html; }
    else if (type === "bot") {
      div.className = "hd-msg-bot";
      div.innerHTML = '<div class="hd-msg-icon"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M8 2L3 5v6l5 3 5-3V5L8 2z"/><path d="M8 5v6M5 6.5l3 1.5 3-1.5"/></svg></div><div class="hd-msg-body"></div>';
    } else if (type === "tool") { div.className = "hd-tool"; div.textContent = html; }
    else if (type === "thinking") {
      div.className = "hd-msg-bot"; div.id = "hd-thinking";
      div.innerHTML = '<div class="hd-msg-icon"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M8 2L3 5v6l5 3 5-3V5L8 2z"/><path d="M8 5v6M5 6.5l3 1.5 3-1.5"/></svg></div><div class="hd-msg-body"><div class="hd-dots"><i></i><i></i><i></i></div></div>';
    }
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  function fmt(text) {
    return text
      .replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>")
      .replace(/\\\`\\\`\\\`([\\\\s\\\\S]*?)\\\`\\\`\\\`/g, "<pre>$1</pre>")
      .replace(/\\\`([^\\\`]+)\\\`/g, "<code>$1</code>")
      .replace(/\\\\[(\d+)\\\\]/g, '<sup style="color:#818CF8;font-size:10px">[$1]</sup>')
      .replace(/\\n\\n/g, "</p><p>")
      .replace(/\\n/g, "<br>");
  }

  function send() {
    var text = input.value.trim();
    if (!text || sending) return;
    sending = true; input.value = ""; input.style.height = "auto"; sendBtn.disabled = true;

    addMsg("user", text);
    addMsg("thinking");
    var botEl = null, botBody = null, fullText = "";

    fetch(API + "/widget/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Widget-Key": widgetKey },
      body: JSON.stringify({ message: text, sessionId: sessionId })
    }).then(function(res) {
      if (!res.ok) throw new Error("Chat failed");
      var reader = res.body.getReader(), decoder = new TextDecoder(), buffer = "", curEvt = "";

      function read() {
        reader.read().then(function(r) {
          if (r.done) { finish(); return; }
          buffer += decoder.decode(r.value, { stream: true });
          var lines = buffer.split("\\n"); buffer = lines.pop() || "";
          for (var i = 0; i < lines.length; i++) {
            var l = lines[i];
            if (l.indexOf("event: ") === 0) curEvt = l.slice(7);
            else if (l.indexOf("data: ") === 0 && curEvt) {
              try { handle(curEvt, JSON.parse(l.slice(6))); } catch(e) {}
              curEvt = "";
            }
          }
          read();
        });
      }
      read();
    }).catch(function() {
      var t = document.getElementById("hd-thinking"); if (t) t.remove();
      var el = addMsg("bot"); el.querySelector(".hd-msg-body").innerHTML = "<p>Sorry, something went wrong.</p>";
      sending = false; sendBtn.disabled = false;
    });

    function handle(type, data) {
      if (type === "tool_start") { addMsg("tool", "searching: " + (data.name || "docs") + "..."); }
      else if (type === "tool_end") {
        var ts = msgs.querySelectorAll(".hd-tool"), last = ts[ts.length-1];
        if (last) last.textContent = (data.ok ? "found" : "no results") + " \\u2014 " + (data.name || "search");
      } else if (type === "text") {
        var t = document.getElementById("hd-thinking"); if (t) t.remove();
        if (!botEl) { botEl = addMsg("bot"); botBody = botEl.querySelector(".hd-msg-body"); }
        fullText += data.token || "";
        botBody.innerHTML = "<p>" + fmt(fullText) + "</p>";
        msgs.scrollTop = msgs.scrollHeight;
      } else if (type === "done") {
        var t2 = document.getElementById("hd-thinking"); if (t2) t2.remove();
        if (!botEl && fullText) { botEl = addMsg("bot"); botBody = botEl.querySelector(".hd-msg-body"); botBody.innerHTML = "<p>" + fmt(fullText) + "</p>"; }
        finish();
      } else if (type === "error") {
        var t3 = document.getElementById("hd-thinking"); if (t3) t3.remove();
        if (!botEl) { botEl = addMsg("bot"); botBody = botEl.querySelector(".hd-msg-body"); }
        botBody.innerHTML = "<p>Error: " + (data.message || "Unknown error") + "</p>";
        finish();
      }
    }

    function finish() { sending = false; sendBtn.disabled = !input.value.trim(); }
  }`;
}
