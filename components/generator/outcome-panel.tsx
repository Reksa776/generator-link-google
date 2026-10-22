"use client";

import {
  AlertTriangle,
  ExternalLink,
  HelpCircle,
  MapPin,
  Unplug,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import type { PlaceCandidate, ResolveResponse } from "@/lib/resolve-types";
import { cn } from "@/lib/utils";

const STATUS_STYLE = {
  ambiguous: { icon: HelpCircle, tone: "text-amber-600" },
  needs_place_id: { icon: MapPin, tone: "text-amber-600" },
  unreachable: { icon: Unplug, tone: "text-destructive" },
  unsupported: { icon: AlertTriangle, tone: "text-destructive" },
} as const;

export interface OutcomePanelProps {
  result: ResolveResponse;
  onSelectCandidate: (candidate: PlaceCandidate) => void;
}

export function OutcomePanel({ result, onSelectCandidate }: OutcomePanelProps) {
  const style = STATUS_STYLE[result.status as keyof typeof STATUS_STYLE];
  const Icon = style?.icon ?? AlertTriangle;
  const tone = style?.tone ?? "text-muted-foreground";

  const identityBits: string[] = [];
  if (result.identity.name) identityBits.push(result.identity.name);
  if (result.identity.latitude !== null && result.identity.longitude !== null) {
    identityBits.push(
      `${result.identity.latitude.toFixed(5)}, ${result.identity.longitude.toFixed(5)}`,
    );
  }
  if (result.identity.cid) identityBits.push(`CID ${result.identity.cid}`);

  return (
    <section
      aria-label="Hasil pemrosesan link"
      aria-live="polite"
      className="flex animate-in flex-col gap-4 duration-300 fade-in slide-in-from-bottom-2"
    >
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-base font-medium">
          <Icon className={cn("size-4", tone)} aria-hidden="true" />
          {result.status === "needs_place_id"
            ? "Place ID resmi belum bisa dipastikan"
            : result.status === "ambiguous"
              ? "Pilih lokasi yang benar"
              : result.status === "unreachable"
                ? "Link tidak dapat dibuka"
                : "Link belum didukung"}
        </h2>
        <p className="text-sm text-muted-foreground">{result.message}</p>
      </div>

      {identityBits.length > 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs font-medium">Lokasi yang terdeteksi</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
            {identityBits.map((bit) => (
              <li key={bit} className="break-all">
                {bit}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.candidates.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {result.candidates.map((candidate) => (
            <li key={candidate.placeId}>
              <button
                type="button"
                onClick={() => {
                  onSelectCandidate(candidate);
                }}
                className="w-full rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="block text-sm font-medium">{candidate.name}</span>
                {candidate.address ? (
                  <span className="block text-xs text-muted-foreground">
                    {candidate.address}
                  </span>
                ) : null}
                {candidate.distanceMeters !== null ? (
                  <span className="block text-xs text-muted-foreground">
                    ± {candidate.distanceMeters} m dari titik pada link
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {result.hint ? (
        <Alert className="bg-muted/40">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>{result.hint}</AlertDescription>
        </Alert>
      ) : null}

      {result.mapsFallbackUrl ? (
        <div className="flex flex-col gap-2">
          <a
            href={result.mapsFallbackUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full")}
          >
            <ExternalLink aria-hidden="true" />
            Buka lokasi di Google Maps
          </a>
          <p className="text-xs text-muted-foreground">
            Tombol di atas membuka <strong>halaman lokasi</strong>, bukan link
            ulasan. Dari sana Anda bisa menekan “Tulis ulasan” sendiri.
          </p>
        </div>
      ) : null}
    </section>
  );
}
