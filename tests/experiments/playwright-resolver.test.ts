import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";

import { resolveMapsLink } from "../../lib/resolve";
import {
  closePlaywrightBrowser,
  discoverReviewUrlWithPlaywright,
  type PlaywrightDiscoveryResult,
} from "../../lib/playwright-resolver";
import type { ResolveResponse } from "../../lib/resolve-types";

/**
 * LIVE EXPERIMENT — real Chromium against real Google Maps pages.
 *
 *   npm run test:resolver
 *
 * This harness only enforces the honesty invariants (never a fabricated Place
 * ID, never a Maps URL reported as a review URL, never a review URL without a
 * verified Place ID). The measured conversion rate is printed, not asserted:
 * if Google blocks the browser, the verdict is NO-GO and that is reported
 * honestly instead of being hidden behind a failing assertion.
 */

process.env.PLAYWRIGHT_RESOLVER_ENABLED = "1";

const EVIDENCE_DIR = path.join(process.cwd(), "docs", "evidence", "playwright");

interface ExperimentCase {
  slug: string;
  label: string;
  input: string;
}

const CASES: ExperimentCase[] = [
  {
    slug: "given-shortlink",
    label: "Shortlink dari permintaan (universitas, Indonesia)",
    input: "https://maps.app.goo.gl/HihE1JQdDmzBDCVC8",
  },
  {
    slug: "hotel-shortlink",
    label: "Shortlink bisnis (hotel, Yunani)",
    input: "https://maps.app.goo.gl/PTQskqTRvSa6RnYY7",
  },
  {
    slug: "starbucks",
    label: "Bisnis (Starbucks GI, place URL dengan ftid)",
    input:
      "https://www.google.com/maps/place/Starbucks+GI/@-6.1947969,106.815049,17z/data=!3m1!5s0x2e69f421ccf212e3:0xd7f546bd9059db05!4m10!1m2!2m1!1sStarbucks+Grand+Indonesia!3m6!1s0x2e69f42066e78fe5:0x3fd2d2e4310b3ac6!8m2!3d-6.1947969!4d106.8195551!15sChlTdGFyYnVja3MgR3JhbmQgSW5kb25lc2lhIgOIAQFaGyIZc3RhcmJ1Y2tzIGdyYW5kIGluZG9uZXNpYZIBC2NvZmZlZV9zaG9wmgEkQ2hkRFNVaE5NRzluUzBWSlEwRm5UVVJKTUhaVFR6RlJSUkFC4AEA-gEECAAQRQ!16s%2Fg%2F1tfdgrvy?entry=ttu&g_ep=EgoyMDI2MTAxMy4wIKXMDSoASAFQAw%3D%3D",
  },
  {
    slug: "monas",
    label: "Lokasi publik (Monumen Nasional, place URL dengan ftid)",
    input:
      "https://www.google.com/maps/place/Monumen+Nasional/@-6.1753083,106.8271106,17z/data=!3m1!4b1!4m6!3m5!1s0x2e69f5d2e764b12d:0x3d2ad6e1e0e9bcc8!8m2!3d-6.1753083!4d106.8271106!16zL20vMDNxN2hz?entry=ttu&g_ep=EgoyMDI2MTAxMy4wIKXMDSoASAFQAw%3D%3D",
  },
  {
    slug: "borobudur",
    label: "Lokasi publik (Candi Borobudur, place URL dengan ftid)",
    input:
      "https://www.google.com/maps/place/Candi+Borobudur/@-7.6045376,110.2008049,17z/data=!4m10!1m2!2m1!1sCandi+Borobudur!3m6!1s0x2e7a8cf009a7d697:0xdd34334744dc3cb!8m2!3d-7.6078738!4d110.2037513!15sCg9DYW5kaSBCb3JvYnVkdXJaESIPY2FuZGkgYm9yb2J1ZHVykgEPYnVkZGhpc3RfdGVtcGxlmgFEQ2k5RFFVbFJRVU52WkVOb2RIbGpSamx2VDJ0ME5WVXhVVFJYYlhoMFl6QnNaazF0YTNoV2ExbzFZMVV3ZDFnell4QULgAQD6AQQIABBE!16zL20vMDFoemNq?entry=ttu&g_ep=EgoyMDI2MTAxMy4wIKXMDSoASAFQAw%3D%3D",
  },
];

const FTID_PATTERN = /^0x[0-9a-f]+:0x[0-9a-f]+$/i;

