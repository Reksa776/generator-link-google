/**
 * Google Maps URL parsing (pure, isomorphic: used by the client and the server
 * route handler, and unit tested directly).
 *
 * IMPORTANT IDENTIFIER RULES — verified against live Google responses:
 * - a Maps share link such as `maps.app.goo.gl/xxxx` redirects to a place URL
 *   that contains a **feature id / CID** (`!1s0x…:0x…`, `!16s/g/…`), never a
 *   Place ID;
 * - a feature id / CID is NOT a Place ID. Passing `0x…:0x…` to
 *   `?place_id:` makes Google treat it as a text query and return nothing;
 * - `search.google.com/local/writereview` rejects `?cid=` and `?ludocid=`
 *   with HTTP 400 and only understands `?placeid=<real place id>`.
 *
 * Therefore we NEVER synthesise a Place ID. We only ever pass through a Place ID
 * that Google itself put in the URL, or one returned by the Places API.
 */

/** Host of the share/short link service. */
export const SHORTLINK_HOST = "maps.app.goo.gl";

/** Hosts that may appear in a redirect chain we are willing to follow. */
export const NAVIGATION_HOSTS = [
  "maps.app.goo.gl",
  "www.google.com",
  "google.com",
  "maps.google.com",
  "search.google.com",
  "g.page",
  "www.g.page",
] as const;

/** Place ID query parameters Google uses across its surfaces. */
export const PLACE_ID_PARAMS = [
  "query_place_id",
  "place_id",
  "placeid",
  "destination_place_id",
] as const;

export const PLACE_ID_MIN_LENGTH = 10;
export const PLACE_ID_MAX_LENGTH = 255;
export const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
/** A Place ID token as it appears inside a URL (Google's own prefix). */
const PLACE_ID_TOKEN_PATTERN = /ChIJ[A-Za-z0-9_-]{10,}/;
export const MAX_INPUT_LENGTH = 2048;

export type MapsInputKind =
  | "review-link" // already a direct review link (writereview)
  | "g-page-review" // g.page/r/<token>/review
  | "place-id" // a Maps URL that already embeds a real Place ID
  | "shortlink" // maps.app.goo.gl — needs server side resolution
  | "maps-url" // a full Maps URL without a Place ID (needs resolution + lookup)
  | "unsupported";

export interface PlaceIdentity {
  /** Business/location name taken from `/maps/place/<name>/`. */
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  /** `0x…:0x…` feature id from `!1s`. */
  ftid: string | null;
  /** Decimal CID derived from the `0x…` half of the feature id. */
  cid: string | null;
  /** `/g/…` style feature id from `!16s`. */
  featureId: string | null;
}

export interface ParsedMapsInput {
  kind: MapsInputKind;
  /** Normalised input URL (null for unsupported input). */
  url: string | null;
  /** A Place ID that Google already put in the input, if any. */
  placeId: string | null;
  /** Present when the input is already a usable review link. */
  reviewUrl: string | null;
  identity: PlaceIdentity;
  reason: string | null;
  message: string;
  hint: string | null;
}

const EMPTY_IDENTITY: PlaceIdentity = {
  name: null,
  latitude: null,
  longitude: null,
  ftid: null,
  cid: null,
  featureId: null,
};

