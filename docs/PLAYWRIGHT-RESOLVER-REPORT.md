# Playwright Resolver Report — Browser Based Google Review URL Discovery

Tanggal: 16 Oktober 2026
Verdict: **GO (terukur)** — 5/5 lokasi uji menghasilkan link ulasan Google asli, terverifikasi, tanpa Google Maps API key.

Dokumen ini berdiri sendiri. Laporan sebelumnya (`docs/IMPLEMENTATION-REPORT.md`) tidak diubah isinya.

---

## 1. Ringkasan eksekutif

| Metrik | Hasil terukur |
| --- | --- |
| Lokasi diuji dengan browser sungguhan | 5 |
| Place ID asli yang berhasil diverifikasi | **5/5 (100%)** |
| Link ulasan asli dari pipeline produksi | **5/5 (100%)** |
| Rata-rata waktu resolusi (end-to-end) | **21,7 detik** |
| Waktu rata-rata di dalam browser | 20,7 detik |
| Google Maps API key yang dipakai | **0** (tidak ada) |
| Place ID yang dikarang | **0** |
| Ulasan/rating yang dikirim | **0** (tidak pernah) |
| Login Google yang dicoba dilewati | **0** |

Temuan inti: ketika Google Maps dibuka di browser sungguhan, Google sendiri
mengirim **Place ID asli** (`ChIJ…`) pada RPC internalnya
(`https://www.google.com/maps/preview/place`). Place ID itu dapat ditangkap,
lalu **diverifikasi** dengan memuat `maps/place/?q=place_id:<id>` dan
membandingkan judul halaman dengan nama lokasi. Hanya Place ID yang lolos
verifikasi yang dipakai untuk membentuk link ulasan.

---

## 2. Arsitektur

Urutan resolver yang dipakai (sesuai permintaan, tidak berubah dari fase sebelumnya):

```
POST /api/resolve
  1. Parser URL         → lib/maps-url.ts            (tanpa jaringan)
  2. Resolver shortlink → lib/resolve.ts             (pengalihan Google, allow-list)
  3. Place ID eksplisit → lib/maps-url.ts            (query_place_id / place_id: / placeid=)
  4. Playwright         → lib/playwright-resolver.ts (BARU — eksperimental, default OFF)
  5. Places API         → lib/resolve.ts             (hanya bila GOOGLE_MAPS_API_KEY diisi)
```

- Playwright **tidak pernah** dipanggil dari komponen klien. Modulnya server-only
  dan di-`import()` secara dinamis, sehingga Chromium tidak dimuat kecuali
  resolver diaktifkan (`serverExternalPackages: ["playwright", "playwright-core"]`).
- Kontrak respons API tidak berubah: hanya bertambah nilai baru pada
  `placeIdSource` (`"playwright"`) dan dua field diagnostik opsional
  (`placeTitle`, `reviewActionFound`).
- Semua lapisan lama tetap utuh: parser, resolver shortlink, validasi Zod,
  rate limit 20/menit, cache, dan proteksi SSRF.

### Perubahan file

| File | Perubahan |
| --- | --- |
| `lib/playwright-resolver.ts` | **Baru** — resolver browser (klasifikasi A–E, verifikasi nama, allow-list, batas waktu, cleanup). |
| `lib/resolve.ts` | Menambahkan langkah Playwright di rantai fallback + validasi ulang URL hasil + diagnostik. |
| `lib/resolve-types.ts` | Menambah sumber Place ID `"playwright"` dan dua field diagnostik opsional. |
| `components/generator/result-panel.tsx` | Label sumber untuk Place ID dari Playwright. |
| `next.config.ts` | `serverExternalPackages` untuk Playwright. |
| `tests/playwright-resolver.test.ts` | **Baru** — 9 pengujian offline (guard + wiring). |
| `tests/experiments/playwright-resolver.test.ts` | **Baru** — eksperimen live 5 lokasi + screenshot. |
| `.env.example` | Variabel Playwright. |

Tidak ada QR code, database, autentikasi, payment gateway, admin dashboard, atau
Google Maps API yang ditambahkan.

---

## 3. Cara kerja resolver

1. **Konteks terisolasi**: satu `BrowserContext` baru per permintaan
   (`locale: id-ID`, `timezoneId: Asia/Jakarta`, `permissions: []`,
   `acceptDownloads: false`, `serviceWorkers: "block"`).
