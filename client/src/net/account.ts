import type { AccountResponse, NicknameCheck } from "@zombies/shared";
import { playerId } from "./api.ts";

async function call(method: string, path: string, body?: Record<string, unknown>): Promise<AccountResponse> {
  try {
    const res = await fetch(`/api/auth/${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return (await res.json()) as AccountResponse;
  } catch {
    return { account: null, error: "Could not reach the game server." };
  }
}

/** The account this browser is logged in to. The browser id is sent along where earlier rounds may be handed to the account. */
export const accountApi = {
  me: () => call("GET", "me"),
  register: (email: string, password: string) => call("POST", "register", { email, password }),
  login: (email: string, password: string) => call("POST", "login", { email, password, playerId: playerId() }),
  logout: () => call("POST", "logout", {}),
  setNickname: (nickname: string) => call("PUT", "nickname", { nickname, playerId: playerId() }),
  resend: () => call("POST", "resend", {}),
  forgot: (email: string) => call("POST", "forgot", { email }),
  reset: (token: string, password: string) => call("POST", "reset", { token, password }),
  verify: (token: string) => call("POST", "verify", { token, playerId: playerId() }),
  remove: (password: string) => call("DELETE", "me", { password }),
};

/** Whether a nickname belongs to somebody's account. Unknown when the server cannot be reached; joining decides then. */
export async function checkNickname(name: string): Promise<NicknameCheck | undefined> {
  try {
    const res = await fetch(`/api/nicknames/check?${new URLSearchParams({ name })}`);
    return res.ok ? ((await res.json()) as NicknameCheck) : undefined;
  } catch {
    return undefined;
  }
}
