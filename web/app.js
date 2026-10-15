(function () {
  "use strict";
  const { Brain, LANGS, GREETING, detectTextLang } = window.CampusNLP;
  const brain = new Brain(window.CC_DATA);
  const native = window.AndroidBridge || null; // injected by the Android wrapper
  const LOCALE = { en: "en-IN", ta: "ta-IN", te: "te-IN", ml: "ml-IN", hi: "hi-IN" };
  const QUICK = [
    "How can I contact admissions?",
    "What are the library timings?",
    "Route from Technology Tower to Main Building",
    "Where is the Anna Auditorium?",
    "What are the mess timings?",
  ];
  const $ = (id) => document.getElementById(id);
  const chat = $("chat"), input = $("input"), micBtn = $("micBtn"), statusEl = $("status");

  /* ---------- settings (per-device, best effort) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem("cc." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("cc." + k, JSON.stringify(v)); } catch (e) {} },
  };
  const opt = { speak: store.get("speak", false), maps: store.get("maps", true), voice: store.get("voice", "en") };
  $("optSpeak").checked = opt.speak; $("optMaps").checked = opt.maps; $("optVoiceLang").value = opt.voice;
  $("optSpeak").onchange = (e) => { opt.speak = e.target.checked; store.set("speak", opt.speak); if (!opt.speak) stopSpeaking(); };
  $("optMaps").onchange = (e) => { opt.maps = e.target.checked; store.set("maps", opt.maps); };
  $("optVoiceLang").onchange = (e) => { opt.voice = e.target.value; store.set("voice", opt.voice); };

  /* ---------- helpers ---------- */
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function md(s) { // tiny, safe markdown: **bold**, *italic*, bare links
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\*(.+?)\*/g, "<i>$1</i>")
      .replace(/(https?:\/\/[^\s<]+[^\s<.,;:)।])/g, '<a href="$1" data-ext="1">$1</a>');
  }
  function openExternal(url) {
    if (native && native.openUrl) native.openUrl(url);
    else window.open(url, "_blank", "noopener");
  }
  function setStatus(t) { statusEl.hidden = !t; statusEl.textContent = t || ""; }

  /* ---------- rendering ---------- */
  let messages = [{ role: "assistant", content: GREETING, meta: {} }];
  const KIND = { faq: "FAQ answer", route: "Navigation", unknown: "Unknown place", fallback: "No match" };

  function render() {
    chat.innerHTML = "";
    for (const m of messages) {
      const row = document.createElement("div");
      row.className = "msg " + m.role;
      const meta = m.meta || {};
      let extra = "";
      if (m.role === "user" && meta.lang) {
        extra = `<div class="meta">${meta.source === "voice" ? "🎙️ Voice" : "⌨️ Text"} · ${esc(LANGS[meta.lang] || meta.lang)}</div>`;
      } else if (m.role === "assistant" && meta.kind) {
        extra = `<div class="meta">${KIND[meta.kind] || ""} · ${esc(LANGS[meta.lang] || meta.lang)} · confidence ${(meta.score || 0).toFixed(2)}</div>`;
        if (meta.map_url) extra += `<a class="maplink" href="${esc(meta.map_url)}" data-ext="1">🗺️ Open in Google Maps</a>`;
        if (meta.verified === false) extra += `<div class="warn">⚠️ Sample or placeholder data. Please confirm with the official VIT office.</div>`;
      }
      row.innerHTML = `<div class="avatar">${m.role === "user" ? "🧑‍🎓" : "🎓"}</div><div class="bubble">${m.role === "user" ? esc(m.content) : md(m.content)}${extra}</div>`;
      chat.appendChild(row);
    }
    chat.scrollTop = chat.scrollHeight;
  }
  chat.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-ext]");
    if (a) { e.preventDefault(); openExternal(a.href); }
  });

  /* ---------- core ---------- */
  function handle(text, lang, source) {
    text = text.trim();
    if (!text) return;
    messages.push({ role: "user", content: text, meta: { lang, source } });
    let res;
    try { res = brain.respond(text, lang); }
    catch (err) { res = { kind: "fallback", text: "Something went wrong. Please try again.", score: 0 }; }
    messages.push({
      role: "assistant", content: res.text,
      meta: { lang, kind: res.kind, score: res.score || 0, verified: res.verified !== false, map_url: res.map_url || null },
    });
    render();
    if (opt.speak) speak(res.text, lang);
    if (res.kind === "route" && opt.maps && res.map_url) openExternal(res.map_url);
  }

  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value;
    if (!v.trim()) return;
    input.value = "";
    handle(v, detectTextLang(v), "text");
  });

  function buildQuick(container, onDone) {
    for (const q of QUICK) {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = q;
      b.onclick = () => { handle(q, detectTextLang(q), "text"); if (onDone) onDone(); };
      container.appendChild(b);
    }
  }
  buildQuick($("quick")); buildQuick($("quickList"), closeDrawer);

  /* ---------- drawer ---------- */
  const drawer = $("drawer"), scrim = $("scrim"), menuBtn = $("menuBtn");
  function openDrawer() { drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false"); scrim.hidden = false; menuBtn.setAttribute("aria-expanded", "true"); }
  function closeDrawer() { drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); scrim.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); }
  menuBtn.onclick = openDrawer; scrim.onclick = closeDrawer;
  $("clearBtn").onclick = () => { stopSpeaking(); messages = [{ role: "assistant", content: GREETING, meta: {} }]; render(); closeDrawer(); };
  window.CCBack = () => { if (drawer.classList.contains("open")) { closeDrawer(); return true; } return false; };

  /* ---------- text to speech ---------- */
  function plain(t) { return t.replace(/https?:\/\/\S+/g, "").replace(/\[PLACEHOLDER[^\]]*\]/g, "").replace(/\*/g, "").trim(); }
  function speak(text, lang) {
    const t = plain(text);
    if (!t) return;
    if (native && native.speak) native.speak(t, LOCALE[lang] || "en-IN");
    else if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(t); u.lang = LOCALE[lang] || "en-IN";
      speechSynthesis.speak(u);
    }
  }
  function stopSpeaking() {
    if (native && native.stopSpeaking) native.stopSpeaking();
    else if ("speechSynthesis" in window) speechSynthesis.cancel();
  }
  window.onNativeTtsError = () => setStatus("Voice reply unavailable for this language. Install its voice in Android settings.");

  /* ---------- voice input ---------- */
  let listening = false, webRec = null;
  function setMic(state) { // idle | on | busy
    listening = state !== "idle";
    micBtn.classList.toggle("on", state === "on");
    micBtn.classList.toggle("busy", state === "busy");
    micBtn.textContent = state === "on" ? "⏹" : "🎙️";
    micBtn.setAttribute("aria-label", state === "on" ? "Stop listening" : "Tap to speak");
  }
  function onHeard(text) {
    setMic("idle"); setStatus("");
    text = (text || "").trim();
    if (!text) { setStatus("I couldn't hear anything. Please try again closer to the microphone."); return; }
    const guess = detectTextLang(text);
    handle(text, guess !== "en" ? guess : opt.voice, "voice"); // recogniser writes native script; Latin text => chosen voice language
  }
  window.onNativeSpeechState = (s) => { if (s === "listening") { setMic("on"); setStatus("Listening… speak now"); } else if (s === "processing") { setMic("busy"); setStatus("Transcribing…"); } };
  window.onNativeSpeechResult = onHeard;
  window.onNativeSpeechError = (code) => {
    setMic("idle");
    const msg = {
      permission: "Microphone permission is needed for voice input. Allow it in Android settings.",
      unavailable: "Speech recognition isn't available on this device. Install or enable Google speech services.",
      nomatch: "I couldn't hear anything. Please try again closer to the microphone.",
      timeout: "I couldn't hear anything. Please try again closer to the microphone.",
      network: "Speech recognition needs internet for this language unless its offline pack is installed.",
    }[code] || "Voice input failed. Please try again or type your question.";
    setStatus(msg);
  };
  micBtn.onclick = () => {
    if (listening) { if (native && native.stopListening) native.stopListening(); else if (webRec) webRec.stop(); return; }
    stopSpeaking(); setStatus("");
    if (native && native.startListening) { native.startListening(LOCALE[opt.voice]); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setStatus("Voice input isn't supported in this browser. Please type your question."); return; }
    webRec = new SR(); webRec.lang = LOCALE[opt.voice]; webRec.interimResults = false; webRec.maxAlternatives = 1;
    webRec.onstart = () => { setMic("on"); setStatus("Listening… speak now"); };
    webRec.onresult = (e) => onHeard(e.results[0][0].transcript);
    webRec.onerror = (e) => window.onNativeSpeechError(e.error === "not-allowed" ? "permission" : e.error === "no-speech" ? "nomatch" : "other");
    webRec.onend = () => { if (listening) setMic("idle"); };
    try { webRec.start(); } catch (e) { setMic("idle"); }
  };


  /* ---------- searchable FAQ explorer ---------- */
  const faqExplorer = $("faqExplorer"), faqSearch = $("faqSearch");
  const faqItems = (window.CC_DATA && window.CC_DATA.faqs && window.CC_DATA.faqs.faqs) || [];
  let activeFaqCategory = "All";
  const faqCategories = ["All", ...new Set(faqItems.map((f) => f.category || "General"))];
  function renderFaqCategories() {
    const host = $("faqCategories");
    host.innerHTML = "";
    faqCategories.forEach((category) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = category;
      b.className = "faq-category" + (category === activeFaqCategory ? " active" : "");
      b.setAttribute("aria-pressed", String(category === activeFaqCategory));
      b.onclick = () => { activeFaqCategory = category; renderFaqCategories(); renderFaqResults(); };
      host.appendChild(b);
    });
  }
  function renderFaqResults() {
    const host = $("faqResults"), query = (faqSearch.value || "").trim().toLocaleLowerCase();
    const filtered = faqItems.filter((f) => {
      const inCategory = activeFaqCategory === "All" || (f.category || "General") === activeFaqCategory;
      const searchable = [f.category, ...(f.questions || []), ...Object.values(f.answers || {})].join(" ").toLocaleLowerCase();
      return inCategory && (!query || searchable.includes(query));
    }).slice(0, 40);
    host.innerHTML = "";
    if (!filtered.length) {
      const empty = document.createElement("p"); empty.className = "faq-empty";
      empty.textContent = "No matching questions. Try another keyword or ask in the chat below.";
      host.appendChild(empty); return;
    }
    filtered.forEach((faq) => {
      const card = document.createElement("article"); card.className = "faq-card";
      const button = document.createElement("button"); button.type = "button"; button.className = "faq-question";
      button.textContent = (faq.questions && faq.questions[0]) || "Campus question";
      const tag = document.createElement("span"); tag.className = "faq-tag"; tag.textContent = faq.category || "General";
      const answer = document.createElement("div"); answer.className = "faq-answer"; answer.hidden = true;
      const answerText = document.createElement("p"); answerText.textContent = (faq.answers && (faq.answers.en || faq.answers[opt.voice])) || "Please check the official VIT sources for the latest information.";
      answer.appendChild(answerText);
      if (faq.verified === false) {
        const note = document.createElement("small"); note.className = "faq-caution";
        note.textContent = "Confirm current details with an official VIT source.";
        answer.appendChild(note);
      }
      button.appendChild(tag);
      button.onclick = () => {
        const opening = answer.hidden;
        answer.hidden = !opening;
        button.setAttribute("aria-expanded", String(opening));
        card.classList.toggle("expanded", opening);
      };
      card.appendChild(button); card.appendChild(answer); host.appendChild(card);
    });
  }
  function setFaqExplorer(open) {
    faqExplorer.hidden = !open;
    $("exploreBtn").setAttribute("aria-expanded", String(open));
    $("exploreBtn").classList.toggle("selected", open);
    if (open) { renderFaqCategories(); renderFaqResults(); }
  }
  $("exploreBtn").onclick = () => setFaqExplorer(faqExplorer.hidden);
  $("closeFaqBtn").onclick = () => setFaqExplorer(false);
  faqSearch.addEventListener("input", renderFaqResults);

  render();
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
