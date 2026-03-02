import { NextRequest, NextResponse } from "next/server";
import { Detection } from "@/lib/types";

// ─── Roboflow coordinate parsing ─────────────────────────────────────────────
// Roboflow returns bounding boxes as CENTER (x, y) + width + height.
// We convert to TOP-LEFT (x, y) + width + height for our Detection format.

function mapRoboflowClass(rawClass: string): Detection["type"] {
  const c = rawClass.toLowerCase().trim();
  const MAP: Record<string, Detection["type"]> = {
    door: "door",
    doors: "door",
    window: "window",
    windows: "window",
    wall: "wall",
    walls: "wall",
    surface: "surface",
    surfaces: "surface",
    room: "surface",
    floor: "surface",
    opening: "window",
  };
  return MAP[c] ?? "wall"; // unknown class → treat as wall
}

function parseRoboflowPredictions(predictions: any[]): Detection[] {
  return predictions.map((pred: any, index: number) => {
    // Roboflow center → top-left conversion
    const w = Number(pred.width) || 0;
    const h = Number(pred.height) || 0;
    const cx = Number(pred.x) || 0;
    const cy = Number(pred.y) || 0;
    const x = cx - w / 2;
    const y = cy - h / 2;

    // Rough area estimate: assume ~100px = 1 metre
    const area = parseFloat(((w * h) / 10000).toFixed(2));

    return {
      id: `rf_${index}_${Date.now()}`,
      type: mapRoboflowClass(pred.class ?? ""),
      bbox: {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(w),
        height: Math.round(h),
      },
      confidence: Number(pred.confidence) || 0,
      area,
      label: pred.class ?? "",
    } satisfies Detection;
  });
}

// ─── POST /api/infer ──────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { imageBase64, imageWidth, imageHeight, apiKey, modelName, modelVersion } = body;

  // ── Validate required fields ────────────────────────────────────────────────
  if (!apiKey || typeof apiKey !== "string" || apiKey.trim() === "") {
    return NextResponse.json(
      { error: "Missing apiKey. Configure Roboflow in Step 1." },
      { status: 400 }
    );
  }
  if (!modelName || typeof modelName !== "string" || modelName.trim() === "") {
    return NextResponse.json(
      { error: "Missing modelName. Configure Roboflow in Step 1." },
      { status: 400 }
    );
  }
  if (!modelVersion || isNaN(Number(modelVersion))) {
    return NextResponse.json(
      { error: "Missing or invalid modelVersion. Must be an integer." },
      { status: 400 }
    );
  }
  if (!imageBase64 || typeof imageBase64 !== "string") {
    return NextResponse.json(
      { error: "Missing imageBase64. Send the image as base64." },
      { status: 400 }
    );
  }

  // ── Build Roboflow URL ──────────────────────────────────────────────────────
  // Format: https://detect.roboflow.com/{workspace}/{model}/{version}?api_key=...
  // modelName can be "workspace/model" or just "model" (workspace inferred)
  const version = Number(modelVersion);
  const modelPath = modelName.trim();
  const roboflowUrl = `https://detect.roboflow.com/${modelPath}/${version}?api_key=${apiKey.trim()}`;

  // Log without the key
  const safeUrl = `https://detect.roboflow.com/${modelPath}/${version}?api_key=***`;
  console.log(`[infer] POST ${safeUrl}`);
  console.log(`[infer] image size: ${imageWidth}×${imageHeight}px`);

  // ── Call Roboflow ───────────────────────────────────────────────────────────
  let roboResponse: Response;
  try {
    roboResponse = await fetch(roboflowUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      // Roboflow serverless accepts raw base64 in the body
      body: imageBase64,
    });
  } catch (networkErr: any) {
    console.error(`[infer] Network error calling Roboflow: ${networkErr.message}`);
    return NextResponse.json(
      {
        error: "Network error: could not reach Roboflow API.",
        details: networkErr.message,
      },
      { status: 502 }
    );
  }

  const elapsed = Date.now() - startTime;
  console.log(`[infer] Roboflow HTTP status: ${roboResponse.status} (${elapsed}ms)`);

  // ── Handle non-2xx ─────────────────────────────────────────────────────────
  if (!roboResponse.ok) {
    let errorBody = "";
    try {
      errorBody = await roboResponse.text();
    } catch {}
    console.error(`[infer] Roboflow error ${roboResponse.status}: ${errorBody}`);

    const userMessage =
      roboResponse.status === 401
        ? "Invalid API key (401). Check your Roboflow API key in Step 1."
        : roboResponse.status === 404
        ? `Model not found (404). Check the model name "${modelPath}" and version ${version}.`
        : roboResponse.status === 429
        ? "Rate limit exceeded (429). Wait a moment and retry."
        : `Roboflow returned ${roboResponse.status}. ${errorBody.slice(0, 200)}`;

    return NextResponse.json(
      { error: userMessage, status: roboResponse.status, details: errorBody },
      { status: roboResponse.status >= 500 ? 502 : roboResponse.status }
    );
  }

  // ── Parse response ─────────────────────────────────────────────────────────
  let roboData: any;
  try {
    roboData = await roboResponse.json();
  } catch {
    console.error("[infer] Failed to parse Roboflow JSON response");
    return NextResponse.json(
      { error: "Roboflow returned non-JSON response." },
      { status: 502 }
    );
  }

  const predictions: any[] = roboData.predictions ?? [];
  const inferenceTimeMs = roboData.time ? Math.round(roboData.time * 1000) : elapsed;

  console.log(`[infer] ✓ ${predictions.length} predictions returned (inference: ${inferenceTimeMs}ms)`);

  if (predictions.length === 0) {
    console.log("[infer] No predictions in response — empty result returned to client.");
  }

  const detections = parseRoboflowPredictions(predictions);

  return NextResponse.json({
    detections,
    image_width: roboData.image?.width ?? imageWidth,
    image_height: roboData.image?.height ?? imageHeight,
    inference_time_ms: inferenceTimeMs,
    prediction_count: predictions.length,
  });
}