2. **Navigasi dibatasi**: setiap permintaan melewati `context.route()`. Hanya
   host Google dan shortener resminya yang diizinkan
   (`google.<tld>`, `gstatic.com`, `googleapis.com`, `googleusercontent.com`,
   `ggpht.com`, `goo.gl`, `g.co`, `g.page`). `localhost`, alamat IP privat
   (`127.0.0.1`, `10.x`, `169.254.169.254`, `::1`), serta host mirip seperti
   `google.com.evil.example` ditolak sebelum keluar jaringan.
3. **Penghematan sumber daya**: permintaan gambar, media, dan font dibatalkan;
   hanya respons Maps/JSON yang body-nya dibaca (batas 3 MB).
4. **Penangkapan Place ID**: token `ChIJ…` dikumpulkan dari respons Google, dengan
   pemindaian DOM sebagai cadangan. Token CID (`0x…:0x…`) dan angka CID **tidak
   pernah** dianggap Place ID.
5. **Inspeksi aksi ulasan**: kontrol ulasan dicari dengan locator semantik
   (`getByRole` + nama "tulis ulasan"/"write a review"), lalu `aria-label`, dan
   terakhir atribut penanda Google. Klik hanya untuk **mengamati**; tidak ada
   ulasan, rating, atau isi apa pun yang dikirim.
6. **Verifikasi**: Place ID dimuat lewat `https://www.google.com/maps/place/?q=place_id:<id>`.
   Link ulasan hanya dipakai bila halaman itu benar-benar menjadi halaman
   `/maps/place/` **dan** judulnya cocok dengan nama lokasi (normalisasi
   diakritik, ambang kemiripan 0,6).
7. **Cleanup**: `context.close()` selalu dipanggil di blok `finally`, termasuk
   saat error. Browser bersama ditutup pada SIGTERM/SIGINT/`beforeExit`.

### Klasifikasi hasil (sesuai permintaan)

| Kode | Kondisi | Perilaku |
| --- | --- | --- |
| **A** `review_url_exposed` | Google mengirim URL ulasan langsung | Dipakai setelah validasi pola (writereview/g.page) |
| **B** `discovered_place_id` | Place ID asli ditemukan + lolos verifikasi nama | Link dibentuk dari Place ID itu |
| **C** `dialog_only` | Aksi ulasan hanya membuka dialog internal | Tidak ada URL → status `needs_place_id` |
| **D** `sign_in_required` | Google meminta login | Dicatat, tidak ada upaya bypass |
| **E** `blocked` | CAPTCHA/verifikasi otomatis | Percobaan dihentikan dengan tenang |

Yang **tidak pernah** dilakukan: mengarang Place ID, mengubah CID → Place ID,
mengarang URL ulasan, mengembalikan halaman Maps sebagai link ulasan, atau
menganggap HTTP 200 sebagai bukti sukses.

---

## 4. Observasi browser nyata (eksperimen live)

Perintah: `npm run test:resolver` (menjalankan `resolveMapsLink` dengan resolver
aktif, lalu `discoverReviewUrlWithPlaywright` untuk observasi detail).

