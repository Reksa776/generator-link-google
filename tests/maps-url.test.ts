import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMapsFallbackUrl,
  extractEmbeddedPlaceId,
  extractPlaceIdentity,
  isAllowedGoogleHost,
  isAllowedResolvedUrl,
  isValidPlaceIdFormat,
  parseMapsInput,
  sanitizeInput,
} from "../lib/maps-url";

/** Real URLs captured while probing live Google responses. */
const REAL_SHORTLINK = "https://maps.app.goo.gl/HihE1JQdDmzBDCVC8";
const REAL_RESOLVED_PLACE_URL =
  "https://www.google.com/maps/place/Universitas+Islam+Negeri+Siber+Syekh+Nurjati+Cirebon+(UINSSC)/@-6.7353126,108.5161525,14z/data=!4m6!3m5!1s0x2e6f1dfa0caae141:0x3b66fb4b842e1140!8m2!3d-6.7353126!4d108.5336626!16s%2Fg%2F121n4817?entry=tts";
/** Documented Place ID for Google Sydney (developers.google.com). */
const DOCUMENTED_PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";

describe("parseMapsInput classification", () => {
  it("marks a share link as needing server side resolution", () => {
    const parsed = parseMapsInput(REAL_SHORTLINK);

    assert.equal(parsed.kind, "shortlink");
    assert.equal(parsed.url, REAL_SHORTLINK);
    assert.equal(parsed.placeId, null);
    assert.equal(parsed.reviewUrl, null);
  });

  it("accepts a resolved Maps place URL that only carries a feature id", () => {
    const parsed = parseMapsInput(REAL_RESOLVED_PLACE_URL);

    assert.equal(parsed.kind, "maps-url");
    assert.equal(parsed.placeId, null, "a feature id is not a Place ID");
    assert.equal(parsed.identity.ftid, "0x2e6f1dfa0caae141:0x3b66fb4b842e1140");
    assert.equal(parsed.identity.cid, "4280384797620965696");
    assert.equal(parsed.identity.name, "Universitas Islam Negeri Siber Syekh Nurjati Cirebon (UINSSC)");
    assert.equal(parsed.identity.latitude, -6.7353126);
    assert.equal(parsed.identity.longitude, 108.5336626);
  });

  it("recognises a Maps URL that embeds a real Place ID", () => {
    const parsed = parseMapsInput(
      `https://www.google.com/maps/search/?api=1&query=Google+Australia&query_place_id=${DOCUMENTED_PLACE_ID}`,
    );

    assert.equal(parsed.kind, "place-id");
    assert.equal(parsed.placeId, DOCUMENTED_PLACE_ID);
    assert.equal(
      parsed.reviewUrl,
      `https://search.google.com/local/writereview?placeid=${DOCUMENTED_PLACE_ID}`,
    );
  });

  it("recognises the place_id: query form", () => {
    const parsed = parseMapsInput(
      `https://www.google.com/maps/place/?q=place_id:${DOCUMENTED_PLACE_ID}`,
    );

    assert.equal(parsed.kind, "place-id");
    assert.equal(parsed.placeId, DOCUMENTED_PLACE_ID);
  });

  it("recognises an existing writereview link", () => {
    const parsed = parseMapsInput(
      `https://search.google.com/local/writereview?placeid=${DOCUMENTED_PLACE_ID}&utm_source=x`,
    );

    assert.equal(parsed.kind, "review-link");
    assert.equal(parsed.placeId, DOCUMENTED_PLACE_ID);
    assert.equal(
      parsed.reviewUrl,
      `https://search.google.com/local/writereview?placeid=${DOCUMENTED_PLACE_ID}`,
    );
  });

  it("recognises a g.page review link", () => {
    const parsed = parseMapsInput("https://g.page/r/CdExampleToken123/review");

    assert.equal(parsed.kind, "g-page-review");
    assert.equal(parsed.reviewUrl, "https://g.page/r/CdExampleToken123/review");
  });

  it("rejects non-Google and unsafe inputs", () => {
    const cases: Array<[string, string]> = [
      ["https://example.com/maps/place/x", "unsupported_host"],
      ["javascript:alert(1)", "unsupported_protocol"],
      ["data:text/html,<script>alert(1)</script>", "unsupported_protocol"],
      ["https://user:pass@www.google.com/maps/place/x", "credentials"],
      ["https://google.com.evil.example/maps/place/x", "unsupported_host"],
      ["maps.app.goo.gl/AbCdEf", "missing_protocol"],
      ["", "empty"],
      ["https://www.google.com/search?q=test", "not_a_maps_url"],
      ["https://search.google.com/local/writereview", "missing_place_id"],
      ["https://g.page/r/token", "unsupported_review_path"],
    ];

    for (const [input, expectedReason] of cases) {
      const parsed = parseMapsInput(input);
      assert.equal(parsed.kind, "unsupported", `expected unsupported for ${input}`);
      assert.equal(parsed.reason, expectedReason, `wrong reason for ${input}`);
      assert.equal(parsed.reviewUrl, null);
    }
  });

  it("never turns a feature id into a Place ID", () => {
    const ftid = "0x2e6f1dfa0caae141:0x3b66fb4b842e1140";
    const parsed = parseMapsInput(
      `https://www.google.com/maps/place/?q=place_id:${ftid}`,
    );

    assert.equal(parsed.placeId, null);
    assert.equal(parsed.reviewUrl, null);
    assert.equal(parsed.kind, "maps-url");
  });
});

