import { SESSION_CODE_ALPHABET, SESSION_CODE_LENGTH } from "@zombies/shared";

export function generateSessionCode(length = SESSION_CODE_LENGTH): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let code = "";
  for (const byte of bytes) code += SESSION_CODE_ALPHABET[byte % SESSION_CODE_ALPHABET.length];
  return code;
}

export function isSessionCode(value: string): boolean {
  return value.length === SESSION_CODE_LENGTH && [...value].every((c) => SESSION_CODE_ALPHABET.includes(c));
}
