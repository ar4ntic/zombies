import { randomInt } from "node:crypto";
import { matchMaker } from "@colyseus/core";
import { SESSION_CODE_ALPHABET, SESSION_CODE_LENGTH } from "@zombies/shared";

function randomCode(): string {
  let code = "";
  for (let i = 0; i < SESSION_CODE_LENGTH; i++) {
    code += SESSION_CODE_ALPHABET[randomInt(SESSION_CODE_ALPHABET.length)];
  }
  return code;
}

export async function generateSessionCode(): Promise<string> {
  for (;;) {
    const code = randomCode();
    const existing = await matchMaker.query({ roomId: code });
    if (existing.length === 0) return code;
  }
}
