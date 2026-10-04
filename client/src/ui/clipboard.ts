const COPIED_MS = 1500;

/** The async clipboard API only exists on secure origins; elsewhere a temporary selection is copied instead. */
async function writeText(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.append(field);
  field.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

/** Copies text and briefly confirms it on the button that triggered the copy. */
export async function copyText(button: HTMLButtonElement, text: string) {
  if (!(await writeText(text))) return;
  const label = button.dataset.label ?? button.textContent!;
  button.dataset.label = label;
  button.textContent = "Copied!";
  setTimeout(() => (button.textContent = label), COPIED_MS);
}
