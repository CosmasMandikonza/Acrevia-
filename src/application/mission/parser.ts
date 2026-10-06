import { z } from "zod";
import { MissionNormalizedChecked } from "../../domain/constraints/mission";

/**
 * Mission Compiler — deterministic natural-language interpretation boundary
 * (issue #6).
 *
 * This is NOT a chatbot and NOT model-backed. It is a typed, documented,
 * deterministic recognizer for the mission forms Acrevia can make executable
 * today (min-parking, preserve-structure, max-stories, retain-ownership,
 * max-height). Output is Zod-validated structured proposals the user must
 * explicitly confirm before anything reaches the Development Graph.
 *
 * Guarantees:
 * - Fuzzy language NEVER becomes a hard constraint: numberless parking,
 *   ambiguous structures, and unsupported goals return needs-clarification /
 *  unsupported items, not invented values.
 * - Contradictory intent (retain ownership + willing to sell) surfaces as a
 *   conflict; neither interpretation is proposed.
 * - Extreme-but-positive quantities stay valid proposals with an explicit
 *   "feasibility not tested yet" note — without the #7 solver, Acrevia does
 *   not claim impossibility.
 * - Proposal ids are deterministic (one mission rule per semantic slot), so
 *   re-confirming an edited value upserts the same constraint and advances
 *   the project revision.
 */

export type StructureContext = {
  structureId: string;
  name?: string;
};

export const MissionProposal = z.object({
  proposalId: z.string().min(1),
  intentText: z.string().min(1),
  normalized: MissionNormalizedChecked,
  hardOrSoft: z.enum(["hard", "soft"]),
  label: z.string().min(1),
  detail: z.string().min(1),
  feasibilityNote: z.string().optional(),
});
export type MissionProposal = z.infer<typeof MissionProposal>;

export const InterpretationNote = z.object({
  quote: z.string().min(1),
  reason: z.string().min(1),
  suggestion: z.string().optional(),
});
export type InterpretationNote = z.infer<typeof InterpretationNote>;

export const ConflictNote = z.object({
  quote: z.string().min(1),
  reason: z.string().min(1),
});
export type ConflictNote = z.infer<typeof ConflictNote>;

export const InterpretationResult = z
  .object({
    proposals: z.array(MissionProposal),
    needsClarification: z.array(InterpretationNote),
    unsupported: z.array(InterpretationNote),
    conflicts: z.array(ConflictNote),
  })
  .strict();
export type InterpretationResult = z.infer<typeof InterpretationResult>;

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};

const SOFT_MARKERS = /\b(prefer|preferably|if possible|would like|nice to have|ideally|soft)\b/i;

const RETAIN_OWNERSHIP =
  /\b(retains?|retain|keep(?:s|ing)?|holding onto|hold on to)\s+(?:land\s+)?ownership\b/i;
const RETAIN_LAND =
  /\b(?:we\s+)?(?:must\s+|should\s+|will\s+|want\s+to\s+|would\s+like\s+to\s+)?(?:retain|keep|hold\s+onto)\s+(?:the\s+|our\s+)?(?:land|property|parcel|real\s*estate)\b/i;
/** "do not / don't / won't / never / refuse to … [want to] sell(ing)" */
const RETAIN_SELL_REFUSAL =
  /\b(?:do\s*not|don'?t|won'?t|never|refuse\s+to|not)\s+(?:want\s+to\s+|wish\s+to\s+|plan\s+(?:on|to)\s+|intend\s+to\s+|be\s+)?sell(?:ing)?/i;
const LAND_OBJECT = /\b(land|property|parcel|real\s*estate)\b/i;
const SELL_PERMISSIVE =
  /\b(?:open\s+to|willing\s+to|okay\s+with|fine\s+with|prepared\s+to|can|would)\s+(?:be\s+)?(?:selling|sell)\b|\bsell(?:ing)?\s+(?:the\s+)?(?:land|property|parcel|it)\s+is\s+(?:okay|fine|acceptable|an?\s*option)\b/i;