| # | Input | Tujuan setelah resolusi | Nama terdeteksi | Aksi ulasan | Place ID (asal) | URL ulasan | Login? | Status akhir | Waktu |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `maps.app.goo.gl/HihE1JQdDmzBDCVC8` | `google.com/maps/place/Universitas Islam Negeri Siber Syekh Nurjati Cirebon (UINSSC)/…!1s0x2e6f1dfa0caae141:0x3b66fb4b842e1140…` | Universitas Islam Negeri Siber Syekh Nurjati Cirebon (UINSSC) | ditemukan + diklik | `ChIJQeGqDPodby4RQBEuhEv7Zjs` (trafik Maps) | `search.google.com/local/writereview?placeid=ChIJQeGqDPodby4RQBEuhEv7Zjs` | ya | `success` / `discovered_place_id` | 21,0 s |
| 2 | `maps.app.goo.gl/PTQskqTRvSa6RnYY7` | `google.com/maps/place/Thea+Suites+Potidea,…!1s0x14a87fad5b2d1273:0xee8efce9b4d10ec2…` | Thea Suites Potidea | ditemukan + diklik | `ChIJcxItW61_qBQRwg7RtOn8ju4` (trafik Maps) | `…writereview?placeid=ChIJcxItW61_qBQRwg7RtOn8ju4` | ya | `success` / `discovered_place_id` | 28,8 s |
| 3 | `google.com/maps/place/Starbucks+GI/@…!1s0x2e69f42066e78fe5:0x3fd2d2e4310b3ac6…` | halaman lokasi yang sama | Starbucks GI | ditemukan + diklik | `ChIJ5Y_nZiD0aS4RxjoLMeTS0j8` (trafik Maps) | `…writereview?placeid=ChIJ5Y_nZiD0aS4RxjoLMeTS0j8` | ya | `success` / `discovered_place_id` | 18,6 s |
| 4 | `google.com/maps/place/Monumen+Nasional/@…!1s0x2e69f5d2e764b12d:0x3d2ad6e1e0e9bcc8…` | halaman lokasi yang sama | Monumen Nasional | ditemukan + diklik | `ChIJLbFk59L1aS4RyLzp4OHWKj0` (trafik Maps) | `…writereview?placeid=ChIJLbFk59L1aS4RyLzp4OHWKj0` | ya | `success` / `discovered_place_id` | 18,5 s |
| 5 | `google.com/maps/place/Candi+Borobudur/@…!1s0x2e7a8cf009a7d697:0xdd34334744dc3cb…` | halaman lokasi yang sama | Candi Borobudur | ditemukan + diklik | `ChIJl9anCfCMei4Ry8NNdDRD0w0` (trafik Maps) | `…writereview?placeid=ChIJl9anCfCMei4Ry8NNdDRD0w0` | ya | `success` / `discovered_place_id` | 21,6 s |

Bukti tambahan:

- **Place ID ≠ CID.** Untuk lokasi #1, CID adalah `0x3b66fb4b842e1140`
  (desimal `4280384797620965696`) sedangkan Place ID dari Google adalah
  `ChIJQeGqDPodby4RQBEuhEv7Zjs`. Keduanya berbeda dan hanya Place ID yang dipakai.
- **Kontrol negatif.** Memuat `maps/place/?q=place_id:0x2e6f1dfa0caae141:0x3b66fb4b842e1140`
  (CID) membuat Google mengalihkannya ke URL pencarian
  `maps/search/place_id:0x…` dengan judul literal "place_id:0x…" dan **tanpa hasil** —
  bukti CID tidak setara Place ID, dan bukti metode verifikasi kami menolaknya.
- **Perilaku aksi ulasan.** Pada semua 5 lokasi, tombol "Tulis ulasan" **ditemukan**
  dan diklik; Google membuka dialog internal dan/atau mengarahkan ke alur login.
  Tidak ada URL ulasan yang disediakan langsung oleh Google pada sesi ini, jadi
  tidak ada satu pun hasil yang masuk kategori A. Semua keberhasilan berasal dari
  kategori B (Place ID asli + verifikasi nama).

### Screenshot (bukti visual)

| Lokasi | Berkas |
| --- | --- |
| Universitas (shortlink permintaan) | `docs/evidence/playwright/given-shortlink.png` |
| Hotel Yunani | `docs/evidence/playwright/hotel-shortlink.png` |
| Starbucks GI | `docs/evidence/playwright/starbucks.png` |
| Monumen Nasional | `docs/evidence/playwright/monas.png` |
| Candi Borobudur | `docs/evidence/playwright/borobudur.png` |

Screenshot dibuat oleh resolver sendiri (`screenshotPath`) pada saat halaman
lokasi sudah dimuat, sebelum aksi ulasan diklik.

### Catatan koreksi pengukuran (transparansi)

Percobaan pertama melaporkan 2/5. Penyebabnya bukan resolver, melainkan
**input yang saya potong sendiri**: dua URL uji diambil dari hasil pencarian Maps
tetapi saya hilangkan segmen `!16s`/`g_ep` di belakangnya, sehingga Google tidak
menghidrasi halaman lokasinya. Setelah URL dipakai utuh (persis seperti yang
dihasilkan Google), lima dari lima lokasi berhasil. Angka lama dan penyebabnya
dicatat di sini agar tidak terlihat seperti klaim tanpa dasar.

