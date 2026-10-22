import type { PlaceIdentity } from "./maps-url";

/**
 * Outcome of the server side resolution. Shared by the API route (producer) and
 * the React components (consumer), so it lives in its own module to keep the
 * server implementation out of the client bundle.
 */
export type ResolveStatus =
  /** A review link was produced from a real Place ID. */
  | "success"
  /** The Places API returned several plausible businesses. */
  | "ambiguous"
  /** The location was identified but no Place ID could be confirmed. */
  | "needs_place_id"
  /** The input is not a supported Google Maps link. */
  | "unsupported"
  /** The short link could not be resolved (dead link / network problem). */
  | "unreachable";

/** Where the Place ID came from. Never synthesised. */
export type PlaceIdSource =
  | "input-url"
  | "shortlink-destination"
  | "places-api"
  /** Captured from Google's own browser traffic and verified against the name. */
  | "playwright"
  | null;

export interface PlaceCandidate {
  placeId: string;
  name: string;
  address: string | null;
  distanceMeters: number | null;
  /** Ready to use review URL for this candidate. */
  reviewUrl: string;
}

export interface ResolveResponse {
  status: ResolveStatus;
  /** Present only when status === "success". */
  reviewUrl: string | null;
  placeId: string | null;
  placeIdSource: PlaceIdSource;
  /** Canonical Maps URL after following redirects, when available. */
  resolvedUrl: string | null;
  identity: PlaceIdentity;
  candidates: PlaceCandidate[];
  /**
   * A Maps link to the place we identified. This is NOT a review link and is
   * only offered when no review link could be produced.
   */
  mapsFallbackUrl: string | null;
  message: string;
  hint: string | null;
  /** Diagnostics from the (optional) Playwright resolver. */
  placeTitle?: string | null;
  reviewActionFound?: boolean;
}