describe("host and Place ID guards", () => {
  it("allows Google hosts including country domains", () => {
    for (const host of [
      "maps.app.goo.gl",
      "www.google.com",
      "google.com",
      "maps.google.com",
      "search.google.com",
      "g.page",
      "www.google.co.id",
      "maps.google.com.au",
    ]) {
      assert.equal(isAllowedGoogleHost(host), true, host);
    }
  });

  it("rejects look-alike and foreign hosts", () => {
    for (const host of [
      "google.com.evil.example",
      "evil-google.com",
      "notgoogle.com",
      "maps.app.goo.gl.evil.example",
      "example.com",
      "127.0.0.1",
      "localhost",
    ]) {
      assert.equal(isAllowedGoogleHost(host), false, host);
      assert.equal(isAllowedResolvedUrl(`https://${host}/maps/place/x`), false, host);
    }
  });

  it("only accepts http(s) URLs on allowed hosts", () => {
    assert.equal(isAllowedResolvedUrl("https://www.google.com/maps/place/x"), true);
    assert.equal(isAllowedResolvedUrl("javascript:alert(1)"), false);
    assert.equal(isAllowedResolvedUrl("file:///etc/passwd"), false);
    assert.equal(isAllowedResolvedUrl("not a url"), false);
  });

  it("validates Place ID format strictly", () => {
    assert.equal(isValidPlaceIdFormat(DOCUMENTED_PLACE_ID), true);
    assert.equal(isValidPlaceIdFormat("short"), false);
    assert.equal(isValidPlaceIdFormat("has space here"), false);
    assert.equal(isValidPlaceIdFormat("0x2e6f1dfa0caae141:0x3b66fb4b842e1140"), false);
    assert.equal(isValidPlaceIdFormat("a".repeat(256)), false);
  });

  it("extracts embedded Place IDs from parameters only", () => {
    const withParam = new URL(
      `https://www.google.com/maps/search/?api=1&query=x&query_place_id=${DOCUMENTED_PLACE_ID}`,
    );
    assert.equal(extractEmbeddedPlaceId(withParam), DOCUMENTED_PLACE_ID);

    const withFtid = new URL(REAL_RESOLVED_PLACE_URL);
    assert.equal(extractEmbeddedPlaceId(withFtid), null);
  });

  it("strips control characters and wrapping quotes", () => {
    assert.equal(sanitizeInput('  "<\u0000https://maps.app.goo.gl/abc>"  '), "https://maps.app.goo.gl/abc");
  });

  it("builds a CID fallback link instead of a review link", () => {
    const identity = extractPlaceIdentity(new URL(REAL_RESOLVED_PLACE_URL));
    assert.equal(
      buildMapsFallbackUrl(REAL_RESOLVED_PLACE_URL, identity),
      "https://www.google.com/maps?cid=4280384797620965696",
    );
    assert.equal(buildMapsFallbackUrl(null, { ...identity, cid: null }), null);
  });
});
