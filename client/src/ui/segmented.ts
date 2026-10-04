export function segmented(name: string, options: Array<[string, string]>, selected: string): string {
  return (
    `<div class="segmented" role="radiogroup" data-setting="${name}">` +
    options
      .map(([value, label]) => `<button type="button" role="radio" data-value="${value}" aria-checked="${value === selected}">${label}</button>`)
      .join("") +
    `</div>`
  );
}

/** Marks the selected option of a segmented control. */
export function selectSegment(group: HTMLElement, value: string) {
  for (const option of group.querySelectorAll<HTMLElement>("button")) option.setAttribute("aria-checked", String(option.dataset.value === value));
}
