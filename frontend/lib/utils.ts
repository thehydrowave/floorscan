import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { Detection, DetectionType, ExportSummary } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const DETECTION_COLORS: Record<DetectionType, string> = {
  door: "#ef4444",
  window: "#3b82f6",
  wall: "#6b7280",
  surface: "#10b981",
};

export const DETECTION_LABELS: Record<DetectionType, string> = {
  door: "Door",
  window: "Window",
  wall: "Wall",
  surface: "Surface",
};

export function computeSummary(detections: Detection[]): ExportSummary {
  const counts = { doors: 0, windows: 0, walls: 0, surfaces: 0 };
  let totalArea = 0;

  for (const d of detections) {
    if (d.type === "door") counts.doors++;
    else if (d.type === "window") counts.windows++;
    else if (d.type === "wall") counts.walls++;
    else if (d.type === "surface") counts.surfaces++;

    if (d.area) totalArea += d.area;
  }

  return { ...counts, totalArea };
}

export function generateCSV(detections: Detection[]): string {
  const headers = ["ID", "Type", "Confidence (%)", "Area (m²)", "X", "Y", "Width", "Height"];
  const rows = detections.map((d) => [
    d.id,
    DETECTION_LABELS[d.type],
    (d.confidence * 100).toFixed(1),
    d.area?.toFixed(2) ?? "N/A",
    d.bbox.x.toFixed(0),
    d.bbox.y.toFixed(0),
    d.bbox.width.toFixed(0),
    d.bbox.height.toFixed(0),
  ]);

  const summary = computeSummary(detections);

  const csvContent = [
    headers.join(","),
    ...rows.map((r) => r.join(",")),
    "",
    "SUMMARY",
    `Doors,${summary.doors}`,
    `Windows,${summary.windows}`,
    `Walls,${summary.walls}`,
    `Surfaces,${summary.surfaces}`,
    `Total Area (m²),${summary.totalArea.toFixed(2)}`,
  ].join("\n");

  return csvContent;
}

export function downloadCSV(detections: Detection[], filename = "floorscan_report.csv") {
  const csv = generateCSV(detections);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function downloadAnnotatedPDF(
  detections: Detection[],
  imageDataUrl: string,
  filename = "floorscan_annotated.pdf"
) {
  // Dynamically import pdf-lib to avoid SSR issues
  const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");

  const pdfDoc = await PDFDocument.create();

  // Convert data URL to bytes
  const imageData = imageDataUrl.split(",")[1];
  const imageBytes = Uint8Array.from(atob(imageData), (c) => c.charCodeAt(0));

  let embeddedImage;
  if (imageDataUrl.startsWith("data:image/png")) {
    embeddedImage = await pdfDoc.embedPng(imageBytes);
  } else {
    embeddedImage = await pdfDoc.embedJpg(imageBytes);
  }

  const { width: imgWidth, height: imgHeight } = embeddedImage;
  const page = pdfDoc.addPage([imgWidth, imgHeight]);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Draw image
  page.drawImage(embeddedImage, { x: 0, y: 0, width: imgWidth, height: imgHeight });

  // Draw bounding boxes
  for (const det of detections) {
    const colorMap: Record<DetectionType, [number, number, number]> = {
      door: [0.94, 0.27, 0.27],
      window: [0.23, 0.51, 0.96],
      wall: [0.42, 0.45, 0.50],
      surface: [0.06, 0.73, 0.51],
    };
    const [r, g, b] = colorMap[det.type];
    const pdfColor = rgb(r, g, b);

    // PDF coords: Y is flipped
    const pdfY = imgHeight - det.bbox.y - det.bbox.height;

    page.drawRectangle({
      x: det.bbox.x,
      y: pdfY,
      width: det.bbox.width,
      height: det.bbox.height,
      borderColor: pdfColor,
      borderWidth: 2,
      opacity: 0.9,
    });

    page.drawText(`${DETECTION_LABELS[det.type]} ${(det.confidence * 100).toFixed(0)}%`, {
      x: det.bbox.x + 4,
      y: pdfY + det.bbox.height - 14,
      size: 10,
      font,
      color: pdfColor,
    });
  }

  // Add summary page
  const summaryPage = pdfDoc.addPage([595, 842]);
  const summary = computeSummary(detections);
  let y = 780;
  const drawText = (text: string, size = 12, color = rgb(0.1, 0.1, 0.2)) => {
    summaryPage.drawText(text, { x: 60, y, size, font, color });
    y -= size * 1.8;
  };

  summaryPage.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(0.97, 0.98, 1) });
  drawText("FloorScan — Analysis Report", 24, rgb(0.05, 0.4, 0.75));
  y -= 10;
  drawText(`Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, 10, rgb(0.5, 0.5, 0.5));
  y -= 20;
  drawText("DETECTION SUMMARY", 14, rgb(0.2, 0.2, 0.3));
  drawText(`Doors:          ${summary.doors}`, 12, rgb(0.1, 0.1, 0.2));
  drawText(`Windows:        ${summary.windows}`, 12, rgb(0.1, 0.1, 0.2));
  drawText(`Walls:          ${summary.walls}`, 12, rgb(0.1, 0.1, 0.2));
  drawText(`Surfaces:       ${summary.surfaces}`, 12, rgb(0.1, 0.1, 0.2));
  drawText(`Total Area:     ${summary.totalArea.toFixed(2)} m²`, 12, rgb(0.05, 0.4, 0.75));

  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
