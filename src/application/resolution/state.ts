import { z } from "zod";
import {
  AddressCandidate,
  CaptureMetadata,
  ParcelCandidate,
  ProviderFailureCode,
  ResolvedParcelContext,
} from "../../adapters/gis";

/**
 * Resolution session (issue #4): PROVISIONAL application-layer state. It never
 * becomes canonical Development Graph truth until the user confirms and the
 * atomic site commit succeeds. The session is serializable so it can live
 * client-side (sessionStorage) and survive reloads — the server stays stateless.
 */

export const AddressStageState = z.enum([
  "UNRESOLVED",
  "SEARCHING",
  "CANDIDATES",
  "CONFIRMATION_REQUIRED",
  "RESOLVED",
  "FAILED",
]);
export type AddressStageState = z.infer<typeof AddressStageState>;

export const ParcelStageState = z.enum([
  "NOT_STARTED",
  "SEARCHING",
  "CANDIDATES",
  "CONFIRMATION_REQUIRED",
  "RESOLVED",
  "PARCEL_NONE",
  "FAILED",
]);
export type ParcelStageState = z.infer<typeof ParcelStageState>;

export const ConfirmationReason = z.enum([
  "MULTIPLE_ADDRESS_CANDIDATES",
  "NON_PARCEL_GEOCODE",
  "MULTIPLE_PARCEL_CANDIDATES",
  "NO_REGISTRY_MATCH",
  "GEOCODER_PARCEL_DISAGREEMENT",
  "INVALID_PARCEL_GEOMETRY",
]);
export type ConfirmationReason = z.infer<typeof ConfirmationReason>;

export const StageFailure = z
  .object({
    code: ProviderFailureCode,
    message: z.string(),
    providerId: z.string(),
  })
  .strict();
export type StageFailure = z.infer<typeof StageFailure>;

export const ResolutionSession = z
  .object({
    sessionId: z.string().min(1),
    createdAt: z.string().min(1),
    query: z.string().min(1),
    addressStage: AddressStageState,
    addressCandidates: z.array(AddressCandidate).default([]),
    addressFailure: StageFailure.optional(),
    selectedAddress: AddressCandidate.optional(),
    parcelStage: ParcelStageState,
    parcelCandidates: z.array(ParcelCandidate).default([]),
    parcelFailure: StageFailure.optional(),
    /** BRT ids of the parcels the user confirmed (single or campus). */
    confirmedParcelIds: z.array(z.string()).default([]),
    /** True only after an explicit user confirmation action. */
    userConfirmedProperty: z.boolean().default(false),
    /** Per-parcel resolved context — each confirmed parcel resolved independently. */
    parcelContexts: z.array(ResolvedParcelContext).default([]),
    captures: z.array(CaptureMetadata).default([]),
  })
  .strict();
export type ResolutionSession = z.infer<typeof ResolutionSession>;

export const SessionRollupState = z.enum([
  "UNRESOLVED",
  "RESOLVING",
  "AWAITING_CONFIRMATION",
  "AWAITING_PROPERTY_CONFIRMATION",
  "READY_TO_COMMIT",
  "COMMITTED",
  "PARTIAL",
  "FAILED",
]);
export type SessionRollupState = z.infer<typeof SessionRollupState>;

export function rollupState(session: ResolutionSession): SessionRollupState {
  if (session.addressStage === "FAILED" && session.parcelStage !== "RESOLVED") return "FAILED";
  const hasContext = session.parcelContexts.length > 0;
  const hasAnyFailure = session.parcelContexts.some((c) => c.failures.length > 0);
  if (session.parcelStage === "RESOLVED" && session.userConfirmedProperty && hasContext && !hasAnyFailure) {
    return "READY_TO_COMMIT";
  }
  if (session.parcelStage === "RESOLVED" && session.userConfirmedProperty && (!hasContext || hasAnyFailure)) {
    return "PARTIAL";
  }
  if (session.parcelStage === "RESOLVED" && !session.userConfirmedProperty) {
    return "AWAITING_PROPERTY_CONFIRMATION";
  }
  if (
    session.addressStage === "CONFIRMATION_REQUIRED" ||
    session.parcelStage === "CONFIRMATION_REQUIRED"
  ) {
    return "AWAITING_CONFIRMATION";
  }
  if (session.addressStage === "RESOLVED" || session.parcelStage === "SEARCHING") {
    return "RESOLVING";
  }
  return "UNRESOLVED";
}
