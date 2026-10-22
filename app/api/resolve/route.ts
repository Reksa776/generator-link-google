import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveMapsLink } from "@/lib/resolve";
import { MAX_INPUT_LENGTH } from "@/lib/maps-url";
import type { ResolveResponse } from "@/lib/resolve-types";

/**
 * The only server side endpoint of the application.
 *
 * It exists because browsers cannot read the redirect of `maps.app.goo.gl`
 * (no CORS headers, opaque redirects). It performs no Google API calls unless
 * `GOOGLE_MAPS_API_KEY` is configured, stores nothing, and only talks to hosts
 * from the Google allow-list.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  url: z
    .string({ message: "url harus berupa teks." })
    .trim()
    .min(1, { message: "url tidak boleh kosong." })
    .max(MAX_INPUT_LENGTH, {
      message: `url tidak boleh lebih dari ${MAX_INPUT_LENGTH} karakter.`,
    }),
});

/* ----------------------------- lightweight guards -------------------------- */

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 200;

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const resolutionCache = new Map<string, { expiresAt: number; value: ResolveResponse }>();

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "local";
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

function readCache(key: string): ResolveResponse | null {
  const entry = resolutionCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    resolutionCache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(key: string, value: ResolveResponse): void {
  if (resolutionCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = resolutionCache.keys().next();
    if (!oldest.done) resolutionCache.delete(oldest.value);
  }
  resolutionCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
}

function errorResponse(
  status: number,
  payload: Partial<ResolveResponse> & { message: string },
) {
  return NextResponse.json(
    {
      status: "unsupported",
      reviewUrl: null,
      placeId: null,
      placeIdSource: null,
      resolvedUrl: null,
      identity: {
        name: null,
        latitude: null,
        longitude: null,
        ftid: null,
        cid: null,
        featureId: null,
      },
      candidates: [],
      mapsFallbackUrl: null,
      hint: null,
      ...payload,
    } satisfies ResolveResponse,
    { status },
  );
}

export async function POST(request: Request) {
  if (isRateLimited(clientKey(request))) {
    return errorResponse(429, {
      message: "Terlalu banyak permintaan.",
      hint: "Tunggu satu menit lalu coba lagi.",
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, {
      message: "Body permintaan bukan JSON yang valid.",
    });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, {
      message: parsed.error.issues[0]?.message ?? "Input tidak valid.",
      hint: "Kirim JSON dengan bentuk { \"url\": \"https://maps.app.goo.gl/…\" }.",
    });
  }

  const inputUrl = parsed.data.url;
  const cached = readCache(inputUrl);
  if (cached) {
    return NextResponse.json(cached);
  }

  let result: ResolveResponse;
  try {
    result = await resolveMapsLink(inputUrl, {
      apiKey: process.env.GOOGLE_MAPS_API_KEY,
    });
  } catch {
    // Never leak internals to the client.
    return errorResponse(500, {
      message: "Terjadi kesalahan tak terduga saat memproses link.",
      hint: "Coba lagi sebentar lagi.",
    });
  }

  // Only cache outcomes that do not depend on a live API call.
  if (result.status === "success" || result.status === "unsupported") {
    writeCache(inputUrl, result);
  }

  return NextResponse.json(result);
}
