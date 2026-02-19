/**
 * Skill parsing and classification utilities.
 *
 * Skills come in two types:
 * - Private: bundled as files in the identity repo under `skills/`
 * - Public: installed from clawhub via `clawhub install <slug>`
 *
 * Convention: public skills are prefixed with "clawhub:" in the skills array.
 */

export const CLAWHUB_PREFIX = "clawhub:";

export interface ParsedSkill {
  /** Original string from the skills array */
  raw: string;
  /** Slug used for installation or directory lookup */
  slug: string;
  /** Whether this skill is installed from clawhub (public) */
  isPublic: boolean;
}

/**
 * Parse a single skill string into its components.
 */
export function parseSkill(skill: string): ParsedSkill {
  if (skill.startsWith(CLAWHUB_PREFIX)) {
    return {
      raw: skill,
      slug: skill.slice(CLAWHUB_PREFIX.length),
      isPublic: true,
    };
  }
  return {
    raw: skill,
    slug: skill,
    isPublic: false,
  };
}

/**
 * Classify an array of skill strings into private and public buckets.
 */
export function classifySkills(skills: string[]): {
  private: ParsedSkill[];
  public: ParsedSkill[];
} {
  const result: { private: ParsedSkill[]; public: ParsedSkill[] } = {
    private: [],
    public: [],
  };
  for (const skill of skills) {
    const parsed = parseSkill(skill);
    if (parsed.isPublic) {
      result.public.push(parsed);
    } else {
      result.private.push(parsed);
    }
  }
  return result;
}
