const steps = [
  {
    title: "Tempel link Google Maps",
    description:
      "Ambil link lokasi bisnis Anda dari tombol Bagikan di Google Maps — link pendek maupun URL panjang sama-sama diterima.",
  },
  {
    title: "Aplikasi mencari Place ID resmi",
    description:
      "Link pendek dibuka di server untuk membaca lokasinya, lalu Place ID dicari dari Google: dari URL itu sendiri, atau lewat Google Places API bila kunci API tersedia.",
  },
  {
    title: "Salin atau buka link ulasan",
    description:
      "Link ulasan yang dihasilkan hanya dibuat dari Place ID resmi. Bila tidak ada, aplikasi berhenti dan menjelaskan alasannya.",
  },
] as const;

export function HowItWorks() {
  return (
    <section
      id="cara-kerja"
      aria-labelledby="cara-kerja-heading"
      className="scroll-mt-20 border-b border-border"
    >
      <div className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6 sm:py-16">
        <div className="flex flex-col gap-2">
          <h2
            id="cara-kerja-heading"
            className="text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            Cara Kerja
          </h2>
          <p className="text-sm text-muted-foreground sm:text-base">
            Tiga langkah, tanpa Place ID manual dan tanpa pendaftaran.
          </p>
        </div>

        <ol className="mt-8 grid gap-6 sm:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="flex flex-col gap-3">
              <span
                className="flex size-8 items-center justify-center rounded-full border border-border bg-muted text-sm font-medium"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <h3 className="text-sm font-medium">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
