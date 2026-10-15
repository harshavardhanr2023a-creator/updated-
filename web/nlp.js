/* CampusConnect on-device brain.
 * JavaScript port of campusconnect/{config,maps,nlp}.py.
 * The Python app used a 470 MB multilingual sentence-transformer. That cannot run inside an APK,
 * so FAQ retrieval here is TF-IDF over words + character trigrams (works offline, instant, and
 * handles Indic scripts/typos). Place matching and routing logic is ported 1:1. */
(function (root) {
  "use strict";

  const LANGS = { en: "English", ta: "தமிழ்", te: "తెలుగు", ml: "മലയാളം", hi: "हिन्दी" };
  const FAQ_THRESHOLD = 0.27;      // minimum similarity to answer from the FAQ
  const UNKNOWN_BELOW = 0.5;       // route cue + no place found + weaker FAQ match => "unknown place"
  const ANSWER_DOC_WEIGHT = 0.85;  // answer text is a weaker retrieval signal than the question text

  const GREETING =
    "Hello! I'm **Campus Connect**, your VIT Vellore assistant. " +
    "Ask about admissions, academics, hostels, the library or campus places, " +
    "by voice or text, in English, Tamil, Telugu, Malayalam or Hindi. " +
    'Try *"Route from PRP to Main Block"*.';

  const T = {
    en: {
      route: "Opening directions to **{dest}** from your current location.",
      route_from: "Opening directions from **{origin}** to **{dest}**.",
      unknown: "I couldn't find that place on the campus map. Try one of: {examples}.",
      fallback: "Sorry, I couldn't find a reliable answer. Please rephrase, or contact the VIT helpdesk at +91 416 224 3091.",
    },
    ta: {
      route: "உங்கள் தற்போதைய இடத்திலிருந்து **{dest}** செல்லும் வழியைத் திறக்கிறேன்.",
      route_from: "**{origin}** இலிருந்து **{dest}** செல்லும் வழியைத் திறக்கிறேன்.",
      unknown: "அந்த இடம் வளாக வரைபடத்தில் கிடைக்கவில்லை. இவற்றில் ஒன்றை முயற்சிக்கவும்: {examples}.",
      fallback: "மன்னிக்கவும், நம்பகமான பதில் கிடைக்கவில்லை. மீண்டும் கேளுங்கள் அல்லது +91 416 224 3091 என்ற எண்ணில் தொடர்பு கொள்ளவும்.",
    },
    te: {
      route: "మీ ప్రస్తుత స్థానం నుండి **{dest}** కు దారిని తెరుస్తున్నాను.",
      route_from: "**{origin}** నుండి **{dest}** కు దారిని తెరుస్తున్నాను.",
      unknown: "ఆ స్థలం క్యాంపస్ మ్యాప్‌లో కనబడలేదు. వీటిలో ఒకదాన్ని ప్రయత్నించండి: {examples}.",
      fallback: "క్షమించండి, నమ్మదగిన సమాధానం దొరకలేదు. దయచేసి మళ్లీ అడగండి లేదా +91 416 224 3091 కు కాల్ చేయండి.",
    },
    ml: {
      route: "നിങ്ങളുടെ നിലവിലെ സ്ഥലത്തു നിന്ന് **{dest}** ലേക്കുള്ള വഴി തുറക്കുന്നു.",
      route_from: "**{origin}** ൽ നിന്ന് **{dest}** ലേക്കുള്ള വഴി തുറക്കുന്നു.",
      unknown: "ആ സ്ഥലം ക്യാമ്പസ് മാപ്പിൽ കണ്ടെത്തിയില്ല. ഇവയിലൊന്ന് പരീക്ഷിക്കുക: {examples}.",
      fallback: "ക്ഷമിക്കണം, വിശ്വസനീയമായ ഉത്തരം കണ്ടെത്താനായില്ല. വീണ്ടും ചോദിക്കുക അല്ലെങ്കിൽ +91 416 224 3091 ൽ ബന്ധപ്പെടുക.",
    },
    hi: {
      route: "आपके वर्तमान स्थान से **{dest}** का रास्ता खोल रहा हूँ।",
      route_from: "**{origin}** से **{dest}** तक का रास्ता खोल रहा हूँ।",
      unknown: "वह स्थान कैंपस मानचित्र में नहीं मिला। इनमें से कोई आज़माएँ: {examples}।",
      fallback: "क्षमा करें, भरोसेमंद उत्तर नहीं मिला। कृपया दोबारा पूछें या +91 416 224 3091 पर संपर्क करें।",
    },
  };

  const SCRIPTS = [["ta", 0x0b80, 0x0bff], ["te", 0x0c00, 0x0c7f], ["ml", 0x0d00, 0x0d7f], ["hi", 0x0900, 0x097f]];

  const CUES = new RegExp(
    "\\broute\\b|\\bdirections?\\b|\\bnavigate\\b|\\bhow (?:do i|to|can i) (?:get|reach|go)\\b" +
      "|\\bwhere(?:'s| is| are)\\b|\\bway to\\b|\\bpath to\\b|\\btake me\\b|\\bon (?:the )?map\\b" +
      "|रास्ता|रास्ते|मार्ग|कहाँ|कहां|कैसे पहुँच|कैसे पहुंच|दिशा" +
      "|வழி|பாதை|எங்கே|எங்கு|எப்படி செல்" +
      "|దారి|మార్గం|ఎక్కడ|ఎలా వెళ్" +
      "|വഴി|എവിടെ|എങ്ങനെ പോകാം",
    "i"
  );

  function detectTextLang(text) {
    const counts = { ta: 0, te: 0, ml: 0, hi: 0 };
    for (const ch of text) {
      const o = ch.codePointAt(0);
      for (const [code, lo, hi] of SCRIPTS) if (o >= lo && o <= hi) counts[code]++;
    }
    let best = "en", n = 0;
    for (const k of Object.keys(counts)) if (counts[k] > n) { best = k; n = counts[k]; }
    return best;
  }

  /* ---- maps.py ---- */
  function point(loc) {
    if (loc.lat != null && loc.lng != null) return loc.lat + "," + loc.lng;
    return loc.name + ", VIT Vellore, Tamil Nadu";
  }
  function directionsUrl(dest, origin, mode) {
    const enc = (s) => encodeURIComponent(s).replace(/%2C/gi, ",").replace(/%20/g, "+");
    let url = "https://www.google.com/maps/dir/?api=1&destination=" + enc(point(dest)) + "&travelmode=" + (mode || "walking");
    if (origin) url += "&origin=" + enc(point(origin));
    return url;
  }

  /* ---- text normalisation + TF-IDF ---- */
  const STOP = new Set(
    "a an the is are was were am be to of in on at for from by with and or what whats which who whom how do does did i me my we you your it its this that there tell about please can could would should get give any have has का की के है हैं क्या कैसे में से को और कि என்ன எப்படி என்றால் ఎలా ఏమిటి എങ്ങനെ എന്താണ് എന്തൊക്കെ".split(" ")
  );
  function norm(s) {
    return String(s).normalize("NFC").toLowerCase().replace(/[\u200c\u200d]/g, "").replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  }
  function baseFeatures(text) {
    const words = norm(text).split(" ").filter(Boolean);
    let content = words.filter((w) => !STOP.has(w));
    if (!content.length) content = words;
    const f = new Map();
    const add = (k, w) => f.set(k, (f.get(k) || 0) + w);
    for (const w of content) {
      add("w:" + w, 1);
      const p = " " + w + " ";
      for (let i = 0; i + 3 <= p.length; i++) add("c:" + p.slice(i, i + 3), 0.4);
    }
    return f;
  }
  function dice(a, b) { // character-bigram Dice similarity, for fuzzy place names
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.substr(i, 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
    const A = grams(a), B = grams(b);
    let inter = 0;
    for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0);
    return (2 * inter) / (a.length - 1 + b.length - 1);
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  const isAscii = (s) => /^[\x00-\x7f]*$/.test(s);

  class Brain {
    constructor(data) {
      this.faqs = data.faqs.faqs;
      const locs = data.locations.locations;
      this.locs = {};
      for (const l of locs) this.locs[l.id] = l;

      this.aliasNorm = [];
      for (const [lid, loc] of Object.entries(this.locs))
        for (const a of [loc.name].concat(loc.aliases || [])) { const n = norm(a); if (n.length >= 2) this.aliasNorm.push([" " + n + " ", lid]); }

      // retrieval corpus: every question, plus each answer text as a weaker document
      this.docs = [];
      this.faqs.forEach((faq, i) => {
        for (const q of faq.questions) this.docs.push({ owner: i, text: q, w: 1 });
        for (const a of Object.values(faq.answers))
          for (const sent of a.replace(/\[PLACEHOLDER[^\]]*\]/g, " ").split(/(?<=[.।!?])\s+/))
            if (norm(sent).length > 3) this.docs.push({ owner: i, text: sent, w: ANSWER_DOC_WEIGHT });
      });
      const raw = this.docs.map((d) => this._features(d.text));
      const df = new Map();
      for (const f of raw) for (const k of f.keys()) df.set(k, (df.get(k) || 0) + 1);
      this.N = raw.length;
      this.df = df;
      this.vecs = raw.map((f) => this._vec(f));

      this.aliases = [];
      for (const [lid, loc] of Object.entries(this.locs))
        for (const a of [loc.name].concat(loc.aliases || [])) this.aliases.push([a.toLowerCase(), lid]);
      this.aliases.sort((x, y) => y[0].length - x[0].length);
    }

    _features(text) {
      const f = baseFeatures(text);
      const padded = " " + norm(text) + " ";
      const seen = new Set();
      for (const [a, lid] of this.aliasNorm) if (!seen.has(lid) && padded.includes(a)) { seen.add(lid); f.set("l:" + lid, 1.2); }
      return f;
    }
    _idf(k) { return Math.log((this.N + 1) / ((this.df.get(k) || 0) + 1)) + 1; }
    _vec(f) {
      const v = new Map();
      let n = 0;
      for (const [k, tf] of f) { const x = tf * this._idf(k); v.set(k, x); n += x * x; }
      n = Math.sqrt(n) || 1;
      for (const [k, x] of v) v.set(k, x / n);
      return v;
    }

    retrieve(text) {
      const q = this._vec(this._features(text));
      let best = -1, bi = 0;
      this.vecs.forEach((v, i) => {
        let s = 0;
        const [small, big] = q.size < v.size ? [q, v] : [v, q];
        for (const [k, x] of small) { const y = big.get(k); if (y) s += x * y; }
        s *= this.docs[i].w;
        if (s > best) { best = s; bi = i; }
      });
      return [this.faqs[this.docs[bi].owner], Math.max(best, 0)];
    }

    findPlaces(text, lang) {
      const low = text.toLowerCase();
      const taken = [], hits = [];
      for (const [alias, lid] of this.aliases) {
        const pat = isAscii(alias) ? "(?<![a-z0-9])" + escapeRe(alias) + "(?![a-z0-9])" : escapeRe(alias);
        const re = new RegExp(pat, "g");
        let m;
        while ((m = re.exec(low)) !== null) {
          const s = m.index, e = s + m[0].length;
          if (!taken.some(([ts, te]) => s < te && e > ts)) { taken.push([s, e]); hits.push([s, lid]); }
          if (m[0].length === 0) re.lastIndex++;
        }
      }
      hits.sort((a, b) => a[0] - b[0]);
      let ids = [];
      for (const [, lid] of hits) if (!ids.includes(lid)) ids.push(lid);
      if (lang === "en" && ids.length === 2) {
        for (const [s, lid] of hits) {
          if (/\bfrom(?: the)?\s*$/.test(low.slice(0, s))) { const other = ids.find((i) => i !== lid); ids = [lid, other]; break; }
        }
      }
      if (!ids.length) { // typo tolerance (replaces the embedding fallback of the Python app)
        const words = norm(text).split(" ").filter(Boolean);
        let bestS = 0, bestId = null;
        for (const [alias, lid] of this.aliases) {
          const a = norm(alias), n = a.split(" ").length;
          if (a.length < 5) continue;
          for (let i = 0; i + n <= words.length; i++) {
            const w = words.slice(i, i + n).join(" ");
            const s = w[0] === a[0] ? dice(a, w) : 0;
            if (s > bestS) { bestS = s; bestId = lid; }
          }
        }
        if (bestS >= 0.62) ids = [bestId];
      }
      return ids.slice(0, 2);
    }

    _name(loc, lang) { return (loc.names && loc.names[lang]) || loc.name; }

    _route(ids, lang) {
      const dest = this.locs[ids[ids.length - 1]];
      const origin = ids.length === 2 ? this.locs[ids[0]] : null;
      const s = T[lang];
      const text = origin
        ? s.route_from.replace("{origin}", this._name(origin, lang)).replace("{dest}", this._name(dest, lang))
        : s.route.replace("{dest}", this._name(dest, lang));
      const verified = dest.verified !== false && (!origin || origin.verified !== false);
      return { kind: "route", text, map_url: directionsUrl(dest, origin), verified, score: 1.0 };
    }

    _unknown(lang) {
      const examples = Object.values(this.locs).slice(0, 6).map((l) => l.name).join(", ");
      return { kind: "unknown", text: T[lang].unknown.replace("{examples}", examples), score: 0.0 };
    }

    respond(text, lang) {
      lang = T[lang] ? lang : "en";
      const [faq, score] = this.retrieve(text);
      if (CUES.test(text)) {
        const ids = this.findPlaces(text, lang);
        if (ids.length) return this._route(ids, lang);
        if (score < UNKNOWN_BELOW) return this._unknown(lang);
      }
      if (score >= FAQ_THRESHOLD) {
        return {
          kind: "faq", text: faq.answers[lang] || faq.answers.en, score,
          verified: faq.verified !== false, category: faq.category || "",
        };
      }
      return { kind: "fallback", text: T[lang].fallback, score };
    }
  }

  const api = { Brain, LANGS, GREETING, T, detectTextLang, directionsUrl, CUES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CampusNLP = api;
})(typeof self !== "undefined" ? self : this);
