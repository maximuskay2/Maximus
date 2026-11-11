export interface SkillStep {
  verb: "click" | "fill" | "navigate";
  selector?: string;
  label?: string;
  text?: string;
  needsApproval?: boolean;
}

export interface RecordedSkill {
  name: string;
  parameters: string[];
  steps: SkillStep[];
}

export function recordSkill(name: string, steps: SkillStep[]): RecordedSkill {
  const parameters = [...new Set(steps.flatMap((step) => (
    [...(step.text ?? "").matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] ?? "")
  ).filter((parameter) => parameter.length > 0)))];
  return { name, parameters, steps };
}

export function replaySkill(
  skill: RecordedSkill,
  values: Record<string, string>,
  act: (step: SkillStep) => void,
  approve: (step: SkillStep) => boolean,
): SkillStep[] {
  const ran: SkillStep[] = [];
  for (const step of skill.steps) {
    const text = step.text?.replace(/\{\{(\w+)\}\}/g, (_all, key: string) => values[key] ?? "");
    const next: SkillStep = text === undefined ? step : { ...step, text };
    if (next.needsApproval && !approve(next)) break;
    act(next);
    ran.push(next);
  }
  return ran;
}
