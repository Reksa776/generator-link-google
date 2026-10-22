export interface CopyResult {
  ok: boolean;
  /** Which strategy succeeded, useful for tests and diagnostics. */
  strategy: "clipboard-api" | "exec-command" | "none";
  error?: string;
}

/**
 * Copies text to the clipboard.
 *
 * Uses the async Clipboard API when available (requires a secure context) and
 * falls back to a hidden textarea + `document.execCommand("copy")`, which still
 * works on older mobile browsers and over plain http.
 */
export async function copyToClipboard(text: string): Promise<CopyResult> {
  if (text.length === 0) {
    return { ok: false, strategy: "none", error: "Tidak ada teks untuk disalin." };
  }

  if (
    typeof navigator !== "undefined" &&
    typeof window !== "undefined" &&
    window.isSecureContext &&
    navigator.clipboard?.writeText
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true, strategy: "clipboard-api" };
    } catch (error) {
      // Permission denied or not focused: fall through to the legacy path.
      const fallback = copyWithExecCommand(text);
      if (fallback.ok) {
        return fallback;
      }
      return {
        ok: false,
        strategy: "none",
        error: error instanceof Error ? error.message : "Penyalinan ditolak browser.",
      };
    }
  }

  const fallback = copyWithExecCommand(text);
  if (fallback.ok) {
    return fallback;
  }

  return {
    ok: false,
    strategy: "none",
    error:
      fallback.error ??
      "Browser Anda memblokir akses clipboard. Silakan pilih teks pada kolom link lalu salin secara manual.",
  };
}

function copyWithExecCommand(text: string): CopyResult {
  if (typeof document === "undefined") {
    return { ok: false, strategy: "none", error: "Clipboard tidak tersedia." };
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);

  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const succeeded = document.execCommand("copy");
    return succeeded
      ? { ok: true, strategy: "exec-command" }
      : { ok: false, strategy: "none", error: "Perintah salin ditolak browser." };
  } catch (error) {
    return {
      ok: false,
      strategy: "none",
      error: error instanceof Error ? error.message : "Gagal menyalin teks.",
    };
  } finally {
    document.body.removeChild(textarea);
  }
}
