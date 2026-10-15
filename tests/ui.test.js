const { chromium } = require("/opt/npm-tools/node_modules/playwright");
const path = require("path"), assert = require("assert");
const url = "file://" + path.join(__dirname, "../web/index.html");
const shots = process.argv[2] || "/tmp/claude-0/shots";
require("fs").mkdirSync(shots, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  // fake native bridge, as MainActivity.java provides it
  await page.addInitScript(() => {
    window.__calls = [];
    window.AndroidBridge = {
      openUrl: (u) => window.__calls.push(["openUrl", u]),
      speak: (t, l) => window.__calls.push(["speak", t, l]),
      stopSpeaking: () => window.__calls.push(["stop"]),
      startListening: (l) => window.__calls.push(["listen", l]),
      stopListening: () => window.__calls.push(["stopListen"]),
    };
  });
  await page.goto(url);
  const ask = async (q) => { await page.fill("#input", q); await page.press("#input", "Enter"); };
  const lastBubble = () => page.locator(".msg.assistant .bubble").last().innerText();
  const calls = () => page.evaluate(() => window.__calls);

  assert.match(await lastBubble(), /Hello! I'm Campus Connect/);
  await page.screenshot({ path: shots + "/1-home.png" });

  await ask("What are the library timings?");
  assert.match(await lastBubble(), /लाइब्रेरी|Library|library/i); assert.match(await lastBubble(), /FAQ answer/);
  await page.screenshot({ path: shots + "/2-faq.png" });

  await ask("Route from PRP to Main Block");
  let b = await lastBubble();
  assert.match(b, /Opening directions from Pearl Research Park to Main Building/); assert.match(b, /Open in Google Maps/); assert.match(b, /Sample or placeholder/);
  let c = await calls(); assert.ok(c.some((x) => x[0] === "openUrl" && /origin=12\.9726,79\.165/.test(x[1])), "maps auto-opened");
  await page.screenshot({ path: shots + "/3-route.png" });

  await ask("நூலக நேரம் என்ன?");
  assert.match(await page.locator(".msg.user .meta").last().innerText(), /Text · தமிழ்/);

  // quick question chip
  await page.click("#quick button:nth-child(5)");
  assert.match(await lastBubble(), /Breakfast|breakfast|mess|Mess/);

  // XSS safety
  await ask("<img src=x onerror=window.__pwn=1>");
  assert.strictEqual(await page.evaluate(() => window.__pwn), undefined);

  // settings: speak replies + auto-open off
  await page.click("#menuBtn");
  await page.waitForTimeout(350);
  await page.screenshot({ path: shots + "/4-drawer.png" });
  await page.check("#optSpeak"); await page.uncheck("#optMaps"); await page.selectOption("#optVoiceLang", "ta");
  await page.evaluate(() => window.CCBack());           // back closes drawer
  assert.ok(!(await page.evaluate(() => document.getElementById("drawer").classList.contains("open"))));
  const before = (await calls()).length;
  await ask("Where is the library?");
  c = await calls();
  assert.ok(c.slice(before).some((x) => x[0] === "speak" && x[2] === "en-IN" && !/\*/.test(x[1])), "spoke reply (clean text)");
  assert.ok(!c.slice(before).some((x) => x[0] === "openUrl"), "auto-open off respected");
  await page.click(".maplink >> nth=-1");
  assert.ok((await calls()).some((x) => x[0] === "openUrl" && /google\.com\/maps\/dir/.test(x[1])), "button opens maps");

  // voice flow via native callbacks
  await page.click("#micBtn");
  assert.deepStrictEqual((await calls()).filter((x) => x[0] === "listen").pop(), ["listen", "ta-IN"]);
  await page.evaluate(() => window.onNativeSpeechState("listening"));
  assert.ok(await page.locator("#micBtn.on").count());
  await page.evaluate(() => window.onNativeSpeechResult("நூலக நேரம்"));
  assert.match(await page.locator(".msg.user .meta").last().innerText(), /Voice · தமிழ்/);
  await page.evaluate(() => window.onNativeSpeechError("permission"));
  assert.match(await page.locator("#status").innerText(), /permission/i);
  await page.screenshot({ path: shots + "/5-voice.png" });

  // clear chat
  await page.click("#menuBtn"); await page.click("#clearBtn");
  assert.strictEqual(await page.locator(".msg").count(), 1);

  // layout: no horizontal overflow, composer visible
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bottom: document.getElementById("form").getBoundingClientRect().bottom, vh: innerHeight }));
  assert.ok(o.sw <= o.cw, "no horizontal scroll"); assert.ok(o.bottom <= o.vh, "input on screen");
  assert.deepStrictEqual(errors, [], "console errors: " + errors.join("; "));
  await browser.close();
  console.log("UI tests passed");
})().catch((e) => { console.error("UI FAIL:", e.message); process.exit(1); });
