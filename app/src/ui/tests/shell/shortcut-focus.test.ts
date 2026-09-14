import { afterEach, expect, it } from "vitest";
import { shouldIgnoreShellShortcut } from "../../shell/shortcut-focus";
afterEach(() => document.body.replaceChildren());
function from(html: string, options: KeyboardEventInit = {}) {
  document.body.innerHTML = html;
  const target = document.querySelector("[data-target]")!;
  const event = new KeyboardEvent("keydown", {
    key: "1",
    code: "Digit1",
    altKey: true,
    bubbles: true,
    ...options,
  });
  let ignored = false;
  target.addEventListener("keydown", (e) => {
    ignored = shouldIgnoreShellShortcut(e as KeyboardEvent);
  });
  target.dispatchEvent(event);
  return ignored;
}
it.each([
  "<input data-target>",
  "<textarea data-target></textarea>",
  "<select data-target></select>",
  '<div contenteditable="true"><span data-target>x</span></div>',
  '<div role="textbox" data-target></div>',
  '<div role="dialog"><button data-target>确认</button></div>',
])("yields to editing or dialog focus: %s", (html) =>
  expect(from(html)).toBe(true),
);
it("allows normal xterm delegated shortcuts", () =>
  expect(
    from('<textarea class="xterm-helper-textarea" data-target></textarea>'),
  ).toBe(false));
it.each([{ isComposing: true }, { keyCode: 229 }])(
  "yields to terminal IME: %j",
  (options) =>
    expect(
      from(
        '<textarea class="xterm-helper-textarea" data-target></textarea>',
        options,
      ),
    ).toBe(true),
);
it("allows normal shell navigation outside editors", () =>
  expect(from("<button data-target>主机</button>")).toBe(false));
