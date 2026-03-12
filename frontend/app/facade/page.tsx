import type { Metadata } from "next";
import FacadeClient from "./facade-client";

export const metadata: Metadata = {
  title: "FloorScan — Analyse de Façade (WIP)",
  description: "Module d'analyse de façades architecturales — en cours de développement.",
};

export default function FacadePage() {
  return <FacadeClient />;
}
