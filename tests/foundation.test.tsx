import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddressForm } from "@/components/address-form";
import { StatePanel } from "@/components/ui/state-panel";
import { Button } from "@/components/ui/button";
import WorkspaceError from "@/app/workspace/error";
import { validateAddress } from "@/lib/address";
import { getSurface } from "@/lib/surfaces";
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
beforeEach(() => push.mockClear());
describe("address intake", () => {
  it("rejects whitespace and excessive input without pretending to validate a property", () => {
    expect(validateAddress("   ")).toBeTruthy();
    expect(validateAddress("x".repeat(241))).toBeTruthy();
    expect(validateAddress("123 Church St, Springfield")).toBeNull();
  });
  it("announces missing input and does not navigate", async () => {
    render(<AddressForm />);
    await userEvent.click(
      screen.getByRole("button", { name: /explore the workspace/i }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a church address",
    );
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    expect(push).not.toHaveBeenCalled();
  });
  it("trims and safely encodes user input while disclosing disconnected lookup", async () => {
    render(<AddressForm />);
    await userEvent.type(
      screen.getByRole("textbox"),
      "  12 St. Mark’s & Main #2  ",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /explore the workspace/i }),
    );
    expect(push).toHaveBeenCalledWith(
      `/workspace?address=${encodeURIComponent("12 St. Mark’s & Main #2")}`,
    );
    expect(
      screen.getByText(/lookup and analysis are not connected/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
describe("shared view states", () => {
  it("announces loading without implying that analysis is running", () => {
    render(<StatePanel state="loading" title="Opening workspace" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });
  it("offers a working recovery action on errors", async () => {
    const reset = vi.fn();
    render(<WorkspaceError error={new Error("test")} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent("could not open");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
  });
  it("supports stale content and an explicit recompute action", async () => {
    const recompute = vi.fn();
    render(
      <StatePanel
        state="stale"
        title="Inputs have changed"
        action={<Button onClick={recompute}>Recompute</Button>}
      >
        Previous results need checking.
      </StatePanel>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Previous results need checking",
    );
    await userEvent.click(screen.getByRole("button", { name: "Recompute" }));
    expect(recompute).toHaveBeenCalledOnce();
  });
  it("unknown views safely fall back to Site", () => {
    expect(getSurface("not-a-surface").id).toBe("site");
    expect(getSurface(null).id).toBe("site");
  });
});
