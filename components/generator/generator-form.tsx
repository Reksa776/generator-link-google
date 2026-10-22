"use client";

import { useId } from "react";
import { AlertCircle, Loader2, Link2, RotateCcw, Wand2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface GeneratorFormProps {
  value: string;
  isLoading: boolean;
  /** Transport/validation error (not a domain outcome). */
  error: { message: string; hint: string | null } | null;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onReset: () => void;
}

export function GeneratorForm({
  value,
  isLoading,
  error,
  onValueChange,
  onSubmit,
  onReset,
}: GeneratorFormProps) {
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={fieldId}>Link Google Maps</Label>
        <Input
          id={fieldId}
          name="maps-url"
          value={value}
          onChange={(event) => {
            onValueChange(event.target.value);
          }}
          placeholder="https://maps.app.goo.gl/HihE1JQdDmzBDCVC8"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="h-11 text-base md:text-base"
          aria-invalid={error !== null}
          aria-describedby={hintId}
          disabled={isLoading}
          required
        />
        <p id={hintId} className="text-xs text-muted-foreground">
          Tempel link lokasi dari tombol <strong>Bagikan</strong> di Google Maps
          (link pendek <span className="font-mono">maps.app.goo.gl</span> atau URL
          panjang). Tidak perlu mencari Place ID sendiri.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive" className="border-destructive/40" aria-live="polite">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>{error.message}</AlertTitle>
          {error.hint ? <AlertDescription>{error.hint}</AlertDescription> : null}
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="submit"
          size="lg"
          className="h-11 flex-1 text-sm"
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Wand2 aria-hidden="true" />
          )}
          {isLoading ? "Memproses link…" : "Buat Link Ulasan"}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="h-11 sm:w-auto"
          onClick={onReset}
          disabled={isLoading}
        >
          <RotateCcw aria-hidden="true" />
          Reset
        </Button>
      </div>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Link2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Link hanya dipakai untuk membaca lokasinya. Tidak ada data yang disimpan,
        dan Place ID tidak pernah dikarang.
      </p>
    </form>
  );
}
