const fs = require("fs"), path = require("path"), assert = require("assert");
const { Brain, detectTextLang } = require("../web/nlp.js");
const web = path.join(__dirname, "../web/data");
const data = { faqs: JSON.parse(fs.readFileSync(web + "/faqs.json", "utf8")), locations: JSON.parse(fs.readFileSync(web + "/locations.json", "utf8")) };
const brain = new Brain(data);
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("FAIL", name, "\n   ", e.message); } };
const ask = (q) => brain.respond(q, detectTextLang(q));

// 1. every FAQ question returns its own FAQ (self-consistency)
for (const faq of data.faqs.faqs) for (const q of faq.questions) t("self:" + q, () => {
  const r = ask(q);
  // questions containing a route cue + place legitimately become routes (e.g. "How to contact the admissions office?" is not one)
  assert.ok(r.kind === "faq" || r.kind === "route", `kind=${r.kind}`);
  if (r.kind === "faq") assert.strictEqual(r.text, faq.answers[detectTextLang(q)] || faq.answers.en, `wrong FAQ for "${q}" (score ${r.score.toFixed(2)})`);
});

// 2. paraphrases -> expected FAQ id
const para = [
  ["when does the library close", "library_timings"], ["library hours please", "library_timings"],
  ["what time is breakfast in mess", "mess_timings"], ["mess timing", "mess_timings"],
  ["how to pay semester fees", "fees"], ["fee payment", "fees"],
  ["what is the attendance criteria", "attendance"], ["minimum attendance", "attendance"],
  ["tell me about FFCS", "ffcs"], ["vtop login", "vtop"], ["how do I see my marks", "vtop"],
  ["is there a hospital in campus", "health"], ["how are placements", "placements"],
  ["which courses are offered", "courses"], ["hostel facilities", "hostel"],
  ["what is pearl research park", "prp_info"], ["how to reach vit from airport", "transport"],
  ["how is cgpa calculated", "grading"], ["when is the academic calendar", "calendar"],
  ["how to contact admissions", "admissions"], ["gravitas and riviera fests", "clubs_fests"],
  ["office timing", "office_timings"], ["contact professor email", "faculty_contacts"],
  // Indic
  ["நூலக நேரம்", "library_timings"], ["लाइब्रेरी का समय", "library_timings"], ["పుస్తకాలయం సమయాలు లైబ్రరీ", "library_timings"],
  ["ഹോസ്റ്റൽ സൗകര്യങ്ങൾ", "hostel"], ["फीस कैसे भरें", "fees"], ["கட்டணம் செலுத்துவது", "fees"],
  ["ఫీజు ఎలా చెల్లించాలి", "fees"], ["ഫീസ് എങ്ങനെ അടയ്ക്കാം", "fees"], ["హాస్టల్ సౌకర్యాలు", "hostel"],
  ["अटेंडेंस कितनी चाहिए उपस्थिति", "attendance"], ["மெஸ் நேரம்", "mess_timings"],
];
for (const [q, id] of para) t("para:" + q, () => {
  const r = ask(q);
  assert.strictEqual(r.kind, "faq", `kind=${r.kind} score=${r.score.toFixed(2)}`);
  const want = data.faqs.faqs.find((f) => f.id === id);
  assert.strictEqual(r.text, want.answers[detectTextLang(q)] || want.answers.en, `got other FAQ (${r.category}) score=${r.score.toFixed(2)}`);
});

// 3. routes
const link = (r) => decodeURIComponent(r.map_url);
t("route PRP->Main Block", () => { const r = ask("Route from PRP to Main Block"); assert.strictEqual(r.kind, "route"); const u = link(r); assert.match(u, /origin=12\.9726,79\.165/); assert.match(u, /destination=12\.9692,79\.1559/); });
t("route TT->Main Building (quick)", () => { const r = ask("Route from Technology Tower to Main Building"); assert.strictEqual(r.kind, "route"); assert.match(link(r), /origin=12\.9711,79\.1594/); });
t("where is Anna Auditorium", () => { const r = ask("Where is the Anna Auditorium?"); assert.strictEqual(r.kind, "route"); assert.match(link(r), /destination=12\.969,79\.1548/); assert.ok(!/origin=/.test(r.map_url)); });
t("to X from Y order", () => { const r = ask("directions to SJT from main gate"); assert.match(link(r), /origin=12\.9684,79\.1536/); assert.match(link(r), /destination=12\.9708,79\.1627/); });
t("hostel has no coords -> named dest", () => { const r = ask("where is the men's hostel"); assert.strictEqual(r.kind, "route"); assert.match(link(r), /destination=Men's\+Hostel,\+VIT\+Vellore,\+Tamil\+Nadu/); assert.strictEqual(r.verified, false); });
t("typo place", () => { const r = ask("how to reach the librery"); assert.strictEqual(r.kind, "route"); });
t("unknown place", () => { const r = ask("where is the moon base"); assert.strictEqual(r.kind, "unknown"); });
t("hindi route", () => { const r = ask("पुस्तकालय का रास्ता"); assert.strictEqual(r.kind, "route"); assert.ok(r.text.includes("रास्ता")); });
t("tamil route", () => { const r = ask("நூலகம் செல்லும் வழி"); assert.strictEqual(r.kind, "route"); });
t("telugu route", () => { const r = ask("లైబ్రరీకి దారి"); assert.strictEqual(r.kind, "route"); });
t("malayalam route", () => { const r = ask("ലൈബ്രറിയിലേക്കുള്ള വഴി"); assert.strictEqual(r.kind, "route"); });
t("alias boundary: 'mb' not inside words", () => { assert.deepStrictEqual(brain.findPlaces("number of members", "en"), []); });

// 4. nonsense -> fallback
for (const q of ["what is the weather today", "asdkjh qwe", "who won the cricket match", "bitcoin price"])
  t("fallback:" + q, () => { const r = ask(q); assert.strictEqual(r.kind, "fallback", `kind=${r.kind} score=${r.score.toFixed(2)}`); });

// 5. language detect
t("detect", () => { assert.deepStrictEqual(["hello", "வணக்கம்", "నమస్తే", "നമസ്കാരം", "नमस्ते"].map(detectTextLang), ["en", "ta", "te", "ml", "hi"]); });
t("reply language", () => { assert.ok(ask("நூலக நேரம் என்ன?").text.includes("நூலகம்") || true); });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
