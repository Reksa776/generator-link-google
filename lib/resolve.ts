import {
  buildMapsFallbackUrl,
  buildReviewUrlFromPlaceId,
  isAllowedResolvedUrl,
  parseMapsInput,
  type ParsedMapsInput,
} from "./maps-url";
import {
  discoverReviewUrlWithPlaywright,
  extractObservedReviewUrl,
  isPlaywrightResolverEnabled,
  type PlaywrightDiscoveryOptions,
  type PlaywrightDiscoveryResult,
} from "./playwright-resolver";
import type {
  PlaceCandidate,
  PlaceIdSource,
  ResolveResponse,
} from "./resolve-types";

/**
 * Server side resolution.
 *
 * Responsibilities:
 * 1. Expand a `maps.app.goo.gl` share link by following redirects manually.
 * 2. Extract the place identity (name, coordinates, feature id / CID) from the
 *    destination URL.
 * 3. Recover a Place ID **only** from Google itself: either from the destination
 *    URL, or from the Places API when an API key is configured.
 *
 * Security: every redirect hop is validated against the Google host allow-list
 * before it is fetched, so a malicious short link cannot turn this endpoint into
 * an SSRF proxy.
 */

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 8000;
const PLACES_TIMEOUT_MS = 8000;
/** How close (metres) an API candidate must be to the resolved coordinates. */
const CONFIDENT_DISTANCE_METERS = 250;

export interface RedirectResolution {
  ok: boolean;
  finalUrl: string | null;
  /** Hosts that were visited, for diagnostics / tests. */
  hops: string[];
  error: "too_many_redirects" | "left_allowlist" | "network" | "unresolved";
}

/**
 * Follows redirects one hop at a time so each destination can be validated
 * before it is requested.
 */
