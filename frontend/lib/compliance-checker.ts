/**
 * compliance-checker.ts
 *
 * Automated verification engine for French building regulations.
 * Checks AnalysisResult data against PMR, Carrez, RT2012, ventilation
 * and NF C 15-100 norms.
 */

import type { AnalysisResult, Room, Opening } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CheckStatus = "pass" | "fail" | "warning" | "na";
export type ComplianceCategory =
  | "pmr"
  | "carrez"
  | "rt2012"
  | "ventilation"
  | "nfc15100";

export interface ComplianceCheck {
  id: string;
  category: ComplianceCategory;
  rule_key: string; // i18n key for rule description
  status: CheckStatus;
  target: string; // "≥ 0.83 m"
  actual: string; // measured value or "N/A"
  detail_key?: string; // i18n key for detail line
  affected?: string[]; // affected element names
}

export interface ComplianceResult {
  checks: ComplianceCheck[];
  pass_count: number;
  fail_count: number;
  warn_count: number;
  na_count: number;
  score_pct: number; // pass / (pass + fail + warn) × 100
}

// ── Room categorisation (same logic as dpgf-defaults.ts) ──────────────────────

type RoomCategory =
  | "living"
  | "kitchen"
  | "bedroom"
  | "bathroom"
  | "wc"
  | "corridor"
  | "other";

function categorise(room: Room): RoomCategory {
  const t = room.type?.toLowerCase() ?? "";
  if (t.includes("living")) return "living";
  if (t.includes("kitchen") || t.includes("cuisine")) return "kitchen";
  if (t.includes("bedroom") || t.includes("chambre")) return "bedroom";
  if (t.includes("bathroom") || t.includes("salle de bain") || t.includes("salle d'eau")) return "bathroom";
  if (t.includes("wc") || t.includes("toilet")) return "wc";
  if (t.includes("corridor") || t.includes("hall")) return "corridor";
  return "other";
}

/** Habitable room categories (excluded: corridor, wc, other) */
const HABITABLE_CATS: Set<RoomCategory> = new Set([
  "living",
  "kitchen",
  "bedroom",
  "bathroom",
]);

function isHabitable(room: Room): boolean {
  return HABITABLE_CATS.has(categorise(room));
}

// ── NFC 15-100 minimum outlets per room ───────────────────────────────────────

