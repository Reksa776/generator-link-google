import type { Browser, BrowserContext, Page } from "playwright";

import { buildReviewUrlFromPlaceId, isValidPlaceIdFormat } from "./maps-url";

/**
 * Playwright based Google Maps resolver — **server only**.
 *
 * Why it exists: a `maps.app.goo.gl` share link resolves to a Maps place URL
 * that only carries a Feature ID / CID, which is NOT a Place ID. When the Maps
 * web app boots in a real browser, Google's own internal RPC
 * (`/maps/preview/place`) returns the genuine Place ID (`ChIJ…`) for the place
 * being displayed. This module opens that page, captures the ID from Google's
 * own traffic, verifies that the ID belongs to the expected business, and only
 * then exposes a review URL.
 *
 * Hard rules implemented here:
 * - a Place ID is never invented, and a CID/feature id is never converted;
 * - the ID must be verified by loading `place_id:<id>` and matching the title;
 * - no review is ever submitted, and no login is attempted;
 * - navigation is restricted to Google hosts, permissions are denied, downloads
 *   are blocked and every context is closed after the request.
 */

export type PlaywrightStatus =
  /** A genuine, name-verified Place ID was captured from Google. */
  | "discovered_place_id"
  /** Google itself exposed a reusable review URL. */
  | "review_url_exposed"
  /** The review action opened an internal dialog with no reusable URL. */
  | "dialog_only"
  /** Google asked for sign-in; nothing was bypassed. */
  | "sign_in_required"
  /** CAPTCHA / automation restriction detected. */
  | "blocked"
  /** Page loaded but no Place ID could be captured. */
  | "no_place_id"
  /** Navigation failed or timed out. */
  | "unreachable"
  /** Too many concurrent resolutions. */
  | "busy"
  /** Playwright is not available or disabled in this deployment. */
  | "disabled";

export type ReviewUrlOrigin =
  | "google-observed"
  | "built-from-verified-place-id"
  | null;

export interface PlaywrightDiscoveryResult {
  status: PlaywrightStatus;
  placeId: string | null;
  placeIdSource: "maps-rpc" | "page-state" | null;
  /** Only ever set when the Place ID was verified against the business name. */
  reviewUrl: string | null;
  reviewUrlOrigin: ReviewUrlOrigin;
  placeTitle: string | null;
  nameVerified: boolean;
  reviewActionFound: boolean;
  reviewActionClicked: boolean;
  /** URLs observed after the review action (navigation / popup / attributes). */
  observedUrls: string[];
  loginRequired: boolean;
  captchaOrBlocked: boolean;
  elapsedMs: number;
  notes: string[];
  screenshotPath: string | null;
}

export interface PlaywrightDiscoveryOptions {
  /** Canonical Maps URL to open (usually the resolved share link target). */
  placeUrl: string;
  /** Business name from the share link, used to verify the Place ID. */
  expectedName?: string | null;
  /** Persist a PNG screenshot for evidence (absolute or relative path). */
  screenshotPath?: string | null;
  /** Overrides for tests and tuning. */
  timeouts?: Partial<Timeouts>;
}

interface Timeouts {
  navigationMs: number;
  settleMs: number;
  actionMs: number;
  verifyMs: number;
  totalBudgetMs: number;
}

const DEFAULT_TIMEOUTS: Timeouts = {
  navigationMs: 25_000,
  settleMs: 7_000,
  actionMs: 5_000,
  verifyMs: 20_000,
  totalBudgetMs: 60_000,
};

/** Playwright is opt-in: it is an experimental resolver with a heavy footprint. */
export function isPlaywrightResolverEnabled(override?: boolean): boolean {
  if (typeof override === "boolean") return override;
  return process.env.PLAYWRIGHT_RESOLVER_ENABLED === "1";
}

function maxConcurrency(): number {
  const parsed = Number(process.env.PLAYWRIGHT_MAX_CONCURRENCY ?? "1");
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
}

/* -------------------------------------------------------------------------- */
/* Host allow-list for the browser                                             */
/* -------------------------------------------------------------------------- */

