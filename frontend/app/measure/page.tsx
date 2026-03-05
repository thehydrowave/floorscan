import type { Metadata } from "next";
import MeasureClient from "./measure-client";

export const metadata: Metadata = {
  title: "FloorScan Métré — Mesure manuelle de surfaces",
  description: "Outil de métré libre : importez un plan, définissez l'échelle et mesurez vos surfaces par type (carrelage, parquet, peinture…).",
};

export default function MeasurePage() {
  return <MeasureClient />;
}
