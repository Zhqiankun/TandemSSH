import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18n from "@/i18n/i18n";
import { DraggableWindow } from "@/features/file-manager/components/DraggableWindow";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("makes an offscreen editor visible and follows viewport shrink", async () => {
  await i18n.changeLanguage("zh-CN");
  vi.stubGlobal("innerWidth", 800);
  vi.stubGlobal("innerHeight", 600);
  const close = vi.fn();
  const { container } = render(
    <DraggableWindow
      title="链接编辑器"
      initialX={900}
      initialY={500}
      initialWidth={900}
      initialHeight={660}
      onClose={close}
    >
      编辑内容
    </DraggableWindow>,
  );
  const root = container.firstElementChild as HTMLElement;
  await waitFor(() =>
    expect(root).toHaveStyle({
      left: "0px",
      top: "49px",
      width: "800px",
      height: "551px",
    }),
  );
  vi.stubGlobal("innerWidth", 500);
  vi.stubGlobal("innerHeight", 400);
  fireEvent(window, new Event("resize"));
  await waitFor(() =>
    expect(root).toHaveStyle({
      left: "0px",
      top: "49px",
      width: "500px",
      height: "351px",
    }),
  );
  fireEvent.click(screen.getByTitle("关闭"));
  expect(close).toHaveBeenCalledTimes(1);
});
