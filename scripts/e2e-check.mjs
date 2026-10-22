/**
 * End-to-end check of the running application using headless Chrome over the
 * DevTools Protocol (no extra dependencies).
 *
 * Usage:
 *   npm run build
 *   npm run test:e2e
 *
 * The script starts `next start` itself, so the `/api/resolve` route handler is
 * exercised for real. The success path uses a Maps URL that already embeds a
 * Place ID, which needs no network call and is therefore deterministic.
 */
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 4319);
const BASE = `http://127.0.0.1:${PORT}/`;
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9333);

/** Documented Place ID for Google Sydney (developers.google.com). */
const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";
const LONG_URL = `https://www.google.com/maps/search/?api=1&query=Google+Australia&query_place_id=${PLACE_ID}`;
const EXPECTED_REVIEW_URL = `https://search.google.com/local/writereview?placeid=${PLACE_ID}`;
const SHORTLINK = "https://maps.app.goo.gl/HihE1JQdDmzBDCVC8";

let failures = 0;
const warnings = [];

function check(name, condition, detail = "") {
  if (!condition) failures += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "google-chrome",
    "google-chrome-stable",
    "chromium",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.includes(path.sep)) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    try {
      const resolved = execSync(`command -v ${candidate}`, {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
      if (resolved) return resolved;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function waitForHttp(url, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return true;
      }
    } catch {
      /* still starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      for (const handler of this.listeners.get(message.method) ?? []) {
        handler(message.params);
      }
    });
  }

  send(method, params = {}) {
    this.id += 1;
    const id = this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method) {
    return new Promise((resolve) => {
      const handler = (params) => {
        this.listeners.set(
          method,
          (this.listeners.get(method) ?? []).filter((entry) => entry !== handler),
        );
        resolve(params);
      };
      this.listeners.set(method, [...(this.listeners.get(method) ?? []), handler]);
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression: `(() => { ${expression} })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `Evaluation failed: ${result.exceptionDetails.exception?.description ?? expression}`,
      );
    }
    return result.result.value;
  }

  async waitFor(expression, { timeout = 15000, interval = 80 } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.evaluate(expression)) return true;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    return false;
  }
}

async function launchChrome() {
  const chrome = findChrome();
  if (!chrome) {
    throw new Error("Chrome/Chromium tidak ditemukan. Set CHROME_PATH untuk menjalankan E2E.");
  }

  const userDataDir = await mkdtemp(path.join(tmpdir(), "reviewlink-chrome-"));
  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ok = await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`, 1);
    if (ok) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const created = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, {
    method: "PUT",
  }).then((response) => response.json());

  const ws = new WebSocket(created.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  const cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  return {
    cdp,
    async close() {
      ws.close();
      child.kill("SIGKILL");
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

const TYPE_INPUT = (selector, value) => `
  const inputs = [...document.querySelectorAll(${JSON.stringify(selector)})];
  const input = inputs.find((el) => el.offsetParent !== null) ?? inputs[0];
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
`;

const CLICK_TEXT = (text, scope = "body") => `
  const root = document.querySelector(${JSON.stringify(scope)});
  if (!root) return false;
  const target = [...root.querySelectorAll("button, a, [role='tab']")].find((el) =>
    el.textContent.trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}),
  );
  if (!target) return false;
  target.click();
  return true;
`;

const TEXT_OF = (selector) => `
  const element = document.querySelector(${JSON.stringify(selector)});
  return element ? element.textContent.trim() : null;
`;

async function run() {
  if (!existsSync(path.join(process.cwd(), ".next"))) {
    throw new Error(".next tidak ditemukan. Jalankan `npm run build` dulu.");
  }

  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    stdio: "ignore",
    env: { ...process.env, NODE_ENV: "production" },
  });

  const serverReady = await waitForHttp(BASE);
  if (!serverReady) {
    server.kill("SIGKILL");
    throw new Error("Server Next.js tidak siap.");
  }

  const { cdp, close } = await launchChrome();

  const setViewport = (width, height, mobile) =>
    cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    });

  const typeValue = (value) => cdp.evaluate(TYPE_INPUT("#generator form input", value));
  const submit = () =>
    cdp.evaluate(
      `document.querySelector("#generator form button[type='submit']").click(); return true;`,
    );
  const reset = () => cdp.evaluate(CLICK_TEXT("reset", "#generator"));
  const hasResult = () =>
    cdp.evaluate(`return document.querySelector("#generated-review-url") !== null;`);
  const resultValue = () =>
    cdp.evaluate(
      `const el = document.querySelector("#generated-review-url"); return el ? el.value : null;`,
    );
  const outcomeText = async () => {
    await cdp.waitFor(`return document.querySelector("section[aria-label='Hasil pemrosesan link']") !== null;`);
    return cdp.evaluate(TEXT_OF("section[aria-label='Hasil pemrosesan link']"));
  };

  try {
    await setViewport(1280, 900, false);
    const loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: BASE });
    await loaded;

    const bodyLength = await cdp.evaluate("return document.body.innerText.length;");
    check("halaman termuat dari server Next.js", bodyLength > 200, `${bodyLength} karakter`);

    const h1 = await cdp.evaluate(TEXT_OF("h1"));
    check("headline utama tampil", h1 === "Generator Link Google Review Gratis", h1);

    check(
      "input utama adalah link Google Maps (bukan Place ID manual)",
      (await cdp.evaluate(
        `const el = document.querySelector("#generator form input"); return el ? el.name : null;`,
      )) === "maps-url",
    );
    check(
      "tidak ada kolom Place ID manual",
      (await cdp.evaluate(
        `return document.body.innerText.toLowerCase().includes("google place id");`,
      )) === false,
    );

    // Responsive layout
    for (const [width, height, mobile] of [
      [320, 800, true],
      [375, 812, true],
      [768, 900, true],
      [1280, 900, false],
    ]) {
      await setViewport(width, height, mobile);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const overflow = await cdp.evaluate(
        "return document.documentElement.scrollWidth - window.innerWidth;",
      );
      check(`tanpa overflow horizontal (${width}px)`, overflow <= 0, `${overflow}px`);
    }
    await setViewport(1280, 900, false);

    await cdp.evaluate(`
      window.__copied = null;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (text) => { window.__copied = text; } },
      });
      return true;
    `);

    // --- Success path: Maps URL that already carries a Place ID ------------
    check("input menerima link Google Maps", await typeValue(LONG_URL));
    await submit();
    check(
      "link ulasan dihasilkan dari URL Maps ber-Place ID",
      await cdp.waitFor(`return document.querySelector("#generated-review-url") !== null;`),
    );
    check("URL hasil tepat", (await resultValue()) === EXPECTED_REVIEW_URL, String(await resultValue()));

    const toastText = await cdp.evaluate(TEXT_OF("[data-sonner-toast]"));
    check("notifikasi sukses tampil", (toastText ?? "").includes("berhasil dibuat"), toastText ?? "");

    check("tombol Salin Link ada", await cdp.evaluate(CLICK_TEXT("salin link")));
    await cdp.waitFor("return window.__copied !== null;", { timeout: 5000 });
    check(
      "clipboard menerima URL ulasan",
      (await cdp.evaluate("return window.__copied;")) === EXPECTED_REVIEW_URL,
    );

    const anchors = await cdp.evaluate(`
      return [...document.querySelectorAll("a")].map((a) => ({
        href: a.getAttribute("href"),
        target: a.getAttribute("target"),
        rel: a.getAttribute("rel") ?? "",
        text: a.textContent.trim(),
      }));
    `);
    const openLink = anchors.find((anchor) => anchor.text.includes("Buka Link"));
    check(
      "tombol Buka Link menuju URL ulasan dengan rel aman",
      openLink?.href === EXPECTED_REVIEW_URL &&
        openLink?.target === "_blank" &&
        openLink.rel.includes("noopener"),
      JSON.stringify(openLink),
    );
    check(
      "hanya tombol Salin dan Buka yang ditampilkan pada hasil",
      anchors.filter((a) => a.text.includes("WhatsApp")).length === 0,
    );

    // --- Invalid input -----------------------------------------------------
    await reset();
    await submit();
    check(
      "input kosong ditolak",
      await cdp.waitFor(`return document.querySelector("#generator form [role='alert']") !== null;`),
    );
    check(
      "pesan input kosong jelas",
      ((await cdp.evaluate(TEXT_OF("#generator form [role='alert']"))) ?? "").includes("belum diisi"),
    );
    check("tidak ada hasil untuk input kosong", (await hasResult()) === false);

    await typeValue("https://example.com/bukan-google");
    await submit();
    const foreignText = await outcomeText();
    check(
      "domain non-Google ditolak",
      (foreignText ?? "").includes("belum didukung") && (await hasResult()) === false,
      (foreignText ?? "").slice(0, 60),
    );

    await typeValue("javascript:alert(1)");
    await submit();
    const maliciousText = await outcomeText();
    check(
      "skema javascript: ditolak tanpa link",
      (maliciousText ?? "").includes("http") && (await hasResult()) === false,
    );

    await reset();
    await typeValue("https://search.google.com/local/writereview");
    await submit();
    const missingPlaceIdText = await outcomeText();
    check(
      "writereview tanpa Place ID ditolak",
      (missingPlaceIdText ?? "").includes("Place ID") && (await hasResult()) === false,
    );

    // --- Short share link: never fabricate a review link --------------------
    await reset();
    await typeValue(SHORTLINK);
    await submit();
    await cdp.waitFor(
      `return document.querySelector("section[aria-label='Hasil pemrosesan link']") !== null ||
              document.querySelector("#generated-review-url") !== null;`,
      { timeout: 20000 },
    );
    const shortResult = await cdp.evaluate(
      `return document.querySelector("#generated-review-url") ? document.querySelector("#generated-review-url").value : null;`,
    );
    const shortOutcome = await cdp.evaluate(
      TEXT_OF("section[aria-label='Hasil pemrosesan link']"),
    );

    if (shortResult !== null) {
      warnings.push("Link pendek menghasilkan link ulasan: Place ID tersedia di URL tujuan.");
      check("link pendek menghasilkan URL ber-Place ID", shortResult.includes("placeid="), shortResult);
    } else {
      check(
        "link pendek tidak menghasilkan link ulasan tanpa Place ID resmi",
        shortResult === null,
      );
      const explained =
        (shortOutcome ?? "").includes("Place ID") ||
        (shortOutcome ?? "").includes("tidak dapat dibuka");
      check(
        "hasil link pendek dijelaskan secara jujur",
        explained,
        (shortOutcome ?? "").replace(/\s+/g, " ").slice(0, 120),
      );
    }

    // --- FAQ ---------------------------------------------------------------
    const faqClicked = await cdp.evaluate(`
      const trigger = document.querySelector("#faq [data-slot='accordion-trigger']");
      if (!trigger) return false;
      trigger.click();
      return true;
    `);
    await new Promise((resolve) => setTimeout(resolve, 400));
    check(
      "FAQ accordion dapat dibuka",
      faqClicked &&
        (await cdp.evaluate(
          `const panel = document.querySelector("#faq [data-slot='accordion-content']"); return panel ? panel.getBoundingClientRect().height > 0 : false;`,
        )),
    );

    // --- Mobile interaction ------------------------------------------------
    await setViewport(320, 800, true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await reset();
    check("input dapat diisi di 320px", await typeValue(LONG_URL));
    await submit();
    check(
      "link dibuat di 320px",
      await cdp.waitFor(`return document.querySelector("#generated-review-url") !== null;`),
    );
    check(
      "tanpa overflow horizontal setelah membuat link (320px)",
      (await cdp.evaluate(
        "return document.documentElement.scrollWidth - window.innerWidth;",
      )) <= 0,
    );
  } finally {
    await close();
    server.kill("SIGKILL");
  }

  for (const warning of warnings) console.log(`WARN  ${warning}`);
  console.log(`\n${failures === 0 ? "SEMUA E2E LULUS" : `${failures} E2E GAGAL`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(`E2E error: ${error.message}`);
  process.exit(1);
});
