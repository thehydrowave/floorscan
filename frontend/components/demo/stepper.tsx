"use client";

import { Check, KeyRound, Upload, Crop, Brain, PenSquare, Download } from "lucide-react";
import { cn } from "@/lib/utils";

const STEP_META = [
  { label: "Connect", icon: KeyRound },
  { label: "Upload", icon: Upload },
  { label: "Crop", icon: Crop },
  { label: "Detect", icon: Brain },
  { label: "Correct", icon: PenSquare },
  { label: "Export", icon: Download },
];

interface StepperProps {
  currentStep: number;   // 1-based
  totalSteps?: number;   // defaults to STEP_META.length
}

export default function Stepper({ currentStep, totalSteps }: StepperProps) {
  const steps = STEP_META.slice(0, totalSteps ?? STEP_META.length);

  return (
    <div className="flex items-center w-full max-w-3xl mx-auto">
      {steps.map((step, index) => {
        const stepNum = index + 1;
        const isActive = stepNum === currentStep;
        const isDone = stepNum < currentStep;
        const isLast = index === steps.length - 1;

        return (
          <div key={step.label} className="flex items-center flex-1">
            <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-600 font-display transition-all duration-300",
                  isActive && "step-active text-white",
                  isDone && "step-done text-accent-green",
                  !isActive && !isDone && "step-inactive text-slate-500"
                )}
              >
                {isDone ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <step.icon className="w-3.5 h-3.5" />
                )}
              </div>
              <span
                className={cn(
                  "text-xs font-medium transition-colors hidden sm:block",
                  isActive && "text-white",
                  isDone && "text-accent-green",
                  !isActive && !isDone && "text-slate-600"
                )}
              >
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div
                className={cn(
                  "flex-1 h-px mx-2 transition-colors duration-300 -mt-5 sm:-mt-5",
                  isDone ? "bg-accent-green/40" : "bg-white/5"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