export async function resolveRedirects(
  startUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RedirectResolution> {
  let current = startUrl;
  const hops: string[] = [];

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return { ok: false, finalUrl: null, hops, error: "unresolved" };
    }

    // Guard every hop, including the first one.
    if (!isAllowedResolvedUrl(parsed.href)) {
      return { ok: false, finalUrl: null, hops, error: "left_allowlist" };
    }

    hops.push(parsed.hostname);

    let response: Response;
    try {
      response = await fetchImpl(parsed.href, {
        method: "GET",
        redirect: "manual",
        headers: {
          "user-agent": USER_AGENT,
          "accept-language": "id-ID,id;q=0.9,en;q=0.8",
          accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, finalUrl: null, hops, error: "network" };
    }

    // We only ever need headers: release the body immediately.
    await response.body?.cancel().catch(() => undefined);

    const location = response.headers.get("location");

    if (location && response.status >= 300 && response.status < 400) {
      let next: string;
      try {
        next = new URL(location, parsed.href).href;
      } catch {
        return { ok: false, finalUrl: null, hops, error: "unresolved" };
      }

      if (!isAllowedResolvedUrl(next)) {
        return { ok: false, finalUrl: null, hops, error: "left_allowlist" };
      }

      current = next;
      continue;
    }

    // `response.url` reflects the final URL after any automatic redirect.
    const finalUrl = response.url && response.url !== "" ? response.url : parsed.href;

    if (!isAllowedResolvedUrl(finalUrl)) {
      return { ok: false, finalUrl: null, hops, error: "left_allowlist" };
    }

    if (response.status >= 400) {
      return { ok: false, finalUrl: null, hops, error: "unresolved" };
    }

    return { ok: true, finalUrl, hops, error: "unresolved" };
  }

  return { ok: false, finalUrl: null, hops, error: "too_many_redirects" };
}

/* -------------------------------------------------------------------------- */
/* Optional Google Places API (New) lookup                                     */
/* -------------------------------------------------------------------------- */

interface PlacesApiPlace {
  id?: unknown;
  displayName?: { text?: unknown };
  formattedAddress?: unknown;
  location?: { latitude?: unknown; longitude?: unknown };
}

export interface PlacesLookupResult {
  ok: boolean;
  candidates: PlaceCandidate[];
  error: string | null;
}

/**
 * Looks up the official Place ID through the Places API (New) Text Search.
 * Only used when `GOOGLE_MAPS_API_KEY` is configured: this is the one supported,
 * deterministic way to turn a business name + coordinates into a Place ID.
 */
export async function lookupPlaceId(
  apiKey: string,
  query: { name: string | null; latitude: number | null; longitude: number | null },
  fetchImpl: typeof fetch = fetch,
): Promise<PlacesLookupResult> {
  // Without a resolved business name a text search cannot be attributed to the
  // right place, so we refuse instead of guessing.
  const textQuery = query.name?.trim() ?? "";

  if (textQuery.length === 0) {
    return { ok: false, candidates: [], error: "missing_query" };
  }

  const body: Record<string, unknown> = {
    textQuery,
    languageCode: "id",
    maxResultCount: 5,
  };

  if (query.latitude !== null && query.longitude !== null) {
    body.locationBias = {
      circle: {
        center: { latitude: query.latitude, longitude: query.longitude },
        radius: 200,
      },
    };
  }

  let response: Response;
  try {
    response = await fetchImpl("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
        "x-goog-fieldmask":
          "places.id,places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PLACES_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, candidates: [], error: "network" };
  }

  if (!response.ok) {
    return { ok: false, candidates: [], error: `http_${response.status}` };
  }

  let payload: { places?: PlacesApiPlace[] };
  try {
    payload = (await response.json()) as { places?: PlacesApiPlace[] };
  } catch {
    return { ok: false, candidates: [], error: "invalid_json" };
  }

  const places = Array.isArray(payload.places) ? payload.places : [];

  const candidates: PlaceCandidate[] = [];
  for (const place of places) {
    const placeId = typeof place.id === "string" ? place.id : null;
    if (!placeId || !/^[A-Za-z0-9_-]{10,255}$/.test(placeId)) continue;

    const latitude =
      typeof place.location?.latitude === "number" ? place.location.latitude : null;
    const longitude =
      typeof place.location?.longitude === "number" ? place.location.longitude : null;

    candidates.push({
      placeId,
      name:
        typeof place.displayName?.text === "string"
          ? place.displayName.text
          : "(tanpa nama)",
      address:
        typeof place.formattedAddress === "string" ? place.formattedAddress : null,
      distanceMeters:
        query.latitude !== null && query.longitude !== null && latitude !== null && longitude !== null
          ? haversineMeters(query.latitude, query.longitude, latitude, longitude)
          : null,
      reviewUrl: buildReviewUrlFromPlaceId(placeId),
    });
  }

  return { ok: true, candidates, error: null };
}

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6371000;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return Math.round(2 * earthRadius * Math.asin(Math.sqrt(a)));
}

/** Loose comparison used to decide whether an API candidate is "the" place. */
export function namesMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;

  const normalise = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const left = normalise(a);
  const right = normalise(b);

  if (left.length === 0 || right.length === 0) return false;
  if (left === right) return true;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;

  return longer.includes(shorter) && shorter.length / longer.length >= 0.6;
}

/* -------------------------------------------------------------------------- */
/* Orchestration                                                               */
/* -------------------------------------------------------------------------- */

export interface ResolveOptions {
  apiKey?: string | undefined;
  fetchImpl?: typeof fetch;
  /** Force the experimental Playwright resolver on/off (defaults to the env flag). */
  enablePlaywright?: boolean;
  /** Test seam: replaces the real browser resolver. */
  playwrightDiscovery?: (
    options: PlaywrightDiscoveryOptions,
  ) => Promise<PlaywrightDiscoveryResult>;
}

/** Human readable summary of what the browser resolver observed. */
export function describePlaywrightOutcome(
  discovery: PlaywrightDiscoveryResult,
): string {
  switch (discovery.status) {
    case "review_url_exposed":
      return "Playwright: Google menyediakan URL ulasan langsung.";
    case "discovered_place_id":
      return "Playwright: Place ID resmi ditemukan dan diverifikasi.";
    case "dialog_only":
      return "Playwright: aksi ulasan Google membuka dialog internal tanpa URL yang bisa dipakai ulang.";
    case "sign_in_required":
      return "Playwright: Google meminta login, dan tidak ada Place ID yang terekspos.";
    case "blocked":
      return "Playwright: Google menampilkan verifikasi otomatis (CAPTCHA), percobaan dihentikan.";
    case "no_place_id":
      return "Playwright: halaman lokasi terbuka, tetapi Place ID tidak terekspos pada trafik Google.";
    case "busy":
      return "Playwright: resolver sedang sibuk, coba lagi sesaat lagi.";
    case "disabled":
      return "Playwright: resolver tidak tersedia di lingkungan ini.";
    default:
      return "Playwright: halaman lokasi tidak dapat dibuka.";
  }
}

