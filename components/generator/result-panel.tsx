"use client";

import { useRef } from "react";
import { toast } from "sonner";
import { CheckCircle2, Copy, ExternalLink, Info } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copyToClipboard } from "@/lib/clipboard";
import type { ResolveResponse } from "@/lib/resolve-types";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<string, string> = {
  "input-url": "Place ID resmi sudah ada di dalam link yang Anda tempel",
  "shortlink-destination": "Place ID resmi ditemukan pada URL tujuan Google Maps",
  "places-api": "Place ID resmi dikonfirmasi melalui Google Places API",
  playwright:
    "Place ID resmi diambil dari trafik Google Maps dan diverifikasi lewat nama lokasi",
};

export interface ResultPanelProps {
  result: ResolveResponse;
}

export function ResultPanel({ result }: ResultPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const reviewUrl = result.reviewUrl as string;

  async function handleCopy() {
    const outcome = await copyToClipboard(reviewUrl);

    if (outcome.ok) {
      toast.success("Link ulasan berhasil disalin.", {
        description: "Tempelkan link ini di WhatsApp, Instagram, atau media lain.",
      });
      return;
    }

    toast.error("Gagal menyalin link.", { description: outcome.error });
    // Help the user recover: select the text so a manual copy is one step away.
    inputRef.current?.focus();
    inputRef.current?.select();
  }

  return (
    <section
      aria-label="Hasil link ulasan"
      aria-live="polite"
      className="flex animate-in flex-col gap-4 duration-300 fade-in slide-in-from-bottom-2"
    >
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-base font-medium">
          <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
          Link ulasan Google siap dipakai
        </h2>
        <p className="text-sm text-muted-foreground">{result.message}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="generated-review-url">Link ulasan Google</Label>
        <Input
          id="generated-review-url"
          ref={inputRef}
          value={reviewUrl}
          readOnly
          spellCheck={false}
          className="h-11 font-mono text-xs md:text-sm"
          onFocus={(event) => {
            event.target.select();
          }}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="button" className="h-11" onClick={handleCopy}>
          <Copy aria-hidden="true" />
          Salin Link
        </Button>

        <a
          href={reviewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: "outline" }), "h-11")}
        >
          <ExternalLink aria-hidden="true" />
          Buka Link
        </a>
      </div>

      {result.placeId ? (
        <p className="text-xs text-muted-foreground">
          Place ID: <span className="font-mono break-all">{result.placeId}</span>
          {result.placeIdSource ? ` — ${SOURCE_LABEL[result.placeIdSource] ?? ""}` : ""}
        </p>
      ) : null}

      <Alert className="bg-muted/40">
        <Info aria-hidden="true" />
        <AlertDescription>
          Link ini membuka formulir ulasan Google. Pelanggan tetap perlu masuk ke
          akun Google untuk menulis ulasan.
        </AlertDescription>
      </Alert>
    </section>
  );
}
