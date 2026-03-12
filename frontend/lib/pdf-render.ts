/**
 * PDF rendering utility using pdfjs-dist (legacy build, worker disabled).
 *
 * Strategy:
 * - Use `pdfjs-dist/legacy/build/pdf` for maximum compatibility (no ESM issues)
 * - Set `disableWorker: true` to avoid Web Worker path resolution failures in Next.js
 * - Dynamic import so this code only runs in the browser (no SSR crash)
 *
 * Exported functions:
 *   renderPdfPageToDataUrl(pdfBytes, scale) → Promise<string>  (PNG data URL)
 */

export async function renderPdfPageToDataUrl(
  pdfBytes: ArrayBuffer,
  scale: number = 2
): Promise<string> {
  // Dynamic import — runs only client-side
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf");

  // Disable the worker entirely: avoids all worker path/CORS issues in Next.js
  pdfjsLib.GlobalWorkerOptions.workerSrc = "";
  // @ts-ignore — legacy build exposes this flag
  if (pdfjsLib.GlobalWorkerOptions) {
    try {
      // Force inline/fake worker (disableWorker=true equivalent for legacy)
      // @ts-ignore
      pdfjsLib.GlobalWorkerOptions.workerSrc = "";
    } catch (_) { console.warn("PDF.js worker init failed:", _); }
  }

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBytes),
    // Disable worker to avoid path resolution failures
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  });

  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);

  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context");

  // White background (PDFs are transparent by default on canvas)
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: ctx,
    viewport,
  }).promise;

  return canvas.toDataURL("image/png");
}

/**
 * Crop a PNG data URL using canvas.
 * cropPct: { x, y, width, height } in percentage of the full image (0–100).
 * Returns a new PNG data URL.
 */
export async function cropDataUrl(
  dataUrl: string,
  cropPct: { x: number; y: number; width: number; height: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const naturalW = img.naturalWidth;
      const naturalH = img.naturalHeight;

      const cropX = (cropPct.x / 100) * naturalW;
      const cropY = (cropPct.y / 100) * naturalH;
      const cropW = (cropPct.width / 100) * naturalW;
      const cropH = (cropPct.height / 100) * naturalH;

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(cropW);
      canvas.height = Math.round(cropH);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Failed to load image for cropping"));
    img.src = dataUrl;
  });
}
