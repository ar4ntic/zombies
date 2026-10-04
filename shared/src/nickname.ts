import { NICKNAME_MAX_LENGTH } from "./constants.ts";

export const NICKNAME_MIN_LENGTH = 3;

/** Letters and digits of any script, with single spaces, dots, dashes and underscores inside. */
const CLAIMABLE = /^[\p{L}\p{N}](?:[\p{L}\p{N}._-]| (?! ))*[\p{L}\p{N}]$/u;

/** A nickname as it is shown: trimmed, inner whitespace collapsed, cut to the maximum length. */
export function cleanNickname(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, NICKNAME_MAX_LENGTH).trim();
}

/** Two nicknames with the same key count as the same name, for protected nicknames and leaderboard entries. */
export function nicknameKey(name: string): string {
  return cleanNickname(name).toLowerCase();
}

/** Whether an account may reserve this nickname. Anonymous players may use looser names. */
export function isClaimableNickname(name: string): boolean {
  const clean = cleanNickname(name);
  return clean === name && clean.length >= NICKNAME_MIN_LENGTH && CLAIMABLE.test(clean);
}
