import type { Metadata } from "next";
import DemoClient from "./demo-client";

export const metadata: Metadata = {
  title: "FloorScan Démo — Essayez l'analyse IA de plans",
  description: "Démo interactive : importez un plan de sol et voyez la détection IA en action.",
};

export default function DemoPage() {
  return <DemoClient />;
}
