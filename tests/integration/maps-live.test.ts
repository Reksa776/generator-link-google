import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveMapsLink } from "../../lib/resolve";

/**
 * Live integration test against real Google Maps links.
 *
 * It is NOT part of `npm test` (the default glob only matches
 * `test-build/tests/*.test.js`). Run it explicitly with:
 *
 *   npm run test:integration
 *
 * What it asserts (the honesty guarantees):
 * - a review link is only ever produced from a Place ID that Google itself
 *   supplied (input URL, destination URL, or Places API);
 * - a feature id / CID is never promoted to a Place ID;
 * - when no Place ID can be confirmed, the result carries no review URL.
 *
 * What it measures and prints: the real keyless conversion rate per link.
 */

/** Real share links gathered from public sources. */
const SHORTLINKS = [
  "https://maps.app.goo.gl/HihE1JQdDmzBDCVC8",
  "https://maps.app.goo.gl/PTQskqTRvSa6RnYY7",
];

/** Public, documented Place ID (Google Sydney, developers.google.com). */
const DOCUMENTED_PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";

const LONG_URLS_WITH_PLACE_ID = [
  `https://www.google.com/maps/search/?api=1&query=Google+Australia&query_place_id=${DOCUMENTED_PLACE_ID}`,
  `https://www.google.com/maps/place/?q=place_id:${DOCUMENTED_PLACE_ID}`,
];

const NETWORK_PROBE = "https://maps.app.goo.gl/HihE1JQdDmzBDCVC8";

async function hasNetwork(): Promise<boolean> {
  try {
    const response = await fetch(NETWORK_PROBE, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    await response.body?.cancel().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

describe("Live Google Maps link conversion", async () => {
  const online = await hasNetwork();
  const skipReason = online
    ? false
    : "Tidak ada koneksi jaringan ke Google, uji integrasi dilewati.";

  it("converts long Maps URLs that carry a Place ID (keyless)", { skip: skipReason }, async () => {
    let converted = 0;

    for (const url of LONG_URLS_WITH_PLACE_ID) {
      const result = await resolveMapsLink(url);
      if (result.status === "success" && result.reviewUrl) {
        converted += 1;
        assert.equal(result.placeId, DOCUMENTED_PLACE_ID);
        assert.equal(
          result.reviewUrl,
          `https://search.google.com/local/writereview?placeid=${DOCUMENTED_PLACE_ID}`,
        );
      }
    }

    console.log(
      `[integration] URL panjang dengan Place ID: ${converted}/${LONG_URLS_WITH_PLACE_ID.length} berhasil (tanpa API key)`,
    );
    assert.equal(converted, LONG_URLS_WITH_PLACE_ID.length);
  });

  it("resolves real share links and never invents a Place ID", { skip: skipReason }, async () => {
    const measurements: string[] = [];
    let resolved = 0;
    let withReviewLink = 0;

    for (const shortlink of SHORTLINKS) {
      const result = await resolveMapsLink(shortlink);

      if (result.status === "success") {
        resolved += 1;
        withReviewLink += 1;
        measurements.push(
          `${shortlink} → success (placeId dari ${result.placeIdSource})`,
        );
      } else if (result.status === "needs_place_id") {
        resolved += 1;
        measurements.push(
          `${shortlink} → lokasi terbaca (${result.identity.name ?? "tanpa nama"}), Place ID tidak dapat dipastikan`,
        );
      } else {
        measurements.push(`${shortlink} → ${result.status}`);
      }

      // Honesty guarantees, checked on every outcome.
      if (result.status !== "success") {
        assert.equal(result.reviewUrl, null, "no review link without a Place ID");
      }
      if (result.placeId && result.identity.ftid) {
        assert.notEqual(
          result.placeId,
          result.identity.ftid,
          "a feature id must never be used as a Place ID",
        );
      }
      if (result.placeId) {
        assert.match(result.placeId, /^[A-Za-z0-9_-]{10,255}$/);
      }
      if (result.status === "needs_place_id") {
        assert.ok(
          result.identity.name !== null || result.identity.cid !== null,
          "an unresolved result must still report what was identified",
        );
      }
    }

    console.log("[integration] hasil per link pendek:");
    for (const line of measurements) console.log(`  - ${line}`);
    console.log(
      `[integration] tingkat pembacaan lokasi: ${resolved}/${SHORTLINKS.length}; link ulasan tanpa API key: ${withReviewLink}/${SHORTLINKS.length}`,
    );

    // Every link must at least be read as a location (or be a dead link), and
    // the resolver must never claim success without a confirmed Place ID.
    //
    // This run measures the DEFAULT configuration, where the experimental
    // Playwright resolver is disabled, so share links cannot yield a review
    // link. With PLAYWRIGHT_RESOLVER_ENABLED=1 they do convert; that path is
    // measured separately by `npm run test:resolver`.
    assert.ok(resolved >= 1, "at least one share link should resolve its location");
    assert.equal(withReviewLink, 0, "no keyless Place ID is expected for share links");
  });
});
