# ReviewLink Generator

Ubah **link Google Maps** menjadi **link ulasan Google** yang siap dibagikan ke pelanggan.

Anda cukup menempelkan link lokasi dari Google Maps — termasuk link pendek
`maps.app.goo.gl/…` dari tombol **Bagikan**. Tidak perlu mencari Place ID sendiri,
tidak perlu login, dan aplikasi **tidak pernah mengarang Place ID**.

- Semua halaman berupa konten statis/prerender; hanya satu endpoint server
  (`POST /api/resolve`) yang dinamis, karena browser tidak dapat membaca
  pengalihan `maps.app.goo.gl` (tidak ada header CORS, redirect bersifat opaque).
- Tanpa database, tanpa akun, tanpa analytics, tanpa cookie.
- Google Places API bersifat **opsional** (satu environment variable) dan hanya
  dipakai di server. Ada juga resolver browser (Playwright) yang opsional dan
  mati secara bawaan.

## Alur kerja

1. Pengguna menempel link Google Maps (link pendek atau URL panjang).
2. Server membuka link pendek dan mengikuti pengalihannya (maksimal 5 lompatan,
   hanya ke host Google).
3. Identitas lokasi diekstrak: nama, koordinat, Feature ID/CID.
4. Place ID resmi dicari dari sumber Google:
   - dari URL itu sendiri (`query_place_id`, `place_id:ChIJ…`, `?placeid=ChIJ…`), atau
   - dari **Google Places API** (Text Search) bila `GOOGLE_MAPS_API_KEY` disetel.
5. Bila Place ID resmi terkonfirmasi → link ulasan dibuat dan ditampilkan dengan
   tombol **Salin Link** dan **Buka Link**.
6. Bila tidak → aplikasi berhenti, menjelaskan alasannya, dan menampilkan tautan
   ke halaman lokasi (bukan link ulasan). **Tidak ada link ulasan yang dikarang.**

## Resolver Playwright (eksperimental, opsional)

Selain jalur dasar di atas, tersedia resolver browser yang dapat menemukan
**Place ID asli** tanpa Google Maps API key: Chromium membuka halaman lokasi,
menangkap Place ID dari trafik Google sendiri (`/maps/preview/place`), lalu
**memverifikasinya** dengan memuat `maps/place/?q=place_id:<id>` dan mencocokkan
nama lokasi. Hanya Place ID yang lolos verifikasi yang dipakai.

Aktifkan dengan `PLAYWRIGHT_RESOLVER_ENABLED=1` (default **mati**, karena berat),
lalu jalankan eksperimen live:

```bash
npm run test:resolver
```

Hasil terukur (5 lokasi, 16 Oktober 2026): **5/5 (100%)** link ulasan asli,
rata-rata **21,7 detik**, puncak **± 823 MB RSS** per resolusi, tanpa API key.
Detail lengkap, bukti screenshot, dan penilaian kesiapan produksi ada di
[`docs/PLAYWRIGHT-RESOLVER-REPORT.md`](docs/PLAYWRIGHT-RESOLVER-REPORT.md).

Ringkasan: browser memerlukan RAM ± 1 GB per resolusi, sehingga resolusi ini
**bukan** pilihan default dan tidak cocok untuk instance kecil.

## Hasil pengukuran nyata (jalur default, tanpa browser)

Diukur dengan `npm run test:integration` (link nyata, tanpa API key, resolver
Playwright mati sesuai konfigurasi bawaan):

| Jenis input | Lokasi terbaca | Link ulasan tanpa API key |
| --- | --- | --- |
| URL Maps panjang ber-`query_place_id` / `place_id:` | 2/2 (100%) | **2/2 (100%)** |
| Link pendek `maps.app.goo.gl/…` | 2/2 (100%) | **0/2 (0%)** — menjadi 2/2 dengan resolver Playwright aktif |

Ringkasnya: **link pendek dapat dibaca lokasinya, tetapi Place ID-nya tidak dapat
dipastikan tanpa Google Places API.** Semua link pendek yang diuji hanya membawa
Feature ID/CID (`0x…:0x…`), bukan Place ID. Dengan `GOOGLE_MAPS_API_KEY` disetel,
link pendek diproses lewat Places API dan hasilnya dipakai hanya jika nama dan
jarak lokasi cocok (≤ 250 m); jika tidak, aplikasi menampilkan daftar kandidat
untuk Anda pilih.

## Mengapa tidak semua link pendek bisa dikonversi

Ditemukan langsung dari respons Google (lihat `docs/IMPLEMENTATION-REPORT.md`
untuk bukti per perintah):

- `maps.app.goo.gl/…` → `302` ke `google.com/maps/place/…` yang hanya memuat
  `!1s0x…:0x…` (Feature ID/CID). **Tidak ada `ChIJ…`** di URL maupun HTML-nya.
- `place_id:0x…:0x…` membuat Google memperlakukannya sebagai pencarian teks dan
  mengembalikan **tidak ada hasil** → Feature ID/CID bukan Place ID.
- `search.google.com/local/writereview?cid=…` dan `?ludocid=…` → **HTTP 400**.
  Hanya `?placeid=<Place ID asli>` yang dipahami.
- `?placeid=<apa pun>` selalu mengalihkan ke halaman login Google, sehingga
  endpoint itu tidak bisa dipakai untuk memverifikasi Place ID.
