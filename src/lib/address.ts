export const MAX_ADDRESS_LENGTH = 240;
export function validateAddress(raw: string): string | null {
  const address = raw.trim();
  if (!address) return "Enter a church address to continue.";
  if (address.length > MAX_ADDRESS_LENGTH)
    return "Keep the address to 240 characters or fewer.";
  return null;
}
