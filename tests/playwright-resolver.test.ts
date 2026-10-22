import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collectPlaceIdTokens,
  extractObservedReviewUrl,
  isAllowedBrowserHost,
  isPlaywrightResolverEnabled,
  type PlaywrightDiscoveryResult,
} from "../lib/playwright-resolver";
import { resolveMapsLink } from "../lib/resolve";

const SHORTLINK = "https://maps.app.goo.gl/HihE1JQdDmzBDCVC8";
const RESOLVED_ONLY_FTID =
  "https://www.google.com/maps/place/Toko+Kopi/@-6.7353126,108.5161525,14z/data=!4m6!3m5!1s0x2e6f1dfa0caae141:0x3b66fb4b842e1140!8m2!3d-6.7353126!4d108.5336626!16s%2Fg%2F121n4817";
const PLACE_ID = "ChIJQeGqDPodby4RQBEuhEv7Zjs";
const EXPECTED_REVIEW_URL = `https://search.google.com/local/writereview?placeid=${PLACE_ID}`;

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

function html(url: string): Response {
  const response = new Response("<html></html>", { status: 200 });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

/** Fetch stub that only performs the share-link hop. */
const shortlinkFetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return url === SHORTLINK ? redirect(RESOLVED_ONLY_FTID) : html(RESOLVED_ONLY_FTID);
}) as typeof fetch;

function discovery(
  overrides: Partial<PlaywrightDiscoveryResult>,
): PlaywrightDiscoveryResult {
  return {
    status: "no_place_id",
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
    elapsedMs: 1,
    notes: [],
    screenshotPath: null,
    ...overrides,
  };
}

describe("Playwright resolver guards", () => {
  it("allows only Google hosts for browser navigation", () => {
    for (const host of [
      "www.google.com",
      "google.com",
      "maps.google.com",
      "maps.app.goo.gl",
      "google.co.id",
      "accounts.google.com",
      "maps.gstatic.com",
      "khms0.googleapis.com",
      "encrypted-tbn0.gstatic.com",
      "lh3.googleusercontent.com",
      "g.page",
    ]) {
      assert.equal(isAllowedBrowserHost(host), true, host);
    }

    for (const host of [
      "localhost",
      "127.0.0.1",
      "10.0.0.5",
      "169.254.169.254",
      "192.168.1.10",
      "::1",
      "example.com",
      "evil.google.com.evil.example",
      "google.com.evil.example",
      "metadata.google.internal",
      "",
    ]) {
      assert.equal(isAllowedBrowserHost(host), false, host);
    }
  });

  it("accepts only genuine review URLs", () => {
    assert.equal(
      extractObservedReviewUrl(EXPECTED_REVIEW_URL),
      EXPECTED_REVIEW_URL,
    );
    assert.equal(
      extractObservedReviewUrl("https://g.page/r/AbCdEf123/review"),
      "https://g.page/r/AbCdEf123/review",
    );

    // A Maps place page is never a review URL.
    assert.equal(extractObservedReviewUrl(RESOLVED_ONLY_FTID), null);
    assert.equal(
      extractObservedReviewUrl(
        `https://www.google.com/maps/place/?q=place_id:${PLACE_ID}`,
      ),
      null,
    );
    assert.equal(extractObservedReviewUrl("https://maps.app.goo.gl/abc"), null);
    assert.equal(extractObservedReviewUrl("https://search.google.com/local/writereview"), null);
    assert.equal(extractObservedReviewUrl(""), null);
    assert.equal(extractObservedReviewUrl(null), null);
  });

  it("collects real Place ID tokens but ignores feature ids and CIDs", () => {
    const tokens = collectPlaceIdTokens(
      `"${PLACE_ID}" and 0x2e6f1dfa0caae141:0x3b66fb4b842e1140 and 4280384797620965696 and ${PLACE_ID}`,
    );

    assert.deepEqual(tokens, [PLACE_ID]);
    assert.deepEqual(collectPlaceIdTokens("no identifiers here"), []);
    assert.deepEqual(collectPlaceIdTokens("ChIJshort"), []);
  });

  it("is disabled unless explicitly enabled", () => {
    const previous = process.env.PLAYWRIGHT_RESOLVER_ENABLED;
    delete process.env.PLAYWRIGHT_RESOLVER_ENABLED;

    assert.equal(isPlaywrightResolverEnabled(), false);
    assert.equal(isPlaywrightResolverEnabled(true), true);
    assert.equal(isPlaywrightResolverEnabled(false), false);

    process.env.PLAYWRIGHT_RESOLVER_ENABLED = "1";
    assert.equal(isPlaywrightResolverEnabled(), true);

    if (previous === undefined) delete process.env.PLAYWRIGHT_RESOLVER_ENABLED;
    else process.env.PLAYWRIGHT_RESOLVER_ENABLED = previous;
  });
});

