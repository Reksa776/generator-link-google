# Implementation Report — Google Maps Link → Google Review Link Converter

Tanggal: 16 Oktober 2026
Status: **Selesai dan terverifikasi** (lint, typecheck, build, 38 unit test, 2 uji integrasi live, 28 pemeriksaan E2E di browser).

## 1. Apa yang berubah dari iterasi sebelumnya

Iterasi sebelumnya meminta pengguna mengetik **Place ID** sendiri. Itu keliru:
alur utama sekarang adalah **menempel link Google Maps**, dan aplikasi yang
mencari Place ID resminya. Kolom Place ID manual dihapus, tombol berbagi WhatsApp
dihapus (permintaan: tampilkan hanya URL dengan tombol Salin dan Buka), dan
arsitektur static export diganti menjadi runtime Next.js dengan satu endpoint
server karena resolusi link pendek tidak mungkin dilakukan di browser.

| Sebelum | Sekarang |
| --- | --- |
| Input: Place ID / link ulasan | Input: link Google Maps (pendek atau panjang) |
| `output: "export"` (statis penuh) | Runtime Node.js + `POST /api/resolve` |
| Place ID wajib diketahui pengguna | Place ID dicari otomatis |
| Tombol salin/buka/WhatsApp | Hanya Salin + Buka |
| Klaim "tanpa API key" | Klaim jujur: tanpa key link pendek tidak bisa dikonversi |

## 2. Temuan teknis (dibuktikan, bukan diasumsikan)

Semua diuji langsung terhadap Google pada 16 Oktober 2026:

| Percobaan | Hasil |
| --- | --- |
| `maps.app.goo.gl/HihE1JQdDmzBDCVC8` (GET) | `302` → `google.com/maps/place/…/data=!…!1s0x2e6f1dfa0caae141:0x3b66fb4b842e1140…!16s%2Fg%2F121n4817` |
| Token `ChIJ…` pada URL tujuan & HTML-nya | **0 token** (hanya Feature ID/CID) |
| `maps.app.goo.gl/PTQskqTRvSa6RnYY7` | `302` → hanya `0x14a87fad5b2d1273:0xee8efce9b4d10ec2` |
| `maps.app.goo.gl/TdfCviQ5TwAdmyUt5` | tidak mengalihkan (link mati) → harus ditangani |
| `search.google.com/local/writereview?cid=<desimal>` | **HTTP 400** |
| `search.google.com/local/writereview?ludocid=<desimal>` | **HTTP 400** |
| `search.google.com/local/writereview?placeid=0x…:0x…` | dialihkan ke login Google (tidak ada sinyal validitas) |
| `maps/place/?q=place_id:0x…:0x…` di browser | Google memperlakukannya sebagai pencarian teks → **tidak ada hasil** |
| HTML Google Maps / hasil pencarian Google (server) | **0 token `ChIJ…`** |
| `maps.app.goo.gl/?link=https://example.com` (open redirect) | **HTTP 400**, tidak mengalihkan (vektor SSRF tetap ditutup berlapis) |

Kesimpulan: **Feature ID/CID bukan Place ID.** Place ID hanya bisa didapat dari
URL yang memang memuatnya atau dari Google Places API — itulah yang diterapkan.

## 3. Fitur yang diselesaikan

### Endpoint server `POST /api/resolve`

- Validasi Zod (`{ url }`, maksimal 2048 karakter).
- Rate limit 20 permintaan/menit per IP (in-memory) dan cache 10 menit untuk hasil
  yang tidak bergantung API.
- Pengikutan pengalihan manual: maksimal 5 lompatan, timeout 8 detik,
  **allow-list host diperiksa di setiap lompatan**, body respons tidak pernah dibaca.
- Place ID hanya diambil dari: URL input, URL tujuan, atau Google Places API (Text Search)
  dengan pencocokan nama + jarak ≤ 250 m.
- Status yang dikembalikan: `success`, `ambiguous`, `needs_place_id`, `unsupported`, `unreachable`.
  Tidak ada jalur yang menghasilkan link ulasan tanpa Place ID resmi.

### Antarmuka

- Satu input: link Google Maps, dengan petunjuk tombol Bagikan.
- Indikator "Memproses link…" saat resolusi berjalan.
- Hasil sukses: URL ulasan + **Salin Link** + **Buka Link** saja, plus satu baris
  kecil yang menyebut Place ID dan dari mana ia diperoleh.
- Status jujur: non-Google/di luar cakupan, link mati, Place ID tidak dapat
  dipastikan (menampilkan nama + koordinat + CID yang terdeteksi serta tautan ke
  halaman lokasi), dan daftar kandidat saat lokasi ambigu.
- Bagian "Apa yang bisa dan tidak bisa dikonversi" serta FAQ menjelaskan
  perbedaan Place ID / Feature ID / CID secara terbuka.

## 4. Struktur file

```
app/
  page.tsx, layout.tsx, globals.css, icon.svg
  api/resolve/route.ts        # satu-satunya endpoint dinamis
components/
  generator/  review-link-generator.tsx, generator-form.tsx,
              result-panel.tsx, outcome-panel.tsx
  layout/     navbar.tsx, footer.tsx
  sections/   hero.tsx, how-it-works.tsx, guide.tsx, faq.tsx
  ui/         accordion, alert, button, card, input, label, sonner, tabs (shadcn/ui)
lib/
  maps-url.ts        # parsing/klasifikasi URL Maps (murni, diuji langsung)
  resolve.ts         # resolver pengalihan + Places API (server)
  resolve-types.ts   # tipe respons bersama klien/server
  clipboard.ts, site.ts, utils.ts
tests/
  maps-url.test.ts, resolve.test.ts, clipboard.test.ts
  integration/maps-live.test.ts
scripts/e2e-check.mjs
docs/IMPLEMENTATION-REPORT.md
```

