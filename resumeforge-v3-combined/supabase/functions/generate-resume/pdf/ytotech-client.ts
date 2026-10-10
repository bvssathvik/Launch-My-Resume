// ─────────────────────────────────────────
// ytotech-client.ts — LaTeX → PDF via YtoTech
// Free LaTeX compilation API
// Same pdflatex engine as Overleaf — identical output
// ─────────────────────────────────────────

const YTOTECH_URL = "https://latex.ytotech.com/builds/sync";

export interface PDFResult {
  success: boolean;
  pdfBase64: string | null;
  error?: string;
  fileSizeKB?: number;
}

export async function compileToPDF(latexCode: string): Promise<PDFResult> {
  try {
    const form = new FormData();
    form.append(
      "filecontents[]",
      new Blob([latexCode], { type: "text/plain" }),
      "resume.tex"
    );
    form.append("filename[]", "resume.tex");
    form.append("compiler", "pdflatex");
    form.append("return", "pdf");

    const res = await fetch(YTOTECH_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(90000), // 90s — the free compile farm is occasionally slow
      cache: "no-store",
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      return {
        success: false,
        pdfBase64: null,
        error: `YtoTech compilation failed: ${res.status} — ${errorText.slice(0, 200)}`,
      };
    }

    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);

    // Verify it's actually a PDF (starts with %PDF)
    if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
      return {
        success: false,
        pdfBase64: null,
        error: "YtoTech returned invalid PDF. LaTeX code may have errors.",
      };
    }

    // Convert to base64
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const fileSizeKB = Math.round(buf.byteLength / 1024);

    return {
      success: true,
      pdfBase64: base64,
      fileSizeKB,
    };

  } catch (err) {
    const message = err instanceof Error ? err.message : "PDF compilation failed";
    return {
      success: false,
      pdfBase64: null,
      error: message.includes("timeout")
        ? "PDF compilation timed out. YtoTech may be slow — try again or download LaTeX file."
        : message,
    };
  }
}