/** Removes control characters, zero-width characters and wrapping quotes. */
export function sanitizeInput(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .trim()
    .replace(/^[<"'\s]+/, "")
    .replace(/[>"'\s]+$/, "");
}

/** Format check only; a Place ID that passes here may still not exist. */
export function isValidPlaceIdFormat(value: string): boolean {
  return (
    value.length >= PLACE_ID_MIN_LENGTH &&
    value.length <= PLACE_ID_MAX_LENGTH &&
    PLACE_ID_PATTERN.test(value)
  );
}

/**
 * Hosts we are willing to talk to. Google uses many country domains
 * (`google.co.id`, `google.com.au`, …) so we validate the shape instead of
 * listing every TLD, while still rejecting look-alikes such as
 * `google.com.evil.example`.
 */
export function isAllowedGoogleHost(host: string): boolean {
  const normalised = host.toLowerCase().replace(/\.$/, "");

  if ((NAVIGATION_HOSTS as readonly string[]).includes(normalised)) {
    return true;
  }

  return /^(www\.|maps\.|maps2\.)?google\.[a-z]{2,4}(\.[a-z]{2,4})?$/.test(normalised);
}

function isShortlinkHost(host: string): boolean {
  return host.toLowerCase() === SHORTLINK_HOST;
}

/** True for hosts/paths that mean "a Google Maps page". */
function isMapsPath(pathname: string): boolean {
  return pathname === "/maps" || pathname.startsWith("/maps/");
}

export function extractPlaceIdFromValue(value: string | null): string | null {
  if (!value) return null;

  const withoutPrefix = value.trim().replace(/^place_id:/i, "").trim();
  return isValidPlaceIdFormat(withoutPrefix) ? withoutPrefix : null;
}

/**
 * Finds a Place ID that Google explicitly embedded in the URL. Returns null when
 * the URL only carries a feature id / CID — those must not be treated as a
 * Place ID.
 */
export function extractEmbeddedPlaceId(url: URL): string | null {
  for (const param of PLACE_ID_PARAMS) {
    const direct = extractPlaceIdFromValue(url.searchParams.get(param));
    if (direct) return direct;
  }

  for (const param of ["q", "query", "destination", "daddr"]) {
    const candidate = url.searchParams.get(param);
    if (candidate && /^place_id:/i.test(candidate)) {
      const extracted = extractPlaceIdFromValue(candidate);
      if (extracted) return extracted;
    }
  }

  // Last resort: a `ChIJ…` token anywhere in the URL (some share surfaces embed
  // the Place ID in a path segment or in the `data=` blob).
  const token = PLACE_ID_TOKEN_PATTERN.exec(decodeURIComponent(url.href));
  if (token && isValidPlaceIdFormat(token[0])) {
    return token[0];
  }

  return null;
}

/** Pulls the display identity out of a full Maps place URL. */
export function extractPlaceIdentity(url: URL): PlaceIdentity {
  const href = url.href;
  const decodedPath = decodeURIComponent(url.pathname);

  const nameMatch = /\/maps\/place\/([^/@]+)/.exec(decodedPath);
  const coordMatch = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(href);
  const ftidMatch = /!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/.exec(href);
  const featureIdMatch = /!16s(?:%2F|\/)(g(?:\/|%2F)[A-Za-z0-9_-]+)/.exec(href);
  const dataCoordMatch = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(href);

  const latitude = dataCoordMatch
    ? Number(dataCoordMatch[1])
    : coordMatch
      ? Number(coordMatch[1])
      : null;
  const longitude = dataCoordMatch
    ? Number(dataCoordMatch[2])
    : coordMatch
      ? Number(coordMatch[2])
      : null;

  const ftid = ftidMatch ? ftidMatch[1] : null;
  const cid = ftid && ftid.includes(":") ? hexToDecimal(ftid.split(":")[1]) : null;

  return {
    name: nameMatch ? nameMatch[1].replace(/\+/g, " ").trim() || null : null,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    ftid,
    cid,
    featureId: featureIdMatch ? `/${featureIdMatch[1].replace(/%2F/gi, "/")}` : null,
  };
}

function hexToDecimal(hex: string): string | null {
  try {
    return BigInt(hex).toString();
  } catch {
    return null;
  }
}

/** Canonical Maps URL we hand back when no review link can be produced. */
export function buildMapsFallbackUrl(
  resolvedUrl: string | null,
  identity: PlaceIdentity,
): string | null {
  if (identity.cid) {
    return `https://www.google.com/maps?cid=${identity.cid}`;
  }
  return resolvedUrl;
}

function unsupported(
  reason: string,
  message: string,
  hint: string,
): ParsedMapsInput {
  return {
    kind: "unsupported",
    url: null,
    placeId: null,
    reviewUrl: null,
    identity: EMPTY_IDENTITY,
    reason,
    message,
    hint,
  };
}

/**
 * Classifies a user supplied string. This never performs network requests: a
 * `maps.app.goo.gl` input is only marked as needing server side resolution.
 */
export function parseMapsInput(raw: string): ParsedMapsInput {
  const value = sanitizeInput(raw);

  if (value.length === 0) {
    return unsupported(
      "empty",
      "Link Google Maps belum diisi.",
      "Tempelkan link lokasi dari aplikasi atau situs Google Maps.",
    );
  }

  if (value.length > MAX_INPUT_LENGTH) {
    return unsupported(
      "too_long",
      "Link yang dimasukkan terlalu panjang.",
      `Maksimal ${MAX_INPUT_LENGTH} karakter.`,
    );
  }

  if (/\s/.test(value)) {
    return unsupported(
      "contains_whitespace",
      "Link mengandung spasi atau baris baru.",
      "Pastikan hanya URL-nya saja yang ditempel, tanpa teks tambahan.",
    );
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(value) === false) {
    return unsupported(
      "missing_protocol",
      "Link harus dimulai dengan https://",
      "Contoh: https://maps.app.goo.gl/HihE1JQdDmzBDCVC8",
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return unsupported(
      "invalid_url",
      "Link tidak dapat dibaca sebagai URL yang valid.",
      "Periksa kembali link Anda.",
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return unsupported(
      "unsupported_protocol",
      "Hanya link http atau https yang didukung.",
      "Skema seperti javascript:, data:, atau file: tidak diizinkan.",
    );
  }

  if (url.username !== "" || url.password !== "") {
    return unsupported(
      "credentials",
      "Link tidak boleh memuat kredensial.",
      "Hapus bagian “user:pass@” pada link.",
    );
  }

  const host = url.hostname.toLowerCase();

  if (!isAllowedGoogleHost(host)) {
    return unsupported(
      "unsupported_host",
      "Link tersebut bukan link Google yang didukung.",
      "Gunakan link dari maps.app.goo.gl, google.com/maps, maps.google.com, search.google.com, atau g.page.",
    );
  }

  // --- Already a direct review link ------------------------------------------
  if (host === "search.google.com") {
    const placeId = extractEmbeddedPlaceId(url);
    const isWriteReview = url.pathname.replace(/\/+$/, "") === "/local/writereview";

    if (!isWriteReview) {
      return unsupported(
        "unsupported_review_path",
        "Halaman Google tersebut bukan link ulasan.",
        "Gunakan https://search.google.com/local/writereview?placeid=<Place ID>.",
      );
    }

    if (!placeId) {
      return unsupported(
        "missing_place_id",
        "Link ulasan tersebut tidak memuat Place ID yang valid.",
        "Pastikan parameter placeid berisi Place ID dari Google.",
      );
    }

    return {
      kind: "review-link",
      url: url.href,
      placeId,
      reviewUrl: buildReviewUrlFromPlaceId(placeId),
      identity: extractPlaceIdentity(url),
      reason: null,
      message: "Link ulasan Google langsung dikenali.",
      hint: null,
    };
  }

  if (host === "g.page" || host === "www.g.page") {
    const match = /^\/r\/([A-Za-z0-9_-]+)\/review\/?$/.exec(url.pathname);

    if (!match) {
      return unsupported(
        "unsupported_review_path",
        "Format link g.page tersebut belum didukung.",
        "Format yang didukung: https://g.page/r/<kode>/review.",
      );
    }

    return {
      kind: "g-page-review",
      url: url.href,
      placeId: null,
      reviewUrl: `https://g.page/r/${match[1]}/review`,
      identity: extractPlaceIdentity(url),
      reason: null,
      message: "Link ulasan g.page dikenali.",
      hint: null,
    };
  }

  // --- Share link that needs server side resolution --------------------------
  if (isShortlinkHost(host)) {
    return {
      kind: "shortlink",
      url: url.href,
      placeId: null,
      reviewUrl: null,
      identity: EMPTY_IDENTITY,
      reason: null,
      message: "Link pendek Google Maps dikenali.",
      hint: null,
    };
  }

  // --- Full Maps URL --------------------------------------------------------
  if (!isMapsPath(url.pathname)) {
    return unsupported(
      "not_a_maps_url",
      "Link tersebut bukan link lokasi Google Maps.",
      "Tempelkan link dari Google Maps (tombol Bagikan), misalnya https://maps.app.goo.gl/…",
    );
  }

  const placeId = extractEmbeddedPlaceId(url);

  return {
    kind: placeId ? "place-id" : "maps-url",
    url: url.href,
    placeId,
    reviewUrl: placeId ? buildReviewUrlFromPlaceId(placeId) : null,
    identity: extractPlaceIdentity(url),
    reason: null,
    message: placeId
      ? "Link Maps memuat Place ID resmi."
      : "Link Maps dikenali, tetapi belum memuat Place ID.",
    hint: null,
  };
}

/** Builds the official review URL. The Place ID is passed through untouched. */
export function buildReviewUrlFromPlaceId(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}

/** True when a resolved URL still belongs to an allowed Google host. */
export function isAllowedResolvedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      isAllowedGoogleHost(url.hostname)
    );
  } catch {
    return false;
  }
}
