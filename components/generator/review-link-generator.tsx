"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

import { GeneratorForm } from "@/components/generator/generator-form";
import { OutcomePanel } from "@/components/generator/outcome-panel";
import { ResultPanel } from "@/components/generator/result-panel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PlaceCandidate, ResolveResponse } from "@/lib/resolve-types";

type TransportError = { message: string; hint: string | null };

export function ReviewLinkGenerator() {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<ResolveResponse | null>(null);
  const [error, setError] = useState<TransportError | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleValueChange = useCallback((next: string) => {
    setValue(next);
    // The displayed outcome must always belong to the current input.
    setResult(null);
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    const url = value.trim();

    if (url.length === 0) {
      setResult(null);
      setError({
        message: "Link Google Maps belum diisi.",
        hint: "Tempel link lokasi dari tombol Bagikan di aplikasi Google Maps.",
      });
      toast.error("Link Google Maps belum diisi.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const payload = (await response.json()) as ResolveResponse;

      if (!response.ok && response.status !== 429) {
        setError({
          message: payload.message ?? "Permintaan gagal diproses.",
          hint: payload.hint ?? null,
        });
        toast.error(payload.message ?? "Permintaan gagal diproses.");
        return;
      }

      setResult(payload);

      if (payload.status === "success") {
        toast.success("Link ulasan Google berhasil dibuat.", {
          description: "Salin atau buka link lewat tombol di bawah.",
        });
      } else if (payload.status === "unsupported" || payload.status === "unreachable") {
        toast.error(payload.message, { description: payload.hint ?? undefined });
      } else {
        toast.warning(payload.message, { description: payload.hint ?? undefined });
      }
    } catch {
      const message = "Tidak dapat menghubungi server aplikasi.";
      setError({
        message,
        hint: "Periksa koneksi Anda lalu coba lagi.",
      });
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [value]);

  const handleReset = useCallback(() => {
    setValue("");
    setResult(null);
    setError(null);
  }, []);

  /** Choosing a candidate from an ambiguous result produces the review link. */
  const handleSelectCandidate = useCallback((candidate: PlaceCandidate) => {
    setResult({
      status: "success",
      reviewUrl: candidate.reviewUrl,
      placeId: candidate.placeId,
      placeIdSource: "places-api",
      resolvedUrl: null,
      identity: {
        name: candidate.name,
        latitude: null,
        longitude: null,
        ftid: null,
        cid: null,
        featureId: null,
      },
      candidates: [],
      mapsFallbackUrl: null,
      message: `Link dibuat untuk “${candidate.name}”.`,
      hint: null,
    });
    setError(null);
    toast.success("Link ulasan Google berhasil dibuat.");
  }, []);

  return (
    <div id="generator" className="flex w-full scroll-mt-20 flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Ubah link Google Maps menjadi link ulasan</CardTitle>
          <CardDescription>
            Tempel link lokasi dari Google Maps, lalu tekan “Buat Link Ulasan”.
            Place ID dicari otomatis.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GeneratorForm
            value={value}
            isLoading={isLoading}
            error={error}
            onValueChange={handleValueChange}
            onSubmit={() => {
              void handleSubmit();
            }}
            onReset={handleReset}
          />
        </CardContent>
      </Card>

      {result && result.status === "success" && result.reviewUrl ? (
        <Card>
          <CardContent>
            <ResultPanel result={result} />
          </CardContent>
        </Card>
      ) : null}

      {result && result.status !== "success" ? (
        <Card>
          <CardContent>
            <OutcomePanel result={result} onSelectCandidate={handleSelectCandidate} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
