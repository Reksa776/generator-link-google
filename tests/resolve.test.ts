import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lookupPlaceId, resolveMapsLink, resolveRedirects } from "../lib/resolve";

const SHORTLINK = "https://maps.app.goo.gl/HihE1JQdDmzBDCVC8";
const RESOLVED_ONLY_FTID =
  "https://www.google.com/maps/place/Toko+Kopi/@-6.7353126,108.5161525,14z/data=!4m6!3m5!1s0x2e6f1dfa0caae141:0x3b66fb4b842e1140!8m2!3d-6.7353126!4d108.5336626!16s%2Fg%2F121n4817";
const DOCUMENTED_PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";
const RESOLVED_WITH_PLACE_ID = `https://www.google.com/maps/search/?api=1&query=Toko+Kopi&query_place_id=${DOCUMENTED_PLACE_ID}`;
const EXPECTED_REVIEW_URL = `https://search.google.com/local/writereview?placeid=${DOCUMENTED_PLACE_ID}`;

interface FetchMock {
  fetchImpl: typeof fetch;
  calls: string[];
}

function createFetchMock(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): FetchMock {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return handler(url, init);
  }) as typeof fetch;

  return { fetchImpl, calls };
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

function html(url: string, status = 200): Response {
  const response = new Response("<html></html>", { status });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

describe("resolveRedirects", () => {
  it("follows an allow-listed redirect chain", async () => {
    const mock = createFetchMock((url) =>
      url === SHORTLINK
        ? redirect(RESOLVED_ONLY_FTID)
        : html(RESOLVED_ONLY_FTID),
    );

    const result = await resolveRedirects(SHORTLINK, mock.fetchImpl);

    assert.equal(result.ok, true);
    assert.equal(result.finalUrl, RESOLVED_ONLY_FTID);
    assert.deepEqual(mock.calls, [SHORTLINK, RESOLVED_ONLY_FTID]);
  });

  it("refuses to follow a redirect that leaves the Google allow-list", async () => {
    const mock = createFetchMock(() =>
      redirect("https://evil.example/steal?token=1"),
    );

    const result = await resolveRedirects(SHORTLINK, mock.fetchImpl);

    assert.equal(result.ok, false);
    assert.equal(result.error, "left_allowlist");
    assert.equal(mock.calls.length, 1, "the foreign host must never be fetched");
  });

  it("refuses an input that is not on the allow-list", async () => {
    const mock = createFetchMock(() => html("https://evil.example"));
    const result = await resolveRedirects("https://evil.example/x", mock.fetchImpl);

    assert.equal(result.ok, false);
    assert.equal(result.error, "left_allowlist");
    assert.equal(mock.calls.length, 0);
  });

  it("stops after too many redirects", async () => {
    let counter = 0;
    const mock = createFetchMock(() => {
      counter += 1;
      return redirect(`https://maps.app.goo.gl/hop${counter}`);
    });

    const result = await resolveRedirects(SHORTLINK, mock.fetchImpl);

    assert.equal(result.ok, false);
    assert.equal(result.error, "too_many_redirects");
    assert.equal(counter, 6);
  });

  it("reports network failures", async () => {
    const mock = createFetchMock(() => {
      throw new Error("ECONNRESET");
    });

    const result = await resolveRedirects(SHORTLINK, mock.fetchImpl);
    assert.equal(result.ok, false);
    assert.equal(result.error, "network");
  });

  it("reports dead links", async () => {
    const mock = createFetchMock(() => html(SHORTLINK, 404));
    const result = await resolveRedirects(SHORTLINK, mock.fetchImpl);

    assert.equal(result.ok, false);
    assert.equal(result.error, "unresolved");
  });
});

describe("resolveMapsLink without an API key", () => {
  it("returns a review URL straight from the pasted link without any request", async () => {
    const mock = createFetchMock(() => html(RESOLVED_WITH_PLACE_ID));
    const result = await resolveMapsLink(RESOLVED_WITH_PLACE_ID, {
      fetchImpl: mock.fetchImpl,
    });

    assert.equal(result.status, "success");
    assert.equal(result.reviewUrl, EXPECTED_REVIEW_URL);
    assert.equal(result.placeIdSource, "input-url");
    assert.deepEqual(mock.calls, [], "no network call is needed");
  });

  it("keeps a g.page review link as is", async () => {
    const result = await resolveMapsLink("https://g.page/r/AbCdEf123/review");

    assert.equal(result.status, "success");
    assert.equal(result.reviewUrl, "https://g.page/r/AbCdEf123/review");
  });

  it("resolves a share link whose destination carries a Place ID", async () => {
    const mock = createFetchMock((url) =>
      url === SHORTLINK ? redirect(RESOLVED_WITH_PLACE_ID) : html(RESOLVED_WITH_PLACE_ID),
    );

    const result = await resolveMapsLink(SHORTLINK, { fetchImpl: mock.fetchImpl });

    assert.equal(result.status, "success");
    assert.equal(result.reviewUrl, EXPECTED_REVIEW_URL);
    assert.equal(result.placeIdSource, "shortlink-destination");
  });

  it("never fabricates a Place ID when only a feature id is available", async () => {
    const mock = createFetchMock((url) =>
      url === SHORTLINK ? redirect(RESOLVED_ONLY_FTID) : html(RESOLVED_ONLY_FTID),
    );

    const result = await resolveMapsLink(SHORTLINK, { fetchImpl: mock.fetchImpl });

    assert.equal(result.status, "needs_place_id");
    assert.equal(result.reviewUrl, null);
    assert.equal(result.placeId, null);
    assert.equal(result.identity.ftid, "0x2e6f1dfa0caae141:0x3b66fb4b842e1140");
    assert.equal(result.identity.cid, "4280384797620965696");
    assert.equal(
      result.mapsFallbackUrl,
      "https://www.google.com/maps?cid=4280384797620965696",
    );
    assert.match(result.hint ?? "", /Feature ID|CID/);
  });

  it("reports an unreachable share link instead of guessing", async () => {
    const mock = createFetchMock(() => {
      throw new Error("timeout");
    });

    const result = await resolveMapsLink(SHORTLINK, { fetchImpl: mock.fetchImpl });

    assert.equal(result.status, "unreachable");
    assert.equal(result.reviewUrl, null);
  });

  it("blocks SSRF attempts through a share link", async () => {
    const mock = createFetchMock(() =>
      redirect("http://169.254.169.254/latest/meta-data/"),
    );

    const result = await resolveMapsLink(SHORTLINK, { fetchImpl: mock.fetchImpl });

    assert.equal(result.status, "unreachable");
    assert.equal(result.reviewUrl, null);
    assert.equal(mock.calls.length, 1);
    assert.equal(
      mock.calls.some((call) => call.includes("169.254.169.254")),
      false,
    );
  });

  it("rejects unsupported input", async () => {
    const result = await resolveMapsLink("https://example.com/x");
    assert.equal(result.status, "unsupported");
    assert.equal(result.reviewUrl, null);
  });
});

describe("resolveMapsLink with an API key", () => {
  const placesResponse = (places: unknown[]) =>
    new Response(JSON.stringify({ places }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  it("uses the Places API result when name and distance match", async () => {
    const mock = createFetchMock((url) => {
      if (url === SHORTLINK) return redirect(RESOLVED_ONLY_FTID);
      if (url.startsWith("https://places.googleapis.com/")) {
        return placesResponse([
          {
            id: DOCUMENTED_PLACE_ID,
            displayName: { text: "Toko Kopi" },
            formattedAddress: "Jl. Contoh No. 1",
            location: { latitude: -6.73531, longitude: 108.53367 },
          },
        ]);
      }
      return html(RESOLVED_ONLY_FTID);
    });

    const result = await resolveMapsLink(SHORTLINK, {
      fetchImpl: mock.fetchImpl,
      apiKey: "test-key",
    });

    assert.equal(result.status, "success");
    assert.equal(result.reviewUrl, EXPECTED_REVIEW_URL);
    assert.equal(result.placeIdSource, "places-api");
  });

  it("asks the user to choose when candidates are ambiguous", async () => {
    const mock = createFetchMock((url) => {
      if (url === SHORTLINK) return redirect(RESOLVED_ONLY_FTID);
      if (url.startsWith("https://places.googleapis.com/")) {
        return placesResponse([
          {
            id: "ChIJaaaaaaaaaaaaaaaaaaaa",
            displayName: { text: "Toko Kopi Cabang Lain" },
            formattedAddress: "Jl. Jauh No. 99",
            location: { latitude: -7.5, longitude: 110.5 },
          },
        ]);
      }
      return html(RESOLVED_ONLY_FTID);
    });

    const result = await resolveMapsLink(SHORTLINK, {
      fetchImpl: mock.fetchImpl,
      apiKey: "test-key",
    });

    assert.equal(result.status, "ambiguous");
    assert.equal(result.reviewUrl, null);
    assert.equal(result.candidates.length, 1);
    assert.equal(
      result.candidates[0]!.reviewUrl,
      "https://search.google.com/local/writereview?placeid=ChIJaaaaaaaaaaaaaaaaaaaa",
    );
    assert.ok((result.candidates[0]!.distanceMeters ?? 0) > 250);
  });

  it("falls back to needs_place_id when the API call fails", async () => {
    const mock = createFetchMock((url) => {
      if (url === SHORTLINK) return redirect(RESOLVED_ONLY_FTID);
      if (url.startsWith("https://places.googleapis.com/")) {
        return new Response("denied", { status: 403 });
      }
      return html(RESOLVED_ONLY_FTID);
    });

    const result = await resolveMapsLink(SHORTLINK, {
      fetchImpl: mock.fetchImpl,
      apiKey: "test-key",
    });

    assert.equal(result.status, "needs_place_id");
    assert.equal(result.reviewUrl, null);
  });

  it("sends the API key and field mask on the Places request", async () => {
    let captured: { headers?: HeadersInit; body?: unknown } = {};
    const mock = createFetchMock((url, init) => {
      captured = { headers: init?.headers, body: init?.body };
      void url;
      return placesResponse([]);
    });

    await lookupPlaceId(
      "secret-key",
      { name: "Toko Kopi", latitude: -6.7, longitude: 108.5 },
      mock.fetchImpl,
    );

    const headers = new Headers(captured.headers);
    assert.equal(headers.get("x-goog-api-key"), "secret-key");
    assert.match(headers.get("x-goog-fieldmask") ?? "", /places\.id/);
    assert.match(String(captured.body), /Toko Kopi/);
  });

  it("refuses to search without a name", async () => {
    const mock = createFetchMock(() => placesResponse([]));
    const result = await lookupPlaceId(
      "secret-key",
      { name: null, latitude: -6.7, longitude: 108.5 },
      mock.fetchImpl,
    );

    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_query");
    assert.equal(mock.calls.length, 0);
  });
});
