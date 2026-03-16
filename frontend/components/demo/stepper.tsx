"use client";

import { Check, KeyRound, Upload, Crop, Ruler, Brain, BarChart3, PenSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang-context";
import { dt, DTKey } from "@/lib/i18n";

const ALL_STEP_ICONS = [KeyRound, Upload, Crop, Ruler, Brain, BarChart3, PenSquare];
const ALL_STEP_KEYS: DTKey[] = ["st_connect", "st_upload", "st_crop", "st_scale", "st_analyze", "st_results", "st_editor"];

// Non-admin: skip Connect step (index 0)
const USER_STEP_ICONS = [Upload, Crop, Ruler, Brain, BarChart3, PenSquare];
const USER_STEP_KEYS: DTKey[] = ["st_upload", "st_crop", "st_scale", "st_analyze", "st_results", "st_editor"];

interface StepperProps {
  currentStep: number;   // 1-based (internal step number)
  totalSteps?: number;
  skipConnect?: boolean; // true for non-admin users
}

export default function Stepper({ currentStep, totalSteps, skipConnect }: StepperProps) {
  const { lang } = useLang();

  const icons = skipConnect ? USER_STEP_ICONS : ALL_STEP_ICONS;
  const keys = skipConnect ? USER_STEP_KEYS : ALL_STEP_KEYS;
  const count = Math.min(totalSteps ?? icons.length, icons.length);

  // When skipConnect, internal step 2 maps to visual step 1
  const visualStep = skipConnect ? currentStep - 1 : currentStep;

  return (
    <div className="flex items-center w-full max-w-3xl mx-auto">
      {Array.from({ length: count }).map((_, index) => {
        const stepNum = index + 1;
        const isActive = stepNum === visualStep;
        const isDone = stepNum < visualStep;
        const isLast = index === count - 1;
        const Icon = icons[index];
        const label = dt(keys[index], lang);

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
