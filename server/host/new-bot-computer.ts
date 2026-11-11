import { browserSessionId } from "../browser-engine.ts";
import { perBotLocalVmTarget, type LocalVmTarget } from "../container-computer.ts";

export interface NewBotComputer {
  vm: LocalVmTarget;
  browserProfileId: string;
  browserSession: string;
}

export function newBotComputer(botId: string): NewBotComputer {
  return {
    vm: perBotLocalVmTarget(botId),
    browserProfileId: botId,
    browserSession: browserSessionId(botId, botId),
  };
}
