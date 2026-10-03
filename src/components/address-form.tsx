"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_ADDRESS_LENGTH, validateAddress } from "@/lib/address";
export function AddressForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="address-form"
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
        // Capture intent only. Parcel resolution belongs to issue #4.
        router.push(`/workspace?address=${encodeURIComponent(address)}`);
      }}
    >
      <label htmlFor="address">Start with your church address</label>
      <div className="address-input-row">
        <MapPin aria-hidden="true" size={20} />
        <input
          id="address"
          name="address"
          autoComplete="street-address"
          placeholder="Street address, city, state"
          maxLength={MAX_ADDRESS_LENGTH}
          aria-invalid={!!error}
          aria-describedby={
            error ? "address-error address-note" : "address-note"
          }
          onChange={() => setError(null)}
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Opening…" : "Explore the workspace"}
          <ArrowUpRight size={18} aria-hidden="true" />
        </Button>
      </div>
      {error && (
        <p id="address-error" className="form-error" role="alert">
          {error}
        </p>
      )}
      <p id="address-note" className="form-note">
        Workspace preview. Property lookup and analysis are not connected yet.
      </p>
    </form>
  );
}