const PARKING_WITH_NUMBER =
  /\b(?:at\s+least|minimum|min\.?|no\s+fewer\s+than|keep(?:s|ing)?|preserve|maintain|need|needs|we\s+need)?\s*(?:at\s+least\s+)?(\d[\d,]*)\s*(?:sunday\s+)?parking\s*(?:spaces|spots|stalls)?\b/i;
const PARKING_VAGUE =
  /\bparking\b(?![^.]*(?:\d[\d,]*)\s*(?:sunday\s+)?parking)[^.]*\b(?:important|a\s+priority|critical|essential|matters|key)\b/i;
const PARKING_MENTION = /\bparking\b/i;

const STORIES =
  /\b(?:no\s+more\s+than|at\s+most|maximum|max|under|below|fewer\s+than|up\s+to)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s*-?\s*(?:story|stories|storey|storeys|floors?)\b/i;
const HEIGHT =
  /\b(?:no\s+more\s+than|taller\s+than|higher\s+than|not\s+exceed(?:ing)?|at\s+most|maximum|max|under|below|up\s+to)\s+(\d+)\s*(?:feet|ft|foot)\b/i;

const PRESERVE_VERB =
  /\b(preserve|keep|protect|retain|save|do\s+not\s+demolish|don'?t\s+demolish)\s+(?:the\s+|our\s+)?([a-z][a-z\s'-]{2,50})/i;
const STRUCTURE_NOUNS =
  /\b(sanctuary|church|chapel|fellowship\s+hall|gym(nasium)?|annex|educational\s+wing|building|buildings|structure|structures|food\s+pantry|pantry|parsonage|office)s?\b/i;
/**
 * Interior ministry areas (a pantry, a kitchen, classrooms…) are usually
 * spaces INSIDE a building, not mapped structures. Preserving one must never
 * silently become "preserve the entire only-resolved building" unless a
 * resolved structure genuinely identifies that space by name.
 */
const INTERIOR_NOUNS = /\b(food\s+pantry|pantry|kitchen|classrooms?|nursery|offices?)\b/i;

const UNSUPPORTED_GOALS: Array<{ pattern: RegExp; goal: string }> = [
  { pattern: /\baffordab(?:le|ility)\b/i, goal: "Affordability targets" },
  { pattern: /\b(long[- ]term|passive|stable)?\s*income\b|\brevenue\b/i, goal: "Income preferences" },
  { pattern: /\bminimal\s+disruption\b|\bdisruption\b/i, goal: "Disruption limits" },
  { pattern: /\bcommunity\s+space\b|\bministry\s+space\b/i, goal: "Community or ministry space goals" },
];

function parseCount(raw: string): number {
  const asDigits = Number(raw.replace(/,/g, ""));
  if (Number.isFinite(asDigits)) return asDigits;
  return NUMBER_WORDS[raw.toLowerCase()] ?? Number.NaN;
}