## 5. Hasil verifikasi

| Pemeriksaan | Perintah | Hasil |
| --- | --- | --- |
| Lint | `npm run lint` | 0 error, 0 warning |
| Type checking | `npm run typecheck` | 0 error |
| Build | `npm run build` | sukses; `/` statis, `/api/resolve` dinamis |
| Unit/kontrak | `npm test` | **38/38 lulus** |
| Integrasi live | `npm run test:integration` | **2/2 lulus**, angka konversi terukur |
| E2E browser | `npm run test:e2e` | **28/28 lulus** |

### Tingkat konversi terukur (link nyata)

```
[integration] URL panjang dengan Place ID: 2/2 berhasil (tanpa API key)
[integration] hasil per link pendek:
  - https://maps.app.goo.gl/HihE1JQdDmzBDCVC8 → lokasi terbaca
    (Universitas Islam Negeri Siber Syekh Nurjati Cirebon (UINSSC)),
    Place ID tidak dapat dipastikan
  - https://maps.app.goo.gl/PTQskqTRvSa6RnYY7 → lokasi terbaca
    (Thea Suites Potidea, Νέα Προποντίδα 632 00), Place ID tidak dapat dipastikan
[integration] tingkat pembacaan lokasi: 2/2; link ulasan tanpa API key: 0/2
```

Ringkasan: **pembacaan lokasi 100%, konversi link pendek menjadi link ulasan 0%
tanpa Places API, dan 100% untuk URL yang sudah memuat Place ID.** Satu link pendek
keempat yang diuji kedaluwarsa dan ditangani sebagai `unreachable`.

Jalur Places API (dengan `GOOGLE_MAPS_API_KEY`) **tidak diuji terhadap API
sungguhan** karena tidak ada kunci di lingkungan ini. Jalur tersebut diuji terhadap
respons tiru yang mengikuti skema resmi, termasuk kasus ambigu (kandidat jauh /
nama berbeda) dan kegagalan HTTP 403 → hasilnya `needs_place_id`, bukan ID karangan.

### Skenario unit test

- Klasifikasi input: link pendek, URL hasil resolusi (hanya ftid), URL dengan
  `query_place_id` / `place_id:`, `writereview`, `g.page`, dan 10 bentuk ditolak
  (host non-Google, look-alike, `javascript:`, `data:`, kredensial, tanpa skema, kosong, dst.).
- Bukti eksplisit bahwa Feature ID/CID **tidak** dipromosikan menjadi Place ID.
- Allow-list host: menerima domain negara Google, menolak `google.com.evil.example`,
  `maps.app.goo.gl.evil.example`, `127.0.0.1`, `localhost`.
- `resolveRedirects`: rantai normal, keluar allow-list, host awal non-Google,
  terlalu banyak pengalihan (6), kegagalan jaringan, link mati.
- Orkestrasi: sukses dari link tempel **tanpa permintaan jaringan**, sukses dari URL
  tujuan, `needs_place_id` dengan CID, `unreachable`, blokir SSRF (169.254.169.254
  tidak pernah diambil), penolakan URL non-Google.
- Places API: pencocokan nama+jarak → sukses; kandidat jauh → ambigu dengan pilihan
  pengguna; HTTP 403 → `needs_place_id`; header `x-goog-api-key` + field mask dikirim;
  tanpa nama → menolak mencari.
- Clipboard: Clipboard API, fallback `execCommand`, kegagalan ganda, error dilempar.

## 6. Catatan implementasi & keamanan

- **SSRF**: setiap lompatan pengalihan divalidasi sebelum diambil; body tidak dibaca;
  timeout dan batas lompatan diterapkan. Uji unit memastikan IP metadata cloud tidak
  pernah dihubungi meskipun shortlink mengarah ke sana.
- **Tanpa karangan**: Place ID divalidasi formatnya dan hanya berasal dari Google;
  status non-`success` selalu bersifat "tidak ada URL ulasan".
- **Statis mayoritas**: hanya `/api/resolve` yang dinamis, sisanya prerender,
  sehingga biaya server sangat kecil.
- **Batas**: rate limit dan cache disimpan di memori per instance.

## 7. Batasan yang diketahui

1. Konversi link pendek tanpa `GOOGLE_MAPS_API_KEY` tidak dimungkinkan secara andal
   (terukur 0/2). Tidak ada API publik gratis tanpa kunci yang bisa mengubah
   Feature ID/CID menjadi Place ID.
2. Jalur Places API belum diverifikasi terhadap API sungguhan; perlu kunci API dan
   mengikuti kuota gratis Google (periksa halaman harga Google untuk angka terbaru).
3. Pencocokan Places API memakai nama + jarak; untuk lokasi bertingkat dalam satu
   gedung hasilnya bisa ambigu, sehingga pengguna diminta memilih.
4. Perilaku halaman ulasan Google dapat berubah kapan saja.
5. Bukan hosting statis murni lagi; butuh runtime Node.js.
6. Di luar cakupan: QR code, autentikasi, database, pembayaran, analytics, otomasi ulasan.
