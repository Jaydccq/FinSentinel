import { defaultPersona } from './default';
import { conservativePersona } from './conservative';
import { aggressivePersona } from './aggressive';

export { defaultPersona } from './default';
export { conservativePersona } from './conservative';
export { aggressivePersona } from './aggressive';
export {
  INSTRUCTIONS_SECTION,
  ANALYSIS_SECTION,
  STEPS_SECTION,
  EXPECTATIONS_SECTION,
  NARROWING_SECTION,
  composePersona,
} from './base-prompt';

export type PersonaName = 'default' | 'conservative' | 'aggressive';

const PERSONA_MAP: Record<PersonaName, string> = {
  default: defaultPersona,
  conservative: conservativePersona,
  aggressive: aggressivePersona,
};

/**
 * Get the full persona prompt by name.
 * @throws Error if name is not a valid persona.
 */
export function getPersonaPrompt(name: string): string {
  if (!(name in PERSONA_MAP)) {
    throw new Error(
      `Unknown persona "${name}". Valid personas: ${Object.keys(PERSONA_MAP).join(', ')}`,
    );
  }
  return PERSONA_MAP[name as PersonaName];
}
