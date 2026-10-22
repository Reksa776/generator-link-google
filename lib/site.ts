/** Static site metadata shared by the layout, the footer, and the docs. */
export const siteConfig = {
  name: "ReviewLink Generator",
  shortName: "ReviewLink",
  tagline: "Generator Link Google Review Gratis",
  description:
    "Tempel link Google Maps bisnis Anda — termasuk link pendek maps.app.goo.gl — dan dapatkan link ulasan Google siap dibagikan. Tanpa Place ID manual, tanpa login, dan tanpa mengarang Place ID.",
  /** Override with NEXT_PUBLIC_SITE_URL when deploying to your own domain. */
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://reviewlink-generator.example.com",
  locale: "id_ID",
  /** Official Google pages referenced by the UI (no key involved). */
  placeIdFinderUrl:
    "https://developers.google.com/maps/documentation/places/web-service/place-id",
  placesApiKeyUrl: "https://developers.google.com/maps/documentation/places/web-service/get-api-key",
} as const;