- Halaman Google Maps dan halaman hasil pencarian Google yang diambil server
  tidak memuat satu pun token `ChIJ…`.

Google sendiri menyatakan bahwa *Place ID tool tidak dapat bekerja dengan short
link* dan menyarankan URL panjang. Aplikasi ini menutupi celah tersebut dengan
Places API opsional dan penanganan yang jujur saat Place ID tidak ada.

## Fitur

- Input tunggal: **link Google Maps** (link pendek maupun URL panjang).
- Resolver server-side yang aman (allow-list host per lompatan, timeout 8 detik,
  maksimal 5 pengalihan, tanpa membaca body, rate limit 20 permintaan/menit per IP,
  cache 10 menit untuk hasil yang tidak bergantung API).
- Hasil: URL ulasan + tombol **Salin Link** dan **Buka Link** (sesuai permintaan,
  tidak ada tombol lain).
- Penanganan jujur untuk: link tidak didukung, link mati/kedaluwarsa, lokasi
  ambigu (pilih kandidat), dan Place ID tidak dapat dipastikan.
- UI Indonesia, minimalis, responsif mulai 320px, aksesibel, dengan SEO lengkap.

## Teknologi

Next.js 16 (App Router) · TypeScript strict · Tailwind CSS v4 · shadcn/ui (Base UI) ·
Lucide React · Zod · sonner · npm. Pengujian memakai test runner bawaan Node dan
Chrome DevTools Protocol — tanpa framework test tambahan.

## Instalasi & menjalankan lokal

```bash
npm install
cp .env.example .env.local   # opsional: isi GOOGLE_MAPS_API_KEY
npm run dev                  # http://localhost:3000
```

## Build & menjalankan produksi

```bash
npm run build
npm run start                # server Node.js di port 3000
```

## Deploy

Aplikasi butuh runtime Node.js (bukan hosting statis murni) karena satu endpoint
server. Pilihan gratis yang umum:

| Platform | Build command | Start / output |
| --- | --- | --- |
| Vercel | `npm run build` | terdeteksi otomatis (Next.js) |
| Render / Railway / Fly.io | `npm run build` | `npm run start` |
| VPS + PM2/systemd | `npm run build` | `npm run start` (port 3000) |
| Cloudflare Workers | butuh adapter OpenNext | `@opennextjs/cloudflare` |

Environment variable saat deploy:

- `GOOGLE_MAPS_API_KEY` (opsional) — kunci Places API untuk konversi link pendek.
- `NEXT_PUBLIC_SITE_URL` (opsional) — domain Anda untuk metadata SEO.

Container/Nginx boleh menaruh cache di depan `/` (halaman statis), tetapi jangan
cache `POST /api/resolve`.

## Verifikasi & pengujian

```bash
npm run lint              # ESLint
npm run typecheck         # TypeScript strict
npm run build             # build produksi
npm test                  # 38 pengujian unit/kontrak (offline, cepat)
npm run verify            # lint + typecheck + build + test
npm run test:integration  # link Google Maps nyata, mengukur tingkat konversi
npm run test:resolver     # eksperimen live resolver Playwright (butuh browser)
npm run build && npm run test:e2e   # 28 pemeriksaan UI di headless Chrome
```

`npm run test:e2e` menjalankan `next start` sendiri lalu menguji alur nyata:
membuat link dari URL Maps ber-Place ID, menyalin ke clipboard, memeriksa tautan
buka, menolak input kosong/non-Google/`javascript:`, menangani link pendek tanpa
mengarang Place ID, dan memeriksa tata letak 320/375/768/1280px.

## Keamanan & privasi

- Allow-list host **per lompatan pengalihan** (`maps.app.goo.gl`, `google.com`,
  `maps.google.com`, `google.co.id`, `g.page`, `search.google.com`), sehingga link
  pendek berbahaya tidak bisa dijadikan proxy SSRF.
- Protokol hanya `http`/`https`; URL berkredensial, ber-spasi, atau > 2048 karakter ditolak.
- Body respons Google tidak pernah dibaca (hanya header), timeout 8 detik.
- Kunci API hanya ada di server dan tidak pernah dikirim ke browser.
- Tidak ada database, akun, cookie, atau analytics.
- Place ID tidak pernah dibuat-buat; hanya dipakai bila berasal dari Google.

## Batasan yang diketahui

1. Link pendek tidak menghasilkan link ulasan tanpa `GOOGLE_MAPS_API_KEY`
   (terukur 0/2 pada uji integrasi).
2. Path Places API dengan kunci API belum diuji terhadap API sungguhan di
   lingkungan ini (tidak ada kunci); jalur tersebut diuji terhadap respons tiru
   yang mengikuti skema resmi, dan wajib gagal-tertutup (tidak mengarang ID).
3. Perilaku `search.google.com/local/writereview` dan `g.page` ditentukan Google
   dan dapat berubah; pelanggan tetap perlu login Google.
4. Link pendek yang kedaluwarsa/dihapus tidak dapat dibuka (ditangani sebagai
   `unreachable`).
5. Rate limit bersifat per-instance dan disimpan di memori.
6. Di luar cakupan: QR code, autentikasi, database, pembayaran, analytics, otomasi ulasan.

## Catatan

ReviewLink Generator adalah alat independen dan **tidak terafiliasi dengan Google**.
Google, Google Maps, dan Google Review adalah merek milik Google LLC.

## Lisensi

MIT.
# generator-link-google
