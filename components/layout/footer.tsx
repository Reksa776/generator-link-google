import { Star } from "lucide-react";

import { siteConfig } from "@/lib/site";

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Star className="size-4 text-muted-foreground" aria-hidden="true" />
            {siteConfig.name}
          </div>
          <p className="text-xs text-muted-foreground">
            Alat bantu pembuat link ulasan. Tidak terafiliasi dengan Google.
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          Semua proses berjalan di browser Anda. Tidak ada data yang dikirim ke
          server.
        </p>
      </div>
    </footer>
  );
}