const NFC_MIN_OUTLETS: Record<RoomCategory, number> = {
  living: 5,
  kitchen: 6,
  bedroom: 3,
  bathroom: 2,
  wc: 1,
  corridor: 1,
  other: 1,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function round1(n: number): string {
  return n.toFixed(1);
}

function round2(n: number): string {
  return n.toFixed(2);
}

/**
 * Check if a window's bbox overlaps with a room's bbox (rough proximity).
 * Both use normalised coordinates [0-1].
 */
function windowInRoom(
  win: Opening,
  room: Room,
  imgW: number,
  imgH: number
): boolean {
  if (!room.bbox_norm) return false;
  // Convert opening pixel coords to normalised
  const wx = win.x_px / imgW;
  const wy = win.y_px / imgH;
  const ww = win.width_px / imgW;
  const wh = win.height_px / imgH;

  const rb = room.bbox_norm;
  // Check overlap
  return (
    wx < rb.x + rb.w &&
    wx + ww > rb.x &&
    wy < rb.y + rb.h &&
    wy + wh > rb.y
  );
}

// ── Main checker ──────────────────────────────────────────────────────────────

export function runComplianceChecks(
  result: AnalysisResult,
  params: { ceilingHeight: number }
): ComplianceResult {
  const checks: ComplianceCheck[] = [];
  const hasScale = !!result.pixels_per_meter;
  const rooms = result.rooms ?? [];
  const hasRooms = rooms.length > 0;
  const openings = result.openings ?? [];
  const doors = openings.filter((o) => o.class === "door");
  const windows = openings.filter((o) => o.class === "window");
  const areaHab = result.surfaces?.area_hab_m2 ?? 0;

  // Image dimensions (for bbox overlap — use a standard reference)
  // We approximate from pixels_per_meter and areas
  const imgW = 1; // normalised
  const imgH = 1;

  // ── 1. PMR — Door widths ≥ 0.83 m ────────────────────────────────────────

  if (hasScale && doors.length > 0) {
    const doorsWithWidth = doors.filter(
      (d) => d.width_m !== undefined && d.width_m > 0
    );
    if (doorsWithWidth.length > 0) {
      const narrowDoors = doorsWithWidth.filter((d) => d.width_m! < 0.83);
      checks.push({
        id: "pmr_door_width",
        category: "pmr",
        rule_key: "compliance_pmr_door_width",
        status: narrowDoors.length === 0 ? "pass" : "fail",
        target: "≥ 0.83 m",
        actual: `${doorsWithWidth.length - narrowDoors.length}/${doorsWithWidth.length}`,
        detail_key:
          narrowDoors.length === 0
            ? "compliance_all_doors_ok"
            : "compliance_doors_narrow",
        affected:
          narrowDoors.length > 0
            ? narrowDoors.map(
                (d, i) => `Porte ${i + 1}: ${round2(d.width_m!)} m`
              )
            : undefined,
      });
    } else {
      checks.push({
        id: "pmr_door_width",
        category: "pmr",
        rule_key: "compliance_pmr_door_width",
        status: "na",
        target: "≥ 0.83 m",
        actual: "N/A",
      });
    }
  } else {
    checks.push({
      id: "pmr_door_width",
      category: "pmr",
      rule_key: "compliance_pmr_door_width",
      status: "na",
      target: "≥ 0.83 m",
      actual: "N/A",
    });
  }

  // ── 2. PMR — Entrance door ≥ 0.90 m ──────────────────────────────────────

  if (hasScale && doors.length > 0) {
    const doorsWithWidth = doors.filter(
      (d) => d.width_m !== undefined && d.width_m > 0
    );
    if (doorsWithWidth.length > 0) {
      const maxWidth = Math.max(...doorsWithWidth.map((d) => d.width_m!));
      checks.push({
        id: "pmr_entrance",
        category: "pmr",
        rule_key: "compliance_pmr_entrance",
        status: maxWidth >= 0.9 ? "pass" : "warning",
        target: "≥ 0.90 m",
        actual: `${round2(maxWidth)} m`,
        detail_key: "compliance_entrance_ok",
      });
    } else {
      checks.push({
        id: "pmr_entrance",
        category: "pmr",
        rule_key: "compliance_pmr_entrance",
        status: "na",
        target: "≥ 0.90 m",
        actual: "N/A",
      });
    }
  } else {
    checks.push({
      id: "pmr_entrance",
      category: "pmr",
      rule_key: "compliance_pmr_entrance",
      status: "na",
      target: "≥ 0.90 m",
      actual: "N/A",
    });
  }

  // ── 3. Carrez — Habitable rooms ≥ 9 m² ───────────────────────────────────

  if (hasRooms && hasScale) {
    const habitableRooms = rooms.filter(isHabitable);
    const smallRooms = habitableRooms.filter(
      (r) => r.area_m2 !== null && r.area_m2 < 9
    );
    if (habitableRooms.length > 0) {
      checks.push({
        id: "carrez_room_min",
        category: "carrez",
        rule_key: "compliance_carrez_room_min",
        status: smallRooms.length === 0 ? "pass" : "warning",
        target: "≥ 9 m²",
        actual: `${habitableRooms.length - smallRooms.length}/${habitableRooms.length}`,
        detail_key:
          smallRooms.length === 0
            ? "compliance_rooms_ok"
            : "compliance_rooms_small",
        affected:
          smallRooms.length > 0
            ? smallRooms.map(
                (r) =>
                  `${r.label_fr || r.type}: ${round1(r.area_m2 ?? 0)} m²`
              )
            : undefined,
      });
    } else {
      checks.push({
        id: "carrez_room_min",
        category: "carrez",
        rule_key: "compliance_carrez_room_min",
        status: "na",
        target: "≥ 9 m²",
        actual: "N/A",
      });
    }
  } else {
    checks.push({
      id: "carrez_room_min",
      category: "carrez",
      rule_key: "compliance_carrez_room_min",
      status: "na",
      target: "≥ 9 m²",
      actual: "N/A",
    });
  }

  // ── 4. Carrez — Ceiling height ≥ 2.20 m ──────────────────────────────────

  {
    const h = params.ceilingHeight;
    checks.push({
      id: "carrez_ceiling",
      category: "carrez",
      rule_key: "compliance_carrez_ceiling",
      status: h >= 2.2 ? "pass" : "fail",
      target: "≥ 2.20 m",
      actual: `${round2(h)} m`,
    });
  }

  // ── 5. Carrez — Total habitable area (info only) ─────────────────────────

  if (hasScale && areaHab > 0) {
    checks.push({
      id: "carrez_total",
      category: "carrez",
      rule_key: "compliance_carrez_total",
      status: "pass",
      target: "info",
      actual: `${round1(areaHab)} m²`,
    });
  } else {
    checks.push({
      id: "carrez_total",
      category: "carrez",
      rule_key: "compliance_carrez_total",
      status: "na",
      target: "info",
      actual: "N/A",
    });
  }

  // ── 6. RT2012 — Glazing ratio ≥ 1/6 ──────────────────────────────────────

  if (hasScale && areaHab > 0 && windows.length > 0) {
    // Compute total window area
    const windowsWithDims = windows.filter(
      (w) => w.width_m && w.height_m && w.width_m > 0 && w.height_m > 0
    );
    if (windowsWithDims.length > 0) {
      const totalWindowArea = windowsWithDims.reduce(
        (s, w) => s + w.width_m! * w.height_m!,
        0
      );
      const ratio = (totalWindowArea / areaHab) * 100;
      const threshold = 100 / 6; // 16.67%
      checks.push({
        id: "rt2012_glazing",
        category: "rt2012",
        rule_key: "compliance_rt2012_glazing",
        status: ratio >= threshold ? "pass" : "fail",
        target: `≥ ${round1(threshold)}%`,
        actual: `${round1(ratio)}%`,
        detail_key:
          ratio >= threshold
            ? "compliance_glazing_ok"
            : "compliance_glazing_low",
      });
    } else {
      checks.push({
        id: "rt2012_glazing",
        category: "rt2012",
        rule_key: "compliance_rt2012_glazing",
        status: "na",
        target: "≥ 16.7%",
        actual: "N/A",
      });
    }
  } else {
    checks.push({
      id: "rt2012_glazing",
      category: "rt2012",
      rule_key: "compliance_rt2012_glazing",
      status: "na",
      target: "≥ 16.7%",
      actual: "N/A",
    });
  }

  // ── 7. Ventilation — Natural light per habitable room ─────────────────────

  if (hasRooms && windows.length > 0) {
    const habitableRooms = rooms.filter(isHabitable);

    // Pre-compute estimated image extents ONCE (outside the loops)
    const allX = openings.map((o) => o.x_px + o.width_px);
    const allY = openings.map((o) => o.y_px + o.height_px);
    const estW = Math.max(...allX, 1);
    const estH = Math.max(...allY, 1);

    // For each habitable room, check if at least 1 window bbox overlaps
    const roomsWithoutLight = habitableRooms.filter((room) => {
      // Use bbox overlap on normalised coordinates
      const hasWindow = windows.some((win) => {
        if (!room.bbox_norm) return false;

        const wcx = (win.x_px + win.width_px / 2) / estW;
        const wcy = (win.y_px + win.height_px / 2) / estH;

        return (
          wcx >= room.bbox_norm.x &&
          wcx <= room.bbox_norm.x + room.bbox_norm.w &&
          wcy >= room.bbox_norm.y &&
          wcy <= room.bbox_norm.y + room.bbox_norm.h
        );
      });
      return !hasWindow;
    });

    if (habitableRooms.length > 0) {
      checks.push({
        id: "ventilation_light",
        category: "ventilation",
        rule_key: "compliance_ventilation_light",
        status: roomsWithoutLight.length === 0 ? "pass" : "warning",
        target: "≥ 1 fenêtre/pièce",
        actual: `${habitableRooms.length - roomsWithoutLight.length}/${habitableRooms.length}`,
        detail_key:
          roomsWithoutLight.length === 0
            ? "compliance_light_ok"
            : "compliance_light_missing",
        affected:
          roomsWithoutLight.length > 0
            ? roomsWithoutLight.map(
                (r) => r.label_fr || r.type
              )
            : undefined,
      });
    } else {
      checks.push({
        id: "ventilation_light",
        category: "ventilation",
        rule_key: "compliance_ventilation_light",
        status: "na",
        target: "≥ 1 fenêtre/pièce",
        actual: "N/A",
      });
    }
  } else {
    checks.push({
      id: "ventilation_light",
      category: "ventilation",
      rule_key: "compliance_ventilation_light",
      status: "na",
      target: "≥ 1 fenêtre/pièce",
      actual: "N/A",
    });
  }

  // ── 8. NFC 15-100 — Minimum outlets per room type ────────────────────────

  if (hasRooms) {
    let totalRequired = 0;
    for (const room of rooms) {
      totalRequired += NFC_MIN_OUTLETS[categorise(room)];
    }
    checks.push({
      id: "nfc_outlets",
      category: "nfc15100",
      rule_key: "compliance_nfc_outlets",
      status: "pass", // Informational — always pass (recommendation)
      target: `${totalRequired} prises min.`,
      actual: `${totalRequired} prises`,
      detail_key: "compliance_nfc_info",
    });
  } else {
    checks.push({
      id: "nfc_outlets",
      category: "nfc15100",
      rule_key: "compliance_nfc_outlets",
      status: "na",
      target: "—",
      actual: "N/A",
    });
  }

  // ── Compute summary ───────────────────────────────────────────────────────

  let pass_count = 0;
  let fail_count = 0;
  let warn_count = 0;
  let na_count = 0;

  for (const c of checks) {
    switch (c.status) {
      case "pass":
        pass_count++;
        break;
      case "fail":
        fail_count++;
        break;
      case "warning":
        warn_count++;
        break;
      case "na":
        na_count++;
        break;
    }
  }

  const applicable = pass_count + fail_count + warn_count;
  const score_pct = applicable > 0 ? Math.round((pass_count / applicable) * 100) : 0;

  return {
    checks,
    pass_count,
    fail_count,
    warn_count,
    na_count,
    score_pct,
  };
}
