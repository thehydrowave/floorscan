"use client";

import { Check, KeyRound, Upload, Crop, Ruler, Brain, BarChart3, PenSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

const STEP_ICONS = [KeyRound, Upload, Crop, Ruler, Brain, BarChart3, PenSquare];
const STEP_KEYS: DTKey[] = ["st_connect", "st_upload", "st_crop", "st_scale", "st_analyze", "st_results", "st_editor"];

interface StepperProps {
  currentStep: number;   // 1-based
  totalSteps?: number;   // defaults to STEP_ICONS.length
}

export default function Stepper({ currentStep, totalSteps }: StepperProps) {
  const { lang } = useLang();
  const count = Math.min(totalSteps ?? STEP_ICONS.length, STEP_ICONS.length);

  return (
    <div className="flex items-center w-full max-w-3xl mx-auto">
      {Array.from({ length: count }).map((_, index) => {
        const stepNum = index + 1;
        const isActive = stepNum === currentStep;
        const isDone = stepNum < currentStep;
        const isLast = index === count - 1;
        const Icon = STEP_ICONS[index];
        const label = dt(STEP_KEYS[index], lang);

        return (
          <div key={index} className="flex items-center flex-1">
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
                  <Icon className="w-3.5 h-3.5" />
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
                {label}
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