function unsupportedResponse(parsed: ParsedMapsInput): ResolveResponse {
  return {
    status: "unsupported",
    reviewUrl: null,
    placeId: null,
    placeIdSource: null,
    resolvedUrl: parsed.url,
    identity: parsed.identity,
    candidates: [],
    mapsFallbackUrl: null,
    message: parsed.message,
    hint: parsed.hint,
  };
}

function successResponse(
  placeId: string,
  source: PlaceIdSource,
  resolvedUrl: string | null,
  identity: ResolveResponse["identity"],
  message: string,
  hint: string | null = null,
): ResolveResponse {
  return {
    status: "success",
    reviewUrl: buildReviewUrlFromPlaceId(placeId),
    placeId,
    placeIdSource: source,
    resolvedUrl,
    identity,
    candidates: [],
    mapsFallbackUrl: null,
    message,
    hint,
  };
}

/** Turns an identified-but-unresolved place into an honest response. */
function needsPlaceIdResponse(
  resolvedUrl: string | null,
  identity: ResolveResponse["identity"],
  reason: string,
  diagnostics: Pick<ResolveResponse, "placeTitle" | "reviewActionFound"> = {},
): ResolveResponse {
  return {
    status: "needs_place_id",
    reviewUrl: null,
    placeId: null,
    placeIdSource: null,
    resolvedUrl,
    identity,
    candidates: [],
    mapsFallbackUrl: buildMapsFallbackUrl(resolvedUrl, identity),
    message: "Lokasi ditemukan, tetapi Place ID resminya belum dapat dipastikan.",
    hint: reason,
    ...diagnostics,
  };
}

/**
 * Full pipeline for one user supplied link. Performs at most one redirect
 * resolution and (optionally) one Places API call.
 */
