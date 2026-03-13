/**
 * pattern-match.ts
 *
 * Client-side template matching engine using Normalized Cross-Correlation (NCC).
 * Works 100% in the browser (Canvas API) — zero backend dependency.
 *
 * Usage:
 *   1. Extract full image + template crop as ImageData via Canvas
 *   2. Call matchTemplate(fullImage, templateImage, opts)
 *   3. Returns MatchResult[] with normalized coordinates (0-1)
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface MatchResult {
  /** top-left x, normalized 0-1 */
  x_norm: number;
  /** top-left y, normalized 0-1 */
  y_norm: number;
  /** width, normalized 0-1 */
  w_norm: number;
  /** height, normalized 0-1 */
  h_norm: number;
  /** correlation score 0-1 */
  score: number;
}

export interface MatchOptions {
  /** Minimum correlation score (0-1). Default 0.70 */
  threshold?: number;
  /** Pixel stride for scanning (higher = faster, less precise). Default 2 */
  stride?: number;
  /** Max results returned. Default 50 */
  maxResults?: number;
  /** IoU threshold for NMS dedup. Default 0.3 */
  nmsIou?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Convert RGBA ImageData to grayscale Float32Array (luminosity) */
function toGrayscale(data: ImageData): Float32Array {
  const { width, height, data: px } = data;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const r = px[i * 4];
    const g = px[i * 4 + 1];
    const b = px[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return gray;
}

/** Compute mean of a Float32Array */
function mean(arr: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}

/** Compute standard deviation of a Float32Array given its mean */
function std(arr: Float32Array, m: number): number {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - m;
    sum += d * d;
  }
  return Math.sqrt(sum / arr.length);
}

/** Intersection over Union for two rects (normalized coords) */
function iou(
  a: MatchResult,
  b: MatchResult,
): number {
  const x1 = Math.max(a.x_norm, b.x_norm);
  const y1 = Math.max(a.y_norm, b.y_norm);
  const x2 = Math.min(a.x_norm + a.w_norm, b.x_norm + b.w_norm);
  const y2 = Math.min(a.y_norm + a.h_norm, b.y_norm + b.h_norm);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter === 0) return 0;
  const areaA = a.w_norm * a.h_norm;
  const areaB = b.w_norm * b.h_norm;
  return inter / (areaA + areaB - inter);
}

/** Non-Maximum Suppression: keep best non-overlapping matches */
function nms(matches: MatchResult[], iouThreshold: number): MatchResult[] {
  const sorted = [...matches].sort((a, b) => b.score - a.score);
  const kept: MatchResult[] = [];
  const suppressed = new Set<number>();

  for (let i = 0; i < sorted.length; i++) {
    if (suppressed.has(i)) continue;
    kept.push(sorted[i]);
    for (let j = i + 1; j < sorted.length; j++) {
      if (!suppressed.has(j) && iou(sorted[i], sorted[j]) > iouThreshold) {
        suppressed.add(j);
      }
    }
  }
  return kept;
}

// ── Main matching function ──────────────────────────────────────────────────

/**
 * Template matching via Normalized Cross-Correlation (NCC).
 *
 * @param fullImage  - ImageData of the full plan image
 * @param template   - ImageData of the selected template crop
 * @param opts       - Matching options
 * @returns Array of MatchResult sorted by score descending
 */
export function matchTemplate(
  fullImage: ImageData,
  template: ImageData,
  opts?: MatchOptions,
): MatchResult[] {
  const threshold = opts?.threshold ?? 0.70;
  const stride = opts?.stride ?? 2;
  const maxResults = opts?.maxResults ?? 50;
  const nmsIou = opts?.nmsIou ?? 0.3;

  const imgW = fullImage.width;
  const imgH = fullImage.height;
  const tplW = template.width;
  const tplH = template.height;

  // Bail if template is larger than image
  if (tplW >= imgW || tplH >= imgH) return [];

  // Convert to grayscale
  const imgGray = toGrayscale(fullImage);
  const tplGray = toGrayscale(template);

  // Pre-compute template stats
  const tplMean = mean(tplGray);
  const tplStd = std(tplGray, tplMean);

  // If template has zero variance (flat color), skip
  if (tplStd < 1e-6) return [];

  const tplSize = tplW * tplH;
  const candidates: MatchResult[] = [];

  // Slide template over image with stride
  for (let y = 0; y <= imgH - tplH; y += stride) {
    for (let x = 0; x <= imgW - tplW; x += stride) {
      // Compute NCC at (x, y)
      let patchSum = 0;
      let patchSumSq = 0;
      let crossSum = 0;

      for (let ty = 0; ty < tplH; ty++) {
        const imgRowOffset = (y + ty) * imgW + x;
        const tplRowOffset = ty * tplW;
        for (let tx = 0; tx < tplW; tx++) {
          const imgVal = imgGray[imgRowOffset + tx];
          const tplVal = tplGray[tplRowOffset + tx];
          patchSum += imgVal;
          patchSumSq += imgVal * imgVal;
          crossSum += imgVal * tplVal;
        }
      }

      const patchMean = patchSum / tplSize;
      const patchVariance = patchSumSq / tplSize - patchMean * patchMean;
      const patchStd = Math.sqrt(Math.max(0, patchVariance));

      if (patchStd < 1e-6) continue;

      // NCC = (1/N) * Σ((img - imgMean)(tpl - tplMean)) / (imgStd * tplStd)
      const ncc = (crossSum / tplSize - patchMean * tplMean) / (patchStd * tplStd);

      if (ncc >= threshold) {
        candidates.push({
          x_norm: x / imgW,
          y_norm: y / imgH,
          w_norm: tplW / imgW,
          h_norm: tplH / imgH,
          score: ncc,
        });
      }
    }
  }

  // NMS to remove duplicates
  const deduped = nms(candidates, nmsIou);

  // Return top N sorted by score
  return deduped.slice(0, maxResults);
}

// ── Canvas helpers ──────────────────────────────────────────────────────────

/**
 * Extract ImageData from a base64-encoded image.
 * Optionally downscale to maxDim for performance.
 */
export function imageB64ToImageData(
  b64: string,
  maxDim?: number,
): Promise<{ imageData: ImageData; scale: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      let scale = 1;

      if (maxDim && Math.max(w, h) > maxDim) {
        scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve({ imageData: ctx.getImageData(0, 0, w, h), scale });
    };
    img.onerror = reject;
    img.src = b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
  });
}

/**
 * Crop a region from an ImageData and return a new ImageData.
 * Coordinates are in pixels relative to the ImageData dimensions.
 */
export function cropImageData(
  source: ImageData,
  x: number,
  y: number,
  w: number,
  h: number,
): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(source, 0, 0);
  return ctx.getImageData(x, y, w, h);
}