Temuan sampingan yang tetap berlaku: URL Maps yang hanya berisi nama seperti
`google.com/maps/place/Monas/` **bukan** halaman lokasi — Google mengalihkannya
ke `maps/place//@lat,lng,10z` (jalur kosong) dan menampilkan UI pencarian umum.
Input seperti itu dilaporkan `needs_place_id`, bukan dipaksa menjadi sukses.

---

## 5. Konsumsi sumber daya (terukur)

Diukur dengan sampel RSS seluruh proses Chromium (`ps -eo rss`) setiap 400 ms,
dimulai dari kondisi tanpa browser.

| Fase | RSS total | Proses |
| --- | --- | --- |
| Sebelum launch | 0 MB | 0 |
| Setelah `chromium.launch()` (363 ms) | 282 MB | 6 |
| Puncak selama satu resolusi | **823 MB** | 7 |
| Setelah `context.close()` | 424 MB | — |
| Setelah `browser.close()` | **0 MB** | 0 |

- Starter browser: ± 282 MB (tetap hidup karena browser dipakai ulang).
- Puncak per resolusi: ± 823 MB total (≈ 540 MB di atas baseline).
- Tidak ada kebocoran: setelah konteks ditutup, memori turun kembali dan tidak ada
  proses Chromium tersisa.
- Waktu: 11–29 detik per resolusi (rata-rata 20,7 detik di dalam browser).
- Jejak disk: paket npm `playwright` + `playwright-core` = 19 MB, cache browser
  Chromium (`~/.cache/ms-playwright`) = **681 MB** (Chromium 156.0.8078.4,
  Playwright 1.64.1, Node.js 24.21.0). Pada deploy berbasis image, browser harus
  diinstal lewat `npx playwright install chromium --with-deps` saat build.

Strategi penghematan yang diterapkan: browser dipakai ulang (singleton),
konteks terisolasi per permintaan, konkurensi dibatasi
(`PLAYWRIGHT_MAX_CONCURRENCY`, default 1, kelebihan permintaan dijawab
`busy`), gambar/media/font dibatalkan, body respons besar tidak dibaca,
`context` selalu ditutup, dan hasil sukses di-cache di endpoint (10 menit).

---

## 6. Keamanan

Dipertahankan dari fase sebelumnya: allow-list host input, proteksi SSRF pada
pengalihan (setiap lompatan divalidasi), batas 5 pengalihan, timeout 8 detik,
rate limit 20 permintaan/menit per IP, tanpa kredensial di URL, dan tanpa
rahasia di klien.

Tambahan khusus browser:

- Dua lapis allow-list: satu untuk `fetch` pengalihan, satu untuk navigasi browser
  (`isAllowedBrowserHost`, diuji untuk menolak localhost, IP privat/link-local,
  `metadata.google.internal`, dan host mirip Google).
- `permissions: []` (tanpa kamera, lokasi, clipboard), `acceptDownloads: false`,
  service worker diblokir, dan skema selain `http(s)` dibatalkan di level route.
- Batas waktu bertingkat: navigasi 25 s, settle 7 s, aksi 5 s, verifikasi 20 s.
- Konteks selalu ditutup di `finally`; browser ditutup pada sinyal proses.
- **Tidak** memakai stealth plugin, proxy berotasi, atau bypass CAPTCHA. Bila
  Google menampilkan CAPTCHA, hasilnya `blocked` dan percobaan berhenti.
- `--no-sandbox` dipakai karena environment container; ini melonggarkan isolasi
  proses Chromium dan **wajib dipertimbangkan ulang** di produksi
  (sandbox bisa diaktifkan bila host mendukung user namespace).

Pengujian: 9 pengujian offline baru (`tests/playwright-resolver.test.ts`)
mencakup allow-list host, penolakan URL Maps sebagai link ulasan, pengumpulan
token Place ID (dan penolakan CID), flag enable, pemanggilan yang tidak terjadi
saat nonaktif, penerimaan Place ID terverifikasi, **penolakan Place ID yang tidak
terverifikasi**, penolakan halaman Maps sebagai link ulasan, dan penerusan
diagnostik.

Dua bug asli ditemukan oleh pengujian ini dan diperbaiki di kode (bukan di tes):

