import { CornerDownLeft, MessageSquare, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
export function Copilot() {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button variant="outline">
          <MessageSquare size={16} aria-hidden="true" />
          Copilot
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="rail-overlay" />
        <Dialog.Content className="copilot-rail">
          <div className="rail-heading">
            <Dialog.Title>Project Copilot</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close Copilot">
                <X size={18} />
              </Button>
            </Dialog.Close>
          </div>
          <div className="rail-body">
            <p className="eyebrow">YOUR MISSION, IN THE MODEL</p>
            <h2>
              A conversation
              <br />
              with a purpose.
            </h2>
            <Dialog.Description>
              Copilot will help you explore your property and explain what
              changes when your priorities change.
            </Dialog.Description>
            <div className="copilot-example">
              <span>AN EXAMPLE OF A FUTURE REQUEST</span>
              <p>“Keep the sanctuary and preserve our Sunday parking.”</p>
            </div>
            <p className="rail-notice">
              Copilot is not connected yet. No messages are sent or answers
              generated in this preview.
            </p>
          </div>
          <div className="copilot-composer">
            <label htmlFor="copilot-message">Message Copilot</label>
            <textarea
              id="copilot-message"
              placeholder="Available when project tools are connected"
              disabled
            />
            <Button disabled variant="outline">
              Send message
              <CornerDownLeft size={15} aria-hidden="true" />
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
