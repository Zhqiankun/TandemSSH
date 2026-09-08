import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { changeAppLanguage } from "../../i18n/i18n";
import { LocalizedText } from "../../i18n/LocalizedText";
import { translateUiText } from "../../i18n/ui-text";
import en from "../../locales/en.json";
import zh from "../../locales/translated/zh_CN.json";

afterEach(cleanup);

describe("TandemSSH Chinese interface", () => {
  it("renders Chinese immediately and updates mounted labels on language changes", async () => {
    await changeAppLanguage("zh-CN");
    render(<LocalizedText id="save" />);
    expect(screen.getByText("保存")).toBeTruthy();
    await act(() => changeAppLanguage("en"));
    expect(screen.getByText("Save")).toBeTruthy();
    await act(() => changeAppLanguage("zh-CN"));
    expect(screen.getByText("保存")).toBeTruthy();
  });

  it("resolves notifications and metadata at access time", async () => {
    const item = {
      get label() {
        return translateUiText("Recording retention updated");
      },
    };
    await changeAppLanguage("en");
    expect(item.label).toBe("Recording retention updated");
    await changeAppLanguage("zh-CN");
    expect(item.label).toBe("录制保留设置已更新");
  });

  it("keeps the Chinese resource complete and preserves dynamic values", () => {
    const placeholders = (value: string) =>
      [
        ...new Set(
          [...value.matchAll(/{{\s*-?\s*([^},]+)(?:,[^}]*)?}}/g)].map((match) =>
            match[1].trim(),
          ),
        ),
      ].sort();
    const failures: string[] = [];
    function check(original: unknown, translated: unknown, key = "") {
      if (typeof original === "string") {
        if (typeof translated !== "string")
          failures.push(`${key}: missing translation`);
        else if (
          JSON.stringify(placeholders(original)) !==
          JSON.stringify(placeholders(translated))
        )
          failures.push(`${key}: interpolation differs`);
      } else if (original && typeof original === "object") {
        for (const [child, value] of Object.entries(original))
          check(
            value,
            (translated as Record<string, unknown> | undefined)?.[child],
            key ? `${key}.${child}` : child,
          );
      }
    }
    check(en, zh);
    expect(failures).toEqual([]);
  });
});
