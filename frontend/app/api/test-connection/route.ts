import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/test-connection
 *
 * Body: { apiKey: string, modelName: string, modelVersion: number }
 *
 * Calls the Roboflow model metadata endpoint (no image upload needed).
 * Returns { ok: true, modelInfo: {...} } or { ok: false, error: "..." }
 *
 * The API key is never logged or returned to the client.
 */
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { apiKey, modelName, modelVersion } = body;

  if (!apiKey || !modelName || !modelVersion) {
    return NextResponse.json(
      { ok: false, error: "apiKey, modelName and modelVersion are required." },
      { status: 400 }
    );
  }

  const version = Number(modelVersion);
  if (isNaN(version) || version < 1) {
    return NextResponse.json(
      { ok: false, error: "modelVersion must be a positive integer." },
      { status: 400 }
    );
  }

  // Use the Roboflow model GET endpoint — returns metadata without running inference
  // Format: GET https://detect.roboflow.com/{modelPath}/{version}?api_key=...
  const modelPath = modelName.trim();
  const url = `https://detect.roboflow.com/${modelPath}/${version}?api_key=${apiKey.trim()}`;
  const safeUrl = `https://detect.roboflow.com/${modelPath}/${version}?api_key=***`;

  console.log(`[test-connection] GET ${safeUrl}`);

  let response: Response;
  try {
    response = await fetch(url, { method: "GET" });
  } catch (err: any) {
    console.error(`[test-connection] Network error: ${err.message}`);
    return NextResponse.json(
      { ok: false, error: `Network error: ${err.message}` },
      { status: 502 }
    );
  }

  console.log(`[test-connection] HTTP status: ${response.status}`);

  if (response.status === 200) {
    let meta: any = {};
    try {
      meta = await response.json();
    } catch {}

    return NextResponse.json({
      ok: true,
      model: {
        name: meta.model?.name ?? modelPath,
        version,
        classes: meta.model?.classes ?? [],
      },
    });
  }

  if (response.status === 401) {
    return NextResponse.json(
      { ok: false, error: "Invalid API key (401). Double-check your Roboflow API key." },
      { status: 401 }
    );
  }

  if (response.status === 404) {
    return NextResponse.json(
      {
        ok: false,
        error: `Model not found (404). Check workspace/model name "${modelPath}" and version ${version}.`,
      },
      { status: 404 }
    );
  }

  let body2 = "";
  try { body2 = await response.text(); } catch {}
  return NextResponse.json(
    { ok: false, error: `Roboflow returned ${response.status}. ${body2.slice(0, 200)}` },
    { status: response.status >= 500 ? 502 : response.status }
  );
}