1. `maps.app.goo.gl` (dan `goo.gl`/`g.co`) **ditolak** oleh allow-list browser,
   sehingga navigasi ke shortlink bisa gagal. Kini diizinkan.
2. Jalur sukses Playwright menghilangkan diagnostik (`placeTitle`,
   `reviewActionFound`). Kini diteruskan.

---

## 7. Kesiapan produksi

**Penilaian: layak sebagai resolver eksperimental opsional, belum untuk dijadikan bawaan.**

Alasan:

1. **Biaya sumber daya nyata**: ± 820 MB puncak RSS per resolusi dan 11–29 detik
   latensi. Untuk instance 512 MB (umum pada paket gratis) ini **tidak layak**;
   butuh setidaknya ± 1 GB RAM dan CPU 1–2 core per resolusi bersamaan.
2. **Ketergantungan pada perilaku internal Google**: Place ID dibaca dari RPC
   internal Maps (`/maps/preview/place`). Google dapat mengubahnya kapan saja
   tanpa pemberitahuan. Karena itu verifikasi nama tetap diwajibkan, dan bila
   Place ID tidak ditemukan, sistem mengembalikan status belum terselesaikan alih-alih
   menebak.
3. **Kepatuhan & ToS**: otomatisasi browser terhadap Google berpotensi melanggar
   persyaratan layanan Google. Implementasi ini sengaja konservatif (tanpa login,
   tanpa CAPTCHA bypass, tanpa proxy, tanpa stealth, tanpa pengiriman konten),
   tetapi keputusan memakai di produksi harus mempertimbangkan risiko tersebut.
4. **Default aman**: resolver **mati secara bawaan**
   (`PLAYWRIGHT_RESOLVER_ENABLED=0`). Alur lama tetap menjadi jalur produksi.
   Mengaktifkannya bersifat sadar dan tercatat.

Saran operasional bila diaktifkan: satu worker khusus, `PLAYWRIGHT_MAX_CONCURRENCY=1`,
cache lebih panjang di depan endpoint, batas waktu total ± 60 s, dan pemantauan
jumlah proses Chromium agar tidak menumpuk.

---

## 8. Batasan yang diketahui

1. URL yang hanya berisi nama (mis. `/maps/place/Monas/`) bukan halaman lokasi →
   dilaporkan `needs_place_id`.
2. Halaman hasil pencarian (mis. `/maps/search/?api=1&query=…`) tidak dipilihkan
   otomatis; pengguna harus membuka lokasi spesifik lebih dulu.
3. Aksi "Tulis ulasan" pada sesi tanpa login selalu berujung pada dialog
   internal/alur login; Google tidak mengekspos URL ulasan yang bisa dipakai ulang
   pada sesi ini (kategori C/D). Place ID tetap diperoleh, dan link dibentuk dari
   Place ID itu.
4. Verifikasi nama bergantung pada judul halaman; lokasi dengan nama sangat mirip
   di alamat yang sama dapat membuat verifikasi ambigu (hasilnya
   `needs_place_id`, bukan tebakan).
5. Perilaku Google dapat berubah dan menyebabkan `no_place_id`, `blocked`, atau
   `sign_in_required`. Semua kondisi tersebut ditangani tanpa mengarang data.
6. Jalur Places API (bila kunci diisi) tetap belum diuji terhadap API sungguhan.

---

## 9. Verifikasi

| Perintah | Hasil |
| --- | --- |
| `npm run lint` | 0 error, 0 warning |
| `npm run typecheck` | 0 error |
| `npm run build` | sukses (`/` statis, `/api/resolve` dinamis) |
| `npm test` | **47/47 lulus** (38 sebelumnya + 9 baru) |
| `npm run test:integration` | 2/2 lulus (konfigurasi bawaan: resolver mati) |
| `npm run test:e2e` | 28/28 lulus |
| `npm run test:resolver` | eksperimen live: **5/5 (100%)**, rata-rata 21,7 s |

Catatan: `npm run test:integration` sengaja dijalankan dengan resolver Playwright
**mati** (konfigurasi bawaan), sehingga masih mengukur jalur keyless tanpa
browser. Pengukuran dengan resolver aktif ada di `npm run test:resolver`.
