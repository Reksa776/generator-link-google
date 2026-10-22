import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  {
    question: "Apakah saya perlu tahu Place ID bisnis saya?",
    answer:
      "Tidak. Cukup tempel link dari Google Maps. Aplikasi yang mencari Place ID resminya. Kolom Place ID manual sudah dihapus dari alur utama.",
  },
  {
    question: "Bagaimana cara mengambil link dari Google Maps?",
    answer:
      "Buka lokasi bisnis Anda di aplikasi atau situs Google Maps, tekan tombol Bagikan, lalu pilih Salin link. Hasilnya berupa link pendek seperti https://maps.app.goo.gl/HihE1JQdDmzBDCVC8. Tempel link itu di halaman ini.",
  },
  {
    question: "Kenapa link pendek saya kadang tidak bisa dikonversi?",
    answer:
      "Link pendek hanya menyimpan Feature ID/CID (0x…:0x…), bukan Place ID. Feature ID dan CID tidak bisa dipakai sebagai Place ID — memasangnya sebagai placeid akan membuat link ulasan yang rusak. Tanpa Google Places API, aplikasi tidak dapat memastikan Place ID resminya, dan memilih untuk berhenti daripada menebak.",
  },
  {
    question: "Lalu bagaimana supaya link pendek selalu berhasil?",
    answer:
      "Ada dua cara. Pertama, tempel URL Google Maps panjang yang memuat parameter query_place_id — Place ID di situ resmi dan langsung dipakai. Kedua, setel GOOGLE_MAPS_API_KEY di server agar aplikasi memakai Google Places API (Text Search) untuk mengambil Place ID resmi berdasarkan nama dan koordinat lokasi.",
  },
  {
    question: "Apakah aplikasi ini memakai Google Maps API berbayar?",
    answer:
      "Tidak secara bawaan. Tanpa API key, aplikasi hanya mengikuti pengalihan resmi Google (tanpa API). Bila Anda memasang kunci Places API sendiri, permintaan itu masuk ke kuota gratis bulanan Google untuk SKU tersebut; periksa halaman harga Google untuk angka terbaru.",
  },
  {
    question: "Apakah Place ID bisa dikarang oleh aplikasi ini?",
    answer:
      "Tidak. Place ID hanya dipakai bila Google sendiri menyertakannya di URL, atau bila Google Places API mengembalikannya. Bila tidak ada, aplikasi menampilkan penjelasan dan tidak membuat link ulasan.",
  },
  {
    question: "Kenapa Place ID dikonfirmasi dengan nama dan jarak?",
    answer:
      "Karena pencarian teks bisa mengembalikan beberapa bisnis serupa. Aplikasi hanya menerima hasil sebagai pasti bila nama lokasi cocok dan titiknya berjarak paling jauh 250 meter dari koordinat pada link. Jika tidak, Anda diminta memilih sendiri dari daftar kandidat.",
  },
  {
    question: "Apakah link pendek saya dikirim ke server?",
    answer:
      "Ya, link dikirim ke satu endpoint aplikasi ini (/api/resolve) hanya untuk mengikuti pengalihan Google dan membaca lokasinya, karena browser tidak bisa membaca pengalihan maps.app.goo.gl. Hasilnya tidak disimpan ke database, tidak ada akun, dan tidak ada analytics.",
  },
  {
    question: "Apakah link hasilnya bisa dipakai berkali-kali?",
    answer:
      "Bisa. Link yang dihasilkan bersifat tetap. Pelanggan tetap perlu masuk ke akun Google untuk menulis ulasan.",
  },
  {
    question: "Apakah alat ini membuat ulasan otomatis atau ulasan palsu?",
    answer:
      "Tidak. Alat ini hanya menyusun tautan. Tidak ada otomasi pengiriman ulasan dan tidak ada ulasan yang dibuat. Google juga dapat mengubah perilaku halaman ulasannya kapan saja.",
  },
] as const;

export function Faq() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="scroll-mt-20 border-b border-border"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-14 sm:px-6 sm:py-16">
        <div className="flex flex-col gap-2">
          <h2
            id="faq-heading"
            className="text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            Pertanyaan yang sering diajukan
          </h2>
          <p className="text-sm text-muted-foreground sm:text-base">
            Termasuk batasan konversi link pendek dan perbedaan Place ID dengan
            CID.
          </p>
        </div>

        <Accordion className="rounded-xl border border-border px-4 sm:px-5">
          {faqs.map((faq, index) => (
            <AccordionItem key={faq.question} value={`faq-${index}`}>
              <AccordionTrigger className="py-3.5 text-sm">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
