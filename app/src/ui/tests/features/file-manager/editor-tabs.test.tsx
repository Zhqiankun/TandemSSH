import "@/i18n/i18n";
import React, { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  WindowManager,
  useWindowManager,
} from "../../../features/file-manager/components/WindowManager";
afterEach(cleanup);
function Document({ id, name }: { id: string; name: string }) {
  const [value, setValue] = useState("");
  const { closeWindow } = useWindowManager();
  return (
    <div>
      <input
        aria-label={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button onClick={() => closeWindow(id)}>关闭当前</button>
    </div>
  );
}
function Openers() {
  const { openWindow } = useWindowManager();
  return (
    <>
      {["a.js", "b.json"].map((name) => (
        <button
          key={name}
          onClick={() =>
            openWindow({
              title: name,
              x: 0,
              y: 0,
              width: 400,
              height: 300,
              isMaximized: false,
              isMinimized: false,
              component: (id) => <Document id={id} name={name} />,
            })
          }
        >
          打开{name}
        </button>
      ))}
    </>
  );
}
it("keeps independent unsaved values while switching and closing editor tabs", () => {
  render(
    <WindowManager>
      <Openers />
    </WindowManager>,
  );
  fireEvent.click(screen.getByText("打开a.js"));
  fireEvent.change(screen.getByRole("textbox", { name: "a.js" }), {
    target: { value: "first draft" },
  });
  fireEvent.click(screen.getByText("打开b.json"));
  fireEvent.change(screen.getByRole("textbox", { name: "b.json" }), {
    target: { value: "second draft" },
  });
  fireEvent.click(screen.getByRole("tab", { name: "a.js" }));
  expect(
    (screen.getByRole("textbox", { name: "a.js" }) as HTMLInputElement).value,
  ).toBe("first draft");
  fireEvent.keyDown(screen.getByRole("tab", { name: "a.js" }), {
    key: "ArrowRight",
  });
  expect(
    (screen.getByRole("textbox", { name: "b.json" }) as HTMLInputElement).value,
  ).toBe("second draft");
  fireEvent.click(screen.getByRole("button", { name: "关闭当前" }));
  expect(screen.queryByRole("tab", { name: "b.json" })).toBeNull();
  expect(
    (screen.getByRole("textbox", { name: "a.js" }) as HTMLInputElement).value,
  ).toBe("first draft");
});