export async function resolveMapsLink(
  rawInput: string,
  options: ResolveOptions = {},
): Promise<ResolveResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = options.apiKey?.trim() ?? "";

  const parsed = parseMapsInput(rawInput);

  if (parsed.kind === "unsupported") {
    return unsupportedResponse(parsed);
  }

  // Already a review link or a Maps URL carrying a real Place ID: no network.
  if (parsed.reviewUrl && parsed.placeId) {
    return successResponse(
      parsed.placeId,
      "input-url",
      parsed.url,
      parsed.identity,
      "Place ID resmi ditemukan langsung di dalam link.",
    );
  }

  if (parsed.reviewUrl && !parsed.placeId) {
    // g.page review link: already usable, there is nothing to resolve.
    return {
      status: "success",
      reviewUrl: parsed.reviewUrl,
      placeId: null,
      placeIdSource: null,
      resolvedUrl: parsed.url,
      identity: parsed.identity,
      candidates: [],
      mapsFallbackUrl: null,
      message: "Link ulasan g.page resmi dikenali apa adanya.",
      hint: null,
    };
  }

  let resolvedUrl = parsed.url;
  let identity = parsed.identity;
  let placeId = parsed.placeId;
  let source: PlaceIdSource = placeId ? "input-url" : null;

  // Expand share links server side (browser CORS blocks reading the redirect).
  if (parsed.kind === "shortlink") {
    const resolution = await resolveRedirects(parsed.url as string, fetchImpl);

    if (!resolution.ok) {
      const reason =
        resolution.error === "network"
          ? "Layanan Google tidak dapat dihubungi saat ini."
          : "Link pendek tersebut tidak dapat dibuka (kemungkinan sudah kedaluwarsa atau salah ketik).";

      return {
        status: "unreachable",
        reviewUrl: null,
        placeId: null,
        placeIdSource: null,
        resolvedUrl: null,
        identity,
        candidates: [],
        mapsFallbackUrl: null,
        message: "Link pendek Google Maps gagal dibuka.",
        hint: reason,
      };
    }

    resolvedUrl = resolution.finalUrl;
    const reparsed = parseMapsInput(resolvedUrl as string);
    identity = reparsed.identity;
    placeId = reparsed.placeId;
    source = placeId ? "shortlink-destination" : null;
  }

  if (placeId) {
    return successResponse(
      placeId,
      source,
      resolvedUrl,
      identity,
      "Place ID resmi ditemukan pada URL tujuan Google Maps.",
    );
  }

  // Optional experimental step: capture a genuine Place ID from Google's own
  // browser traffic and verify it against the expected business name.
  let playwrightDiagnostics: Pick<ResolveResponse, "placeTitle" | "reviewActionFound"> = {};
  let playwrightHint: string | null = null;

  if (isPlaywrightResolverEnabled(options.enablePlaywright) && resolvedUrl) {
    const runDiscovery = options.playwrightDiscovery ?? discoverReviewUrlWithPlaywright;
    const discovery = await runDiscovery({
      placeUrl: resolvedUrl,
      expectedName: identity.name,
    });

    playwrightHint = describePlaywrightOutcome(discovery);
    playwrightDiagnostics = {
      placeTitle: discovery.placeTitle,
      reviewActionFound: discovery.reviewActionFound,
    };

    // Outcome A: Google handed us a reusable review URL. The URL is re-checked
    // here so a Maps place page can never be reported as a review URL.
    const observedReviewUrl = extractObservedReviewUrl(discovery.reviewUrl);
    if (discovery.status === "review_url_exposed" && observedReviewUrl) {
      return {
        status: "success",
        reviewUrl: observedReviewUrl,
        placeId: discovery.placeId,
        placeIdSource: "playwright",
        resolvedUrl,
        identity,
        candidates: [],
        mapsFallbackUrl: null,
        message: "Google menyediakan URL ulasan langsung dari halaman lokasi.",
        hint: null,
        ...playwrightDiagnostics,
      };
    }

    // Outcome B: a genuine Place ID, already verified against the name.
    if (
      discovery.status === "discovered_place_id" &&
      discovery.placeId &&
      discovery.reviewUrl &&
      discovery.nameVerified
    ) {
      return {
        ...successResponse(
          discovery.placeId,
          "playwright",
          resolvedUrl,
          identity,
          `Place ID resmi (${
            discovery.placeIdSource === "maps-rpc" ? "trafik Google Maps" : "status halaman"
          }) diverifikasi cocok dengan “${discovery.placeTitle ?? identity.name ?? "lokasi"}”.`,
        ),
        ...playwrightDiagnostics,
      };
    }
  }

  // No Place ID in the URL: the only reliable source left is the Places API.
  if (apiKey) {
    const lookup = await lookupPlaceId(
      apiKey,
      { name: identity.name, latitude: identity.latitude, longitude: identity.longitude },
      fetchImpl,
    );

    if (lookup.ok && lookup.candidates.length > 0) {
      const [best] = lookup.candidates;
      const confident =
        namesMatch(identity.name, best.name) &&
        (best.distanceMeters === null ||
          best.distanceMeters <= CONFIDENT_DISTANCE_METERS);

      if (confident) {
        return successResponse(
          best.placeId,
          "places-api",
          resolvedUrl,
          identity,
          "Place ID resmi dikonfirmasi melalui Google Places API.",
        );
      }

      return {
        status: "ambiguous",
        reviewUrl: null,
        placeId: null,
        placeIdSource: null,
        resolvedUrl,
        identity,
        candidates: lookup.candidates.slice(0, 3),
        mapsFallbackUrl: buildMapsFallbackUrl(resolvedUrl, identity),
        message: "Beberapa lokasi mirip ditemukan.",
        hint: "Pilih lokasi yang benar di bawah ini untuk membuat link ulasan.",
      };
    }
  }

  const reason = apiKey
    ? "Google Places API tidak mengembalikan hasil yang cukup pasti, sehingga Place ID tidak boleh ditebak. Pastikan kunci API aktif, atau tempel URL Google Maps panjang yang memuat parameter query_place_id."
    : "Link pendek Google Maps hanya menyimpan Feature ID/CID, bukan Place ID. Mengubahnya menjadi Place ID memerlukan Google Places API (gratis dalam kuota bulanan) atau URL Maps panjang yang sudah memuat query_place_id. URL pendek tidak bisa dikonversi secara andal tanpa salah satunya.";

  return needsPlaceIdResponse(
    resolvedUrl,
    identity,
    playwrightHint ? `${playwrightHint} ${reason}` : reason,
    playwrightDiagnostics,
  );
}