describe("Playwright resolver pipeline wiring", () => {
  it("is not called at all while disabled", async () => {
    let called = false;
    const result = await resolveMapsLink(SHORTLINK, {
      fetchImpl: shortlinkFetch,
      enablePlaywright: false,
      playwrightDiscovery: async () => {
        called = true;
        return discovery({});
      },
    });

    assert.equal(called, false);
    assert.equal(result.status, "needs_place_id");
  });

  it("accepts a verified Place ID reported by the browser resolver", async () => {
    const result = await resolveMapsLink(SHORTLINK, {
      fetchImpl: shortlinkFetch,
      enablePlaywright: true,
      playwrightDiscovery: async () =>
        discovery({
          status: "discovered_place_id",
          placeId: PLACE_ID,
          placeIdSource: "maps-rpc",
          reviewUrl: EXPECTED_REVIEW_URL,
          reviewUrlOrigin: "built-from-verified-place-id",
          placeTitle: "Toko Kopi",
          nameVerified: true,
          reviewActionFound: true,
          reviewActionClicked: true,
        }),
    });

    assert.equal(result.status, "success");
    assert.equal(result.reviewUrl, EXPECTED_REVIEW_URL);
    assert.equal(result.placeId, PLACE_ID);
    assert.equal(result.placeIdSource, "playwright");
    assert.equal(result.placeTitle, "Toko Kopi");
    assert.equal(result.reviewActionFound, true);
  });

  it("rejects an unverified Place ID from the browser resolver", async () => {
    const result = await resolveMapsLink(SHORTLINK, {
      fetchImpl: shortlinkFetch,
      enablePlaywright: true,
      playwrightDiscovery: async () =>
        discovery({
          status: "discovered_place_id",
          placeId: PLACE_ID,
          reviewUrl: EXPECTED_REVIEW_URL,
          placeTitle: "Toko Lain",
          nameVerified: false,
        }),
    });

    assert.equal(result.status, "needs_place_id");
    assert.equal(result.reviewUrl, null);
    assert.equal(result.placeId, null);
  });

  it("never returns a Maps page as a review URL", async () => {
    const result = await resolveMapsLink(SHORTLINK, {
      fetchImpl: shortlinkFetch,
      enablePlaywright: true,
      playwrightDiscovery: async () =>
        discovery({
          status: "review_url_exposed",
          reviewUrl: RESOLVED_ONLY_FTID,
          nameVerified: true,
        }),
    });

    assert.equal(result.status, "needs_place_id");
    assert.equal(result.reviewUrl, null);
  });

  it("keeps the browser diagnostics on an unresolved result", async () => {
    const result = await resolveMapsLink(SHORTLINK, {
      fetchImpl: shortlinkFetch,
      enablePlaywright: true,
      playwrightDiscovery: async () =>
        discovery({
          status: "dialog_only",
          placeTitle: "Toko Kopi",
          reviewActionFound: true,
          reviewActionClicked: true,
          notes: ["dialog"],
        }),
    });

    assert.equal(result.status, "needs_place_id");
    assert.equal(result.reviewUrl, null);
    assert.equal(result.placeTitle, "Toko Kopi");
    assert.equal(result.reviewActionFound, true);
    assert.match(result.hint ?? "", /Playwright/);
    assert.match(result.hint ?? "", /dialog/i);
  });
});
