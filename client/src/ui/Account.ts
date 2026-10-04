import { NICKNAME_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, type AccountInfo, type AccountResponse } from "@zombies/shared";
import { accountApi } from "../net/account.ts";

type Mode = "login" | "register" | "forgot" | "reset";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const passwordField = (label: string, autocomplete: string) => `
  <label>${label}
    <input name="password" type="password" required minlength="${PASSWORD_MIN_LENGTH}" maxlength="${PASSWORD_MAX_LENGTH}" autocomplete="${autocomplete}" />
  </label>`;

const emailField = `
  <label>Email address
    <input name="email" type="email" required autocomplete="username" />
  </label>`;

function loggedOut(mode: Mode): string {
  if (mode === "reset") {
    return `
      <form data-form="reset">
        <p class="hint">Choose a new password for your account.</p>
        ${passwordField("New password", "new-password")}
        <button class="primary">Save password</button>
      </form>`;
  }
  if (mode === "forgot") {
    return `
      <form data-form="forgot">
        <p class="hint">We send you a link to choose a new password.</p>
        ${emailField}
        <button class="primary">Send link</button>
      </form>
      <button type="button" class="link" data-action="login">Back to log in</button>`;
  }
  const register = mode === "register";
  return `
    <form data-form="${mode}">
      <p class="hint">${
        register
          ? "An account keeps your nickname yours: nobody else can play or score under it. Your email address is only used to log in and to reset your password."
          : "Log in to play under your protected nickname."
      }</p>
      ${emailField}
      ${passwordField(register ? `Password (at least ${PASSWORD_MIN_LENGTH} characters)` : "Password", register ? "new-password" : "current-password")}
      <button class="primary">${register ? "Create account" : "Log in"}</button>
    </form>
    <button type="button" class="link" data-action="${register ? "login" : "register"}">${register ? "I already have an account" : "Create an account"}</button>
    ${register ? "" : `<button type="button" class="link" data-action="forgot">Forgot your password?</button>`}`;
}

function loggedIn(account: AccountInfo, deleting: boolean): string {
  const status = account.verified
    ? `<p class="account-status ok">Email confirmed. ${account.nickname ? "Your nickname is protected." : "Choose your nickname below."}</p>`
    : `<p class="account-status">Open the link we sent to ${escapeHtml(account.email)} to confirm your email address. Your nickname is protected once that is done.</p>
       <button type="button" class="link" data-action="resend">Send the link again</button>`;
  return `
    <p class="hint">Logged in as <strong>${escapeHtml(account.email)}</strong></p>
    ${status}
    <form data-form="nickname">
      <label>Your nickname
        <input name="nickname" required maxlength="${NICKNAME_MAX_LENGTH}" autocomplete="off" value="${escapeHtml(account.nickname ?? "")}" />
      </label>
      <button class="primary">Save nickname</button>
    </form>
    <button type="button" data-action="logout">Log out</button>
    ${
      deleting
        ? `<form data-form="remove">
             <p class="hint">Deleting your account frees your nickname. Enter your password to confirm.</p>
             ${passwordField("Password", "current-password")}
             <button class="danger">Delete my account</button>
           </form>`
        : `<button type="button" class="link" data-action="remove">Delete account</button>`
    }`;
}

export interface AccountView {
  el: HTMLElement;
  /** Shows the account the browser turned out to be logged in to. */
  setAccount(account: AccountInfo | null): void;
  /** Shows the form for choosing a new password with the token of a reset link. */
  startReset(token: string): void;
}

/**
 * Log in, registration and account management. `onChange` runs whenever the logged-in account changes,
 * including its nickname and email confirmation.
 */
export function accountView(onChange: (account: AccountInfo | null) => void): AccountView {
  const el = document.createElement("div");
  el.className = "account-view";
  let account: AccountInfo | null = null;
  let mode: Mode = "login";
  let deleting = false;
  let resetToken = "";
  let message = "";
  let failed = false;
  let busy = false;

  const render = () => {
    el.innerHTML = `${account ? loggedIn(account, deleting) : loggedOut(mode)}<p class="${failed ? "error" : "notice"}" ${message ? "" : "hidden"}>${escapeHtml(message)}</p>`;
  };

  /** Applies an answer of the account API; `done` is the message shown when it carries no error. */
  const apply = (response: AccountResponse, done = "", keepAccount = false) => {
    failed = response.error !== undefined;
    message = response.error ?? done;
    if (!keepAccount || response.account) {
      const changed = JSON.stringify(response.account) !== JSON.stringify(account);
      account = response.account;
      if (changed) onChange(account);
    }
    render();
  };

  const submit = async (form: string, data: FormData) => {
    const text = (name: string) => String(data.get(name) ?? "");
    switch (form) {
      case "login":
        return apply(await accountApi.login(text("email"), text("password")), "", true);
      case "register": {
        const response = await accountApi.register(text("email"), text("password"));
        const sent = response.mailSent ? "We sent you a link to confirm your email address." : "The confirmation mail could not be sent. Try sending it again later.";
        return apply(response, sent, true);
      }
      case "forgot": {
        const response = await accountApi.forgot(text("email"));
        return apply(response, "If this address has an account, a link is on its way. It works for one hour.", true);
      }
      case "reset": {
        const response = await accountApi.reset(resetToken, text("password"));
        if (!response.error) mode = "login";
        return apply(response, "Your new password is saved.", true);
      }
      case "nickname":
        return apply(await accountApi.setNickname(text("nickname").trim()), "Nickname saved.", true);
      case "remove": {
        const response = await accountApi.remove(text("password"));
        deleting = response.error !== undefined;
        return apply(response, "Your account is deleted.");
      }
    }
  };

  const act = async (action: string) => {
    switch (action) {
      case "login":
      case "register":
      case "forgot":
        mode = action;
        message = "";
        return render();
      case "remove":
        deleting = true;
        message = "";
        return render();
      case "logout":
        return apply(await accountApi.logout(), "");
      case "resend": {
        const response = await accountApi.resend();
        return apply(response, response.mailSent ? "The link is on its way." : "The mail could not be sent. Try again later.", true);
      }
    }
  };

  /** One request at a time, so a double click does not register or delete twice. */
  const once = async (work: () => Promise<void> | void) => {
    if (busy) return;
    busy = true;
    try {
      await work();
    } finally {
      busy = false;
    }
  };

  el.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    void once(() => submit(form.dataset.form!, new FormData(form)));
  });
  el.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]")?.dataset.action;
    if (action) void once(() => act(action));
  });
  render();

  return {
    el,
    setAccount(next: AccountInfo | null) {
      account = next;
      render();
    },
    startReset(token: string) {
      resetToken = token;
      mode = "reset";
      message = "";
      render();
    },
  };
}