function splitClauses(input: string): string[] {
  return input
    .split(/[.;!?]+|\n+|\bbut\b|,\s+and\s+/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

function structureOptions(context: StructureContext[]): string {
  if (context.length === 0) return "no building footprints were resolved for this property";
  return context.map((s) => s.name ?? s.structureId).join(", ");
}

function extremeNote(type: string, value: number): string | undefined {
  if (type === "min-parking" && value >= 500) {
    return "This is a valid mission requirement, but feasibility has not been tested yet.";
  }
  if (type === "max-stories" && value >= 20) {
    return "This is a valid mission requirement, but feasibility has not been tested yet.";
  }
  if (type === "max-height" && value >= 200) {
    return "This is a valid mission requirement, but feasibility has not been tested yet.";
  }
  return undefined;
}

/**
 * Deterministic interpretation. The same input and structure context always
 * produce the same proposals, in a stable order (parking, ownership, height,
 * stories, preserve) — no randomness, no model calls.
 */
export function interpretMission(
  input: string,
  context: { structures: StructureContext[] },
): InterpretationResult {
  const result: InterpretationResult = {
    proposals: [],
    needsClarification: [],
    unsupported: [],
    conflicts: [],
  };
  const clauses = splitClauses(input);
  const whole = input;

  // Contradiction check runs over the WHOLE input, because the halves of a
  // contradiction often sit in different clauses ("...but selling is okay").
  const retainSignal = (text: string) =>
    RETAIN_OWNERSHIP.test(text) ||
    RETAIN_LAND.test(text) ||
    (RETAIN_SELL_REFUSAL.test(text) && LAND_OBJECT.test(text));
  if (retainSignal(whole) && SELL_PERMISSIVE.test(whole)) {
    result.conflicts.push({
      quote: whole.trim().slice(0, 200),
      reason:
        "This says both that the congregation retains the land and that selling it is acceptable. Acrevia will not pick one for you — remove one side of the contradiction.",
    });
  }
  const ownershipContradicted = result.conflicts.length > 0;
  const hardByDefault = (clause: string) => (SOFT_MARKERS.test(clause) ? "soft" : "hard") as "hard" | "soft";

  for (const clause of clauses) {
    // Sunday parking minimum — only with an explicit quantity.
    const parkingMatch = clause.match(PARKING_WITH_NUMBER);
    if (parkingMatch) {
      const spaces = parseCount(parkingMatch[1]);
      if (Number.isFinite(spaces)) {
        result.proposals.push(
          MissionProposal.parse({
            proposalId: "mission:min-sunday-parking",
            intentText: clause,
            normalized: { type: "min-parking", spaces: { value: spaces, unit: "spaces" } },
            hardOrSoft: hardByDefault(clause),
            label: "SUNDAY PARKING",
            detail: `Minimum ${spaces} spaces`,
            feasibilityNote: extremeNote("min-parking", spaces),
          }),
        );
      } else {
        result.needsClarification.push({
          quote: clause,
          reason: "The parking number could not be read.",
          suggestion: "Try the form: keep at least 110 Sunday parking spaces.",
        });
      }
      continue;
    }

    if (
      PARKING_VAGUE.test(clause) ||
      (PARKING_MENTION.test(clause) && /\b(keep|important|priority|matters|need)\b/i.test(clause))
    ) {
      result.needsClarification.push({
        quote: clause,
        reason: "Acrevia will not invent a parking number.",
        suggestion:
          "How many Sunday parking spaces must remain? E.g. \u201ckeep at least 110 Sunday parking spaces\u201d.",
      });
      continue;
    }

    // Ownership (suppressed when contradictory).
    if (!ownershipContradicted && retainSignal(clause)) {
      result.proposals.push(
        MissionProposal.parse({
          proposalId: "mission:retain-ownership",
          intentText: clause,
          normalized: { type: "retain-ownership" },
          hardOrSoft: hardByDefault(clause),
          label: "OWNERSHIP",
          detail: "Congregation retains land ownership",
        }),
      );
      continue;
    }

    // Mission-preferred maximum height.
    const heightMatch = clause.match(HEIGHT);
    if (heightMatch) {
      const feet = Number(heightMatch[1]);
      result.proposals.push(
        MissionProposal.parse({
          proposalId: "mission:max-height",
          intentText: clause,
          normalized: { type: "max-height", limit: { value: feet, unit: "ft" } },
          hardOrSoft: hardByDefault(clause),
          label: "HEIGHT",
          detail: `No taller than ${feet} ft`,
          feasibilityNote: extremeNote("max-height", feet),
        }),
      );
      continue;
    }

    // Mission-preferred maximum stories.
    const storiesMatch = clause.match(STORIES);
    if (storiesMatch) {
      const stories = parseCount(storiesMatch[1]);
      if (Number.isFinite(stories)) {
        result.proposals.push(
          MissionProposal.parse({
            proposalId: "mission:max-stories",
            intentText: clause,
            normalized: { type: "max-stories", stories: { value: stories, unit: "stories" } },
            hardOrSoft: hardByDefault(clause),
            label: "STORIES",
            detail: `At most ${stories} stories`,
            feasibilityNote: extremeNote("max-stories", stories),
          }),
        );
        continue;
      }
    }

    // Preserve a structure — never silently choosing a building, and never
    // treating an INTERIOR ministry area (pantry, kitchen…) as a whole mapped
    // building unless a resolved structure genuinely identifies it by name.
    const preserveMatch = clause.match(PRESERVE_VERB);
    if (preserveMatch && STRUCTURE_NOUNS.test(clause)) {
      const nounMatch = clause.match(STRUCTURE_NOUNS);
      const noun = nounMatch ? nounMatch[1] : undefined;
      const structures = context.structures;
      const interior = INTERIOR_NOUNS.test(clause);
      // An interior area only maps to a structure whose resolved name
      // genuinely identifies it ("FOOD PANTRY" as a mapped structure).
      const nameMatch = (structure: { name?: string }): boolean =>
        Boolean(
          noun &&
            (structure.name ?? "").toLowerCase().includes(noun.toLowerCase().split(" ")[0]),
        );
      if (structures.length === 0) {
        result.unsupported.push({
          quote: clause,
          reason:
            "This property has no resolved building footprints to protect yet, so preservation cannot become an executable rule.",
          suggestion: "Re-resolve the property, or express the goal as one of the supported rules.",
        });
      } else if (interior) {
        const named = structures.filter(nameMatch);
        if (named.length === 1) {
          const match = named[0];
          result.proposals.push(
            MissionProposal.parse({
              proposalId: `mission:preserve:${match.structureId}`,
              intentText: clause,
              normalized: { type: "preserve-structure", structureId: match.structureId },
              hardOrSoft: hardByDefault(clause),
              label: "PRESERVE",
              detail: match.name ?? match.structureId,
            }),
          );
        } else {
          result.needsClarification.push({
            quote: clause,
            reason: `A ${noun ?? "ministry space"} is usually an interior area, not a separately mapped building — Acrevia will not interpret it as preserving an entire resolved structure.`,
            suggestion:
              "If it is its own building on this property, name it exactly as the resolved footprint is labeled; otherwise keep it as a board note for now.",
          });
        }
      } else if (structures.length === 1) {
        const only = structures[0];
        result.proposals.push(
          MissionProposal.parse({
            proposalId: `mission:preserve:${only.structureId}`,
            intentText: clause,
            normalized: { type: "preserve-structure", structureId: only.structureId },
            hardOrSoft: hardByDefault(clause),
            label: "PRESERVE",
            detail: only.name ?? only.structureId,
          }),
        );
      } else {
        // Multiple structures: try a name match; otherwise ask.
        const named = noun
          ? structures.filter((s) => (s.name ?? "").toLowerCase().includes(noun.toLowerCase().split(" ")[0]))
          : [];
        if (named.length === 1) {
          const match = named[0];
          result.proposals.push(
            MissionProposal.parse({
              proposalId: `mission:preserve:${match.structureId}`,
              intentText: clause,
              normalized: { type: "preserve-structure", structureId: match.structureId },
              hardOrSoft: hardByDefault(clause),
              label: "PRESERVE",
              detail: match.name ?? match.structureId,
            }),
          );
        } else {
          result.needsClarification.push({
            quote: clause,
            reason: `Multiple buildings are resolved (${structureOptions(structures)}). Acrevia will not choose which one is the ${noun ?? "building"}.`,
            suggestion: "Name the building, or pick it from the preserve-a-building control.",
          });
        }
      }
      continue;
    }

    // Unsupported mission goals — surfaced honestly, never fabricated.
    for (const goal of UNSUPPORTED_GOALS) {
      if (goal.pattern.test(clause)) {
        result.unsupported.push({
          quote: clause,
          reason: `${goal.goal} are not yet executable mission types — Acrevia cannot evaluate them deterministically today.`,
          suggestion:
            "Supported rules: preserve a building, minimum Sunday parking, maximum height, maximum stories, retaining land ownership.",
        });
        break;
      }
    }
  }

  return InterpretationResult.parse(result);
}