function assertNoFabrication(label: string, result: ResolveResponse): void {
  if (result.status === "success" && result.reviewUrl) {
    assert.match(
      result.reviewUrl,
      /^https:\/\/search\.google\.com\/local\/writereview\?placeid=[A-Za-z0-9_-]{10,}$|^https:\/\/g\.page\/r\/[A-Za-z0-9_-]+\/review$/,
      `${label}: review URL must be a Google review endpoint`,
    );
    assert.equal(
      /\/maps\//.test(result.reviewUrl),
      false,
      `${label}: a Maps place page must never be returned as a review URL`,
    );
    if (result.placeId) {
      assert.equal(
        FTID_PATTERN.test(result.placeId),
        false,
        `${label}: a feature id must never be used as a Place ID`,
      );
      assert.match(result.placeId, /^[A-Za-z0-9_-]{10,255}$/, `${label}: malformed Place ID`);
      assert.notEqual(
        result.reviewUrl,
        result.resolvedUrl,
        `${label}: the resolved Maps page is not a review URL`,
      );
    }
  } else {
    assert.equal(result.reviewUrl, null, `${label}: no review URL without a verified Place ID`);
  }
}

describe("Playwright resolver — live Google Maps experiment", () => {
  after(async () => {
    await closePlaywrightBrowser();
  });

  it("records the required evidence for every test location", async () => {
    mkdirSync(EVIDENCE_DIR, { recursive: true });

    const rows: string[] = [];
    let goCount = 0;
    let totalMs = 0;
    let successes = 0;

    for (const testCase of CASES) {
      const started = Date.now();

      // Full production pipeline with the experimental resolver enabled.
      const pipeline = await resolveMapsLink(testCase.input, { enablePlaywright: true });
      const pipelineMs = Date.now() - started;

      // Detailed browser observation (also produces screenshot evidence).
      const detail: PlaywrightDiscoveryResult = await discoverReviewUrlWithPlaywright({
        placeUrl: pipeline.resolvedUrl ?? testCase.input,
        expectedName: pipeline.identity.name,
        screenshotPath: path.join(EVIDENCE_DIR, `${testCase.slug}.png`),
      });

      totalMs += pipelineMs;
      if (pipeline.status === "success" && pipeline.reviewUrl) successes += 1;
      if (detail.placeId && detail.nameVerified) goCount += 1;

      assertNoFabrication(testCase.label, pipeline);

      if (pipeline.placeId) {
        assert.notEqual(pipeline.placeId, pipeline.identity.ftid);
      }
      if (pipeline.resolvedUrl) {
        assert.match(pipeline.resolvedUrl, /^https:\/\/[^/]*google\./, "resolved to a Google host");
      }

      rows.push(
        [
          `lokasi        : ${testCase.label}`,
          `input         : ${testCase.input}`,
          `tujuan        : ${(pipeline.resolvedUrl ?? "-").slice(0, 120)}`,
          `nama terdeteksi: ${detail.placeTitle ?? pipeline.identity.name ?? "-"}`,
          `aksi ulasan   : ${detail.reviewActionFound ? "ditemukan" : "tidak ditemukan"}${
            detail.reviewActionClicked ? " + diklik" : ""
          }`,
          `URL ulasan    : ${pipeline.reviewUrl ?? "tidak tersedia"}`,
          `asal Place ID : ${pipeline.placeId ? `${pipeline.placeIdSource} (${pipeline.placeId})` : "-"}`,
          `perlu login   : ${detail.loginRequired ? "ya" : "tidak"}`,
          `status akhir  : ${pipeline.status} / browser=${detail.status}`,
          `waktu         : ${pipelineMs} ms (browser ${detail.elapsedMs} ms)`,
          `screenshot    : ${detail.screenshotPath ?? "-"}`,
          `catatan       : ${detail.notes.join("; ") || "-"}`,
        ].join("\n"),
      );
    }

    console.log("\n================ HASIL EKSPERIMEN PLAYWRIGHT ================");
    for (const row of rows) {
      console.log("-------------------------------------------------------------");
      console.log(row);
    }
    console.log("=============================================================");
    console.log(`Lokasi diuji                       : ${CASES.length}`);
    console.log(`Place ID terverifikasi (browser)   : ${goCount}/${CASES.length}`);
    console.log(`Link ulasan dari pipeline          : ${successes}/${CASES.length}`);
    console.log(`Rata-rata waktu resolusi           : ${Math.round(totalMs / CASES.length)} ms`);
    console.log(
      `VERDICT                            : ${
        successes > 0 && goCount > 0 ? "GO (terukur)" : "NO-GO (terukur)"
      }`,
    );
    console.log("=============================================================\n");

    assert.ok(rows.length === CASES.length);
  });
});
