import { Coins, Lock, Wand2 } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { siteConfig } from "@/lib/site";
import { cn } from "@/lib/utils";

const highlights = [
  {
    icon: Wand2,
    title: "Tanpa Place ID manual",
    description:
      "Tempel link Google Maps saja. Aplikasi yang mencari Place ID resminya untuk Anda.",
  },
  {
    icon: Coins,
    title: "Gratis, tanpa langganan",
    description:
      "Tanpa login, tanpa database, dan tanpa batas jumlah link yang dibuat.",
  },
  {
    icon: Lock,
    title: "Tidak menyimpan data",
    description:
      "Link hanya dibaca untuk menemukan lokasinya. Tidak ada akun, riwayat, atau pelacakan.",
  },
] as const;

export function Hero() {
  return (
    <section className="border-b border-border bg-muted/30">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-4 py-14 text-center sm:px-6 sm:py-20">
        <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
          Link Maps apa pun · Tanpa Place ID manual · Gratis
        </span>

        <div className="flex flex-col gap-4">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl md:text-5xl">
            {siteConfig.tagline}
          </h1>
          <p className="text-base text-pretty text-muted-foreground sm:text-lg">
            Tempel link lokasi dari Google Maps — termasuk link pendek
            <span className="font-mono"> maps.app.goo.gl </span> — lalu dapatkan
            link ulasan Google yang bisa langsung dibagikan ke pelanggan.
          </p>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <a
            href="#generator"
            className={cn(buttonVariants({ size: "lg" }), "h-11 px-5 text-sm")}
          >
            Mulai Buat Link
          </a>
          <a
            href="#panduan"
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "h-11 px-5 text-sm",
            )}
          >
            Lihat Batasan &amp; Panduan
          </a>
        </div>

        <ul className="mt-2 grid w-full gap-4 text-left sm:grid-cols-3">
          {highlights.map((item) => (
            <li key={item.title} className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2 text-sm font-medium">
                <item.icon
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                {item.title}
              </span>
              <span className="text-xs text-muted-foreground">
                {item.description}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
