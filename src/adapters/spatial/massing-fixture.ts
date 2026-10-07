import { z } from "zod";

/**
 * Scenario-compatible massing fixture (spike input only).
 *
 * The Scenario graph contract (src/domain/scenarios/entities.ts) is
 * deliberately computation-shaped — metrics, statuses, constraint results —
 * and carries no geometry. Until #7's solver defines its output contract,
 * this file is the spike's stand-in for "what the solver hands Forge":
 * per-scenario massing volumes in graph coordinates (WGS84) with heights in
 * feet. ADR 0008 proposes the exact contract #7/#9 should land on.
 */

export const MassingVolume = z
  .object({
    volumeId: z.string().min(1),
    label: z.string().min(1),
    geometry: z.object({
      type: z.literal("Polygon"),
      coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
    }),
    heightFt: z.number().positive(),
  })
  .strict();
export type MassingVolume = z.infer<typeof MassingVolume>;

export const ScenarioMassing = z
  .object({
    scenarioId: z.string().min(1),
    volumes: z.array(MassingVolume).min(1),
  })
  .strict();
export type ScenarioMassing = z.infer<typeof ScenarioMassing>;

export const SpikeMassingFixture = z
  .object({
    $schema: z.literal("acrevia.spatial.spike-massing.v1"),
    description: z.string(),
    scenarios: z.array(ScenarioMassing).min(1),
  })
  .strict();
export type SpikeMassingFixture = z.infer<typeof SpikeMassingFixture>;

export function parseMassingFixture(doc: unknown): SpikeMassingFixture {
  return SpikeMassingFixture.parse(doc);
}
