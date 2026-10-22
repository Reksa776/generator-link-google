import { AlertTriangle, CheckCircle2, ExternalLink, Info, XCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { siteConfig } from "@/lib/site";

const works = [
  "Link pendek dari tombol Bagikan di Google Maps (maps.app.goo.gl/…).",
  "URL Google Maps panjang yang memuat parameter query_place_id (Place ID resmi).",
  "URL Google Maps dengan bentuk place_id:ChIJ… — dibaca langsung tanpa permintaan tambahan.",
  "Link ulasan yang sudah jadi: search.google.com/local/writereview?placeid=… atau g.page/r/…/review.",
] as const;

const limits = [
  {
    title: "Link pendek tidak selalu bisa dikonversi",
    body: "Setelah link pendek dibuka, Google hanya memberi Feature ID / CID (contoh 0x2e6f1dfa0caae141:0x3b66fb4b842e1140) — bukan Place ID. CID dan Feature ID bukan Place ID dan tidak bisa dipakai sebagai Place ID. Tanpa Google Places API, Place ID resmi tidak dapat dipastikan, sehingga aplikasi menolak menebak.",
  },
  {
    title: "Aplikasi tidak pernah mengarang Place ID",
    body: "Jika Place ID resmi tidak ditemukan, permintaan berakhir dengan penjelasan dan tautan ke halaman lokasi. Tidak ada link ulasan yang dibuat dari tebakan.",
  },
  {
    title: "Untuk hasil 100% otomatis pada link pendek",
    body: "Setel GOOGLE_MAPS_API_KEY di server. Aplikasi akan memakai Google Places API (Text Search) untuk mengambil Place ID resmi, lalu mencocokkan nama dan koordinat lokasi. Kunci API bersifat opsional dan hanya dipakai di server.",
  },
] as const;

export function Guide() {
  return (
    <section
      id="panduan"
      aria-labelledby="panduan-heading"
      className="scroll-mt-20 border-b border-border bg-muted/30"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-14 sm:px-6 sm:py-16">
        <div className="flex flex-col gap-2">
          <h2
            id="panduan-heading"
            className="text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            Apa yang bisa dan tidak bisa dikonversi
          </h2>
          <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
            Halaman ini menjelaskan cara kerja konversi secara terbuka, termasuk
            batasan yang tidak bisa dihilangkan tanpa Google Places API.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <h3 className="flex items-center gap-2 text-base font-medium">
              <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
              Didukung penuh
            </h3>
            <ul className="flex flex-col gap-2">
              {works.map((item) => (
                <li
                  key={item}
                  className="rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground"
                >
                  {item}
                </li>
              ))}
            </ul>

            <Alert className="bg-background">
              <Info aria-hidden="true" />
              <AlertTitle>Yang tidak dibutuhkan</AlertTitle>
              <AlertDescription>
                Anda tidak perlu mencari Place ID sendiri, tidak perlu akun, dan
                tidak perlu kartu kredit.{" "}
                <a
                  href={siteConfig.placeIdFinderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline underline-offset-4"
                >
                  Place ID Finder Google
                  <ExternalLink className="ml-1 inline size-3" aria-hidden="true" />
                </a>{" "}
                hanya berguna bila Anda ingin memeriksa Place ID secara manual.
              </AlertDescription>
            </Alert>
          </div>

          <div className="flex flex-col gap-4">
            <h3 className="flex items-center gap-2 text-base font-medium">
              <XCircle className="size-4 text-amber-600" aria-hidden="true" />
              Batasan yang perlu diketahui
            </h3>
            <ul className="flex flex-col gap-3">
              {limits.map((limit) => (
                <li key={limit.title} className="rounded-lg border border-border bg-background p-3">
                  <p className="text-sm font-medium">{limit.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{limit.body}</p>
                </li>
              ))}
            </ul>

            <Alert className="bg-background">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>Perbedaan tiga identitas Google</AlertTitle>
              <AlertDescription>
                <ul className="flex list-disc flex-col gap-1 pl-4">
                  <li>
                    <strong>Place ID</strong> (ChIJ…): dipakai untuk link ulasan.
                  </li>
                  <li>
                    <strong>Feature ID / ftid</strong> (0x…:0x…): penanda lokasi di
                    URL Maps, bukan Place ID.
                  </li>
                  <li>
                    <strong>CID</strong>: angka yang diturunkan dari ftid, dipakai
                    untuk membuka halaman lokasi.
                  </li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>
        </div>
      </div>
    </section>
  );
}
