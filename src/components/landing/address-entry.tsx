"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, MapPin } from "lucide-react";
import { MAX_ADDRESS_LENGTH, validateAddress } from "@/lib/address";
import styles from "../../app/landing.module.css";

/**
 * Landing address entry — the primary product action.
 *
 * Real behavior only: the same validateAddress contract as the workspace
 * entry, then a push to /workspace?address=… where issue #4's site
 * resolution takes over. No synthetic submit states.
 */
export function AddressEntry({ scope = "hero" }: { scope?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const inputId = `${scope}-address`;
  const errorId = `${scope}-address-error`;
  const noteId = `${scope}-address-note`;

  return (
    <form
      className={styles.entry}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const address = String(
          new FormData(event.currentTarget).get("address") ?? "",
        ).trim();
        const problem = validateAddress(address);
        setError(problem);
        if (problem) return;
        setPending(true);
        router.push(`/workspace?address=${encodeURIComponent(address)}`);
      }}
    >
      <label className={styles.entryLabel} htmlFor={inputId}>
        Church property address
      </label>
      <div className={styles.entryRow}>
        <span className={styles.entryPin}>
          <MapPin aria-hidden="true" size={19} />
        </span>
        <input
          id={inputId}
          name="address"
          autoComplete="street-address"
          placeholder="Street address, city, state"
          maxLength={MAX_ADDRESS_LENGTH}
          aria-invalid={!!error}
          aria-describedby={error ? `${errorId} ${noteId}` : noteId}
          onChange={() => setError(null)}
          data-testid={`${scope}-address-input`}
        />
        <button
          type="submit"
          className={styles.entryButton}
          disabled={pending}
          data-testid={`${scope}-address-submit`}
        >
          {pending ? "Opening…" : "Explore the property"}
          <ArrowRight aria-hidden="true" size={16} />
        </button>
      </div>
      {error && (
        <p id={errorId} className={styles.entryError} role="alert">
          {error}
        </p>
      )}
      <p id={noteId} className={styles.entryMeta}>
        Public property records · mission constraints · possibilities with
        proof.
      </p>
    </form>
  );
}