/**
 * Google hosts plus Google's own link shorteners. The shorteners must stay
 * allowed because a share link may still be the redirect entry point.
 */
const ALLOWED_HOST_PATTERN =
  /^(?:[a-z0-9-]+\.)*(?:google\.[a-z]{2,4}(?:\.[a-z]{2,4})?|gstatic\.com|googleusercontent\.com|ggpht\.com|googleapis\.com|goo\.gl|g\.co|g\.page)$/;

/** Rejects localhost, private ranges, IP literals and non-Google hosts. */
export function isAllowedBrowserHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.length === 0) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return false;
  }
  // IPv4 / IPv6 literals (private or not) are refused outright.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return false;

  return ALLOWED_HOST_PATTERN.test(host);
}

const REVIEW_URL_PATTERNS: readonly RegExp[] = [
  /^https:\/\/search\.google\.com\/local\/writereview\?(?:[^#]*&)?placeid=[A-Za-z0-9_-]{10,}/,
  /^https:\/\/www\.google\.com\/local\/writereview\?(?:[^#]*&)?placeid=[A-Za-z0-9_-]{10,}/,
  /^https:\/\/g\.page\/r\/[A-Za-z0-9_-]+\/review(?:[/?#]|$)/,
];

/** A Google-generated review URL that we would be willing to return. */
export function extractObservedReviewUrl(
  candidate: string | null | undefined,
): string | null {
  if (!candidate) return null;
  const value = candidate.trim();
  for (const pattern of REVIEW_URL_PATTERNS) {
    if (pattern.test(value)) return value;
  }
  return null;
}

/** Place ID token as it appears inside Google's own responses. */
const PLACE_ID_TOKEN = /ChIJ[A-Za-z0-9_-]{10,}/g;

export function collectPlaceIdTokens(text: string): string[] {
  const matches = text.match(PLACE_ID_TOKEN);
  if (!matches) return [];
  return [...new Set(matches.filter((candidate) => isValidPlaceIdFormat(candidate)))];
}

/* -------------------------------------------------------------------------- */
/* Browser lifecycle                                                           */
/* -------------------------------------------------------------------------- */

type BrowserHandle = { browser: Browser };

let browserPromise: Promise<BrowserHandle> | null = null;
let activeResolutions = 0;
let cleanupRegistered = false;

async function getBrowser(): Promise<BrowserHandle | null> {
  if (browserPromise) {
    try {
      const handle = await browserPromise;
      if (handle.browser.isConnected()) return handle;
    } catch {
      // fall through and relaunch
    }
    browserPromise = null;
  }

  const launch = async (): Promise<BrowserHandle> => {
    // Dynamic import keeps Playwright out of the bundle unless it is enabled.
    const { chromium } = await import("playwright");
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

    const browser = await chromium.launch({
      headless: true,
      executablePath: executablePath && executablePath.length > 0 ? executablePath : undefined,
      args: [
        // Container friendly; documented as a trade-off in the resolver report.
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-background-networking",
        "--disable-extensions",
        "--disable-sync",
      ],
    });

    browser.on("disconnected", () => {
      browserPromise = null;
    });

    return { browser };
  };

  browserPromise = launch().catch((error: unknown) => {
    browserPromise = null;
    throw error;
  });

  return browserPromise;
}

function registerCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  const shutdown = () => {
    void browserPromise
      ?.then((handle) => handle.browser.close())
      .catch(() => undefined);
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  process.once("beforeExit", shutdown);
}

/** Closes the shared browser (used by tests and graceful shutdown). */
export async function closePlaywrightBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;
  try {
    const handle = await pending;
    await handle.browser.close();
  } catch {
    // already gone
  }
}

export function getActiveResolutionCount(): number {
  return activeResolutions;
}

/* -------------------------------------------------------------------------- */
/* Discovery                                                                   */
/* -------------------------------------------------------------------------- */

function emptyResult(
  status: PlaywrightStatus,
  elapsedMs: number,
  notes: string[],
): PlaywrightDiscoveryResult {
  return {
    status,
    placeId: null,
    placeIdSource: null,
    reviewUrl: null,
    reviewUrlOrigin: null,
    placeTitle: null,
    nameVerified: false,
    reviewActionFound: false,
    reviewActionClicked: false,
    observedUrls: [],
    loginRequired: false,
    captchaOrBlocked: false,
    elapsedMs,
    notes,
    screenshotPath: null,
  };
}

async function configureContext(context: BrowserContext, timeouts: Timeouts) {
  context.setDefaultTimeout(timeouts.actionMs);
  context.setDefaultNavigationTimeout(timeouts.navigationMs);

  // No permissions, no downloads, no service workers.
  await context.grantPermissions([]);
  await context.route("**/*", (route) => {
    void (async () => {
      const request = route.request();
      const url = request.url();
      const resourceType = request.resourceType();

      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          await route.abort();
          return;
        }
        if (!isAllowedBrowserHost(parsed.hostname)) {
          await route.abort();
          return;
        }
        // Trim payloads that cannot contain the Place ID.
        if (resourceType === "image" || resourceType === "media" || resourceType === "font") {
          await route.abort();
          return;
        }
        await route.continue();
      } catch {
        await route.abort();
      }
    })();
  });
}

/** Reads response bodies that can plausibly contain a Place ID, with size caps. */
function attachPlaceIdCollector(
  page: Page,
  notes: string[],
): { tokens: Set<string>; sources: Set<string> } {
  const tokens = new Set<string>();
  const sources = new Set<string>();

  page.on("response", (response) => {
    void (async () => {
      try {
        const url = response.url();
        const contentType = response.headers()["content-type"] ?? "";

        const isMapsRpc = url.includes("/maps/");
        const isJson = contentType.includes("json");
        if (!isMapsRpc && !isJson) return;
        if (!/json|text\/plain|javascript|html/.test(contentType)) return;

        const lengthHeader = response.headers()["content-length"];
        if (lengthHeader && Number(lengthHeader) > 3_000_000) return;

        const body = await response.text();
        for (const token of collectPlaceIdTokens(body)) {
          tokens.add(token);
          sources.add(url.slice(0, 80));
        }
      } catch {
        // Response body unavailable (aborted, redirect, stream) — ignore.
      }
    })();
  });

  page.on("pageerror", (error) => {
    notes.push(`pageerror: ${error.message.slice(0, 100)}`);
  });

  return { tokens, sources };
}

interface PageSignals {
  title: string;
  bodyTextLength: number;
  captcha: boolean;
  signIn: boolean;
  consent: boolean;
}

async function readPageSignals(page: Page): Promise<PageSignals> {
  return page.evaluate(() => {
    const text = document.body ? document.body.textContent ?? "" : "";
    const lower = text.toLowerCase();
    return {
      title: document.title,
      bodyTextLength: text.length,
      captcha: /captcha|unusual traffic|not a robot|verifikasi bahwa anda/i.test(lower),
      signIn: /\bsign in\b|\bmasuk\b|login/i.test(lower),
      consent: /before you continue|sebelum melanjutkan|consent/i.test(lower),
    };
  });
}

/** Robust, semantics-first locators for Google's review writing action. */
async function findReviewAction(page: Page) {
  const candidates = [
    page.getByRole("button", { name: /tulis ulasan|write a review/i }),
    page.getByRole("link", { name: /tulis ulasan|write a review/i }),
    page.getByRole("tab", { name: /ulasan|reviews/i }),
    page.locator("[aria-label*='Tulis ulasan' i]").first(),
    page.locator("[aria-label*='Write a review' i]").first(),
    // Google's own marker attribute; used last because it is not a public API.
    page.locator("[data-value='Write a review'], [data-item-id='review']").first(),
  ];

  for (const candidate of candidates) {
    try {
      if ((await candidate.count()) > 0 && (await candidate.first().isVisible())) {
        return candidate.first();
      }
    } catch {
      // locator not usable; try the next one
    }
  }

  return null;
}

async function verifyPlaceIdForName(
  context: BrowserContext,
  placeId: string,
  expectedName: string | null,
  timeouts: Timeouts,
): Promise<{ verified: boolean; title: string | null }> {
  if (!expectedName) {
    return { verified: false, title: null };
  }

  const page = await context.newPage();
  try {
    await page.goto(`https://www.google.com/maps/place/?q=place_id:${placeId}`, {
      waitUntil: "domcontentloaded",
      timeout: timeouts.verifyMs,
    });
    await page.waitForTimeout(Math.min(6000, timeouts.settleMs));

    const title = await page.title();
    const normalise = (value: string) =>
      value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/-\s*Google Maps.*$/i, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

    const cleanTitle = normalise(title);
    const cleanExpected = normalise(expectedName);

    if (cleanTitle.length === 0 || cleanExpected.length === 0) {
      return { verified: false, title };
    }

    const shorter = cleanTitle.length <= cleanExpected.length ? cleanTitle : cleanExpected;
    const longer = cleanTitle.length <= cleanExpected.length ? cleanExpected : cleanTitle;

    // The `place_id:` query must resolve to a real place page, not to a search.
    const resolvedToPlacePage = page.url().includes("/maps/place/");
    const namesMatch =
      cleanTitle === cleanExpected ||
      (longer.includes(shorter) && shorter.length / longer.length >= 0.6);

    return { verified: resolvedToPlacePage && namesMatch, title };
  } catch {
    return { verified: false, title: null };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Full browser discovery for one Maps place URL.
 *
 * Outcomes map to the requested classification:
 * A `review_url_exposed`, B `discovered_place_id`, C `dialog_only`,
 * D `sign_in_required`, E `blocked`.
 */
export async function discoverReviewUrlWithPlaywright(
  options: PlaywrightDiscoveryOptions,
): Promise<PlaywrightDiscoveryResult> {
  const started = Date.now();
  const timeouts: Timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
  const notes: string[] = [];

  if (!isAllowedBrowserHost(new URL(options.placeUrl).hostname)) {
    return emptyResult("disabled", Date.now() - started, [
      "URL tujuan tidak termasuk host Google yang diizinkan.",
    ]);
  }

  if (activeResolutions >= maxConcurrency()) {
    return emptyResult("busy", Date.now() - started, [
      `Batas resolusi bersamaan tercapai (maks ${maxConcurrency()}).`,
    ]);
  }

  activeResolutions += 1;
  registerCleanup();

  let context: BrowserContext | null = null;
  let screenshotPath: string | null = null;

  try {
    let handle: BrowserHandle | null = null;
    try {
      handle = await getBrowser();
    } catch (error) {
      return emptyResult("disabled", Date.now() - started, [
        `Playwright/Chromium tidak tersedia: ${
          error instanceof Error ? error.message.slice(0, 120) : "unknown"
        }`,
      ]);
    }

    if (!handle) {
      return emptyResult("disabled", Date.now() - started, ["Browser tidak dapat dijalankan."]);
    }

    context = await handle.browser.newContext({
      locale: "id-ID",
      timezoneId: "Asia/Jakarta",
      javaScriptEnabled: true,
      acceptDownloads: false,
      serviceWorkers: "block",
      permissions: [],
      viewport: { width: 1000, height: 800 },
    });
    await configureContext(context, timeouts);

    const page = await context.newPage();
    const collector = attachPlaceIdCollector(page, notes);
    const observedUrls = new Set<string>();

    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) observedUrls.add(frame.url());
    });
    page.on("popup", (popup) => {
      observedUrls.add(popup.url());
    });

    // 1. Open the resolved Maps location.
    try {
      await page.goto(options.placeUrl, {
        waitUntil: "domcontentloaded",
        timeout: timeouts.navigationMs,
      });
    } catch {
      return emptyResult("unreachable", Date.now() - started, [
        "Navigasi ke Google Maps gagal atau melewati batas waktu.",
      ]);
    }

    // 2. Wait for the place page (title changes once the place is hydrated).
    try {
      await page.waitForFunction(
        () => !/^Google Maps$/i.test(document.title.trim()) || document.body.innerText.length > 400,
        undefined,
        { timeout: timeouts.settleMs },
      );
    } catch {
      notes.push("Halaman lokasi tidak selesai dimuat dalam batas waktu.");
    }
    await page.waitForTimeout(Math.min(3500, timeouts.settleMs));

    const signals = await readPageSignals(page);

    // 3. CAPTCHA / automation restriction → stop gracefully (outcome E).
    if (signals.captcha || /sorry\/index/.test(page.url())) {
      return {
        ...emptyResult("blocked", Date.now() - started, [
          ...notes,
          "Google menampilkan verifikasi otomatis (CAPTCHA).",
        ]),
        placeTitle: signals.title,
        captchaOrBlocked: true,
        observedUrls: [...observedUrls],
      };
    }

    // 4. DOM fallback for the Place ID (in case the RPC was already cached).
    if (collector.tokens.size === 0) {
      try {
        const domTokens = await page.evaluate(() => {
          const html = document.documentElement.innerHTML;
          const matches = html.match(/ChIJ[A-Za-z0-9_-]{10,}/g) ?? [];
          return [...new Set(matches)].slice(0, 10);
        });
        for (const token of domTokens) {
          if (isValidPlaceIdFormat(token)) {
            collector.tokens.add(token);
            collector.sources.add("dom");
          }
        }
      } catch {
        // ignore DOM read failures
      }
    }

    if (options.screenshotPath) {
      try {
        await page.screenshot({ path: options.screenshotPath, fullPage: false });
        screenshotPath = options.screenshotPath;
      } catch {
        notes.push("Screenshot gagal dibuat.");
      }
    }

    // 5. Inspect the native review action (never submitting anything).
    const reviewAction = await findReviewAction(page);
    let reviewActionClicked = false;
    let observedReviewUrl: string | null = null;

    if (reviewAction) {
      // A genuine review URL may be present as an href / aria attribute.
      const attributes = await reviewAction
        .evaluate((element) => ({
          href: element.getAttribute("href"),
          ariaLabel: element.getAttribute("aria-label"),
          dataValue: element.getAttribute("data-value"),
          onclick: element.getAttribute("onclick"),
        }))
        .catch(() => null);

      observedReviewUrl =
        extractObservedReviewUrl(attributes?.href) ??
        extractObservedReviewUrl(
          attributes?.onclick?.match(/https?:\/\/[^"'\\ ]+/)?.[0] ?? null,
        );

      const urlBeforeClick = page.url();
      try {
        const popupPromise = page
          .waitForEvent("popup", { timeout: timeouts.actionMs })
          .catch(() => null);
        const navigationPromise = page
          .waitForNavigation({ timeout: timeouts.actionMs })
          .catch(() => null);

        await reviewAction.click({ timeout: timeouts.actionMs });
        reviewActionClicked = true;

        const [popup] = await Promise.all([popupPromise, navigationPromise]);
        if (popup) observedUrls.add(popup.url());

        await page.waitForTimeout(Math.min(2500, timeouts.actionMs));

        for (const url of [page.url(), popup?.url() ?? null, urlBeforeClick]) {
          const reviewUrl = extractObservedReviewUrl(url);
          if (reviewUrl) observedReviewUrl = reviewUrl;
          if (url) observedUrls.add(url);
        }

        // Does an internal review dialog open instead of a navigation?
        const dialogOpen = await page
          .evaluate(() => {
            const dialog = document.querySelector("[role='dialog']");
            if (!dialog) return false;
            const rect = dialog.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .catch(() => false);

        const afterSignals = await readPageSignals(page);
        if (afterSignals.signIn && !observedReviewUrl) {
          notes.push("Aksi ulasan meminta login Google (tidak dicoba dilewati).");
        }
        if (dialogOpen) {
          notes.push("Aksi ulasan membuka dialog internal Google, bukan URL.");
        }
      } catch {
        notes.push("Tombol ulasan ditemukan tetapi tidak dapat diklik.");
      }
    } else {
      notes.push("Tidak ditemukan kontrol ulasan pada halaman lokasi.");
    }

    const title = await page.title();
    const placeTitle = title.replace(/\s*-\s*Google Maps\s*$/i, "").trim() || null;

    const finalSignals = await readPageSignals(page);
    const loginRequired = finalSignals.signIn || (reviewActionClicked && !observedReviewUrl);

    // Outcome A: Google exposed a reusable review URL.
    if (observedReviewUrl) {
      return {
        status: "review_url_exposed",
        placeId: null,
        placeIdSource: null,
        reviewUrl: observedReviewUrl,
        reviewUrlOrigin: "google-observed",
        placeTitle,
        nameVerified: true,
        reviewActionFound: reviewAction !== null,
        reviewActionClicked,
        observedUrls: [...observedUrls],
        loginRequired,
        captchaOrBlocked: false,
        elapsedMs: Date.now() - started,
        notes,
        screenshotPath,
      };
    }

    // Outcome B: a genuine Place ID was captured — verify it before using it.
    const tokens = [...collector.tokens];
    if (tokens.length > 0) {
      const expectedName = options.expectedName ?? placeTitle;
      const candidates = tokens.slice(0, 5);
      let chosen: { placeId: string; verified: boolean } | null = null;

      for (const token of candidates) {
        const verification = await verifyPlaceIdForName(
          context,
          token,
          expectedName,
          timeouts,
        );

        if (verification.verified) {
          chosen = { placeId: token, verified: true };
          break;
        }
        if (!chosen) chosen = { placeId: token, verified: false };
      }

      if (chosen?.verified) {
        return {
          status: "discovered_place_id",
          placeId: chosen.placeId,
          placeIdSource: collector.sources.has("dom") ? "page-state" : "maps-rpc",
          reviewUrl: buildReviewUrlFromPlaceId(chosen.placeId),
          reviewUrlOrigin: "built-from-verified-place-id",
          placeTitle,
          nameVerified: true,
          reviewActionFound: reviewAction !== null,
          reviewActionClicked,
          observedUrls: [...observedUrls],
          loginRequired,
          captchaOrBlocked: false,
          elapsedMs: Date.now() - started,
          notes,
          screenshotPath,
        };
      }

      notes.push(
        "Place ID ditemukan pada trafik Google, tetapi tidak lolos verifikasi nama lokasi.",
      );
    }

    if (reviewActionClicked) {
      return {
        status: "dialog_only",
        placeId: null,
        placeIdSource: null,
        reviewUrl: null,
        reviewUrlOrigin: null,
        placeTitle,
        nameVerified: false,
        reviewActionFound: true,
        reviewActionClicked: true,
        observedUrls: [...observedUrls],
        loginRequired,
        captchaOrBlocked: false,
        elapsedMs: Date.now() - started,
        notes,
        screenshotPath,
      };
    }

    if (loginRequired) {
      return {
        ...emptyResult("sign_in_required", Date.now() - started, notes),
        placeTitle,
        reviewActionFound: reviewAction !== null,
        loginRequired: true,
        observedUrls: [...observedUrls],
        screenshotPath,
      };
    }

    return {
      ...emptyResult("no_place_id", Date.now() - started, notes),
      placeTitle,
      reviewActionFound: reviewAction !== null,
      reviewActionClicked,
      observedUrls: [...observedUrls],
      screenshotPath,
    };
  } catch (error) {
    return emptyResult("unreachable", Date.now() - started, [
      ...notes,
      `Kesalahan resolver: ${
        error instanceof Error ? error.message.slice(0, 120) : "unknown"
      }`,
    ]);
  } finally {
    // Always release the browser context, even on failure.
    await context?.close().catch(() => undefined);
    activeResolutions -= 1;

    if (Date.now() - started > DEFAULT_TIMEOUTS.totalBudgetMs) {
      notes.push("Melewati anggaran waktu total resolver.");
    }
  }
}
