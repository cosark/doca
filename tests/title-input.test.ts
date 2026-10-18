// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TitleInput } from "@web/features/documents/title-input.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@web/shared/i18n.js", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

it("shows one title icon while submitting the exact complete title through FormData", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Form() {
    const [title, setTitle] = useState("🗓️  项目跟踪");
    return createElement(
      "form",
      null,
      createElement(TitleInput, {
        name: "title",
        value: title,
        onValueChange: setTitle,
        required: true,
        maxLength: 160,
      }),
    );
  }
  try {
    await act(() => root.render(createElement(Form)));
    const input = host.querySelector<HTMLInputElement>(
        '.resource-title-field > input:not([type="hidden"])',
      )!,
      form = host.querySelector("form")!;
    expect(input.value).toBe("项目跟踪");
    expect(host.querySelector("summary")!.textContent).toBe("🗓️");
    expect(new FormData(form).getAll("title")).toEqual(["🗓️  项目跟踪"]);
    expect(input.maxLength).toBe(155);
    const select = Array.from(host.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label") === "🚀",
    )!;
    await act(() => select.click());
    expect(input.value).toBe("项目跟踪");
    expect(new FormData(form).getAll("title")).toEqual(["🚀 项目跟踪"]);
    await act(() =>
      host.querySelector<HTMLButtonElement>(".title-icon-remove")!.click(),
    );
    expect(input.value).toBe("项目跟踪");
    expect(new FormData(form).getAll("title")).toEqual(["项目跟踪"]);
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});

it("keeps a chosen icon outside an empty required text field", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Form() {
    const [title, setTitle] = useState("");
    return createElement(
      "form",
      null,
      createElement(TitleInput, {
        name: "title",
        value: title,
        onValueChange: setTitle,
        required: true,
      }),
    );
  }
  try {
    await act(() => root.render(createElement(Form)));
    await act(() =>
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.getAttribute("aria-label") === "🚀")!
        .click(),
    );
    expect(host.querySelector("summary")!.textContent).toBe("🚀");
    expect(
      host.querySelector<HTMLInputElement>(
        '.resource-title-field > input:not([type="hidden"])',
      )!.value,
    ).toBe("");
    const form = host.querySelector("form")!;
    expect(form.checkValidity()).toBe(false);
    expect(new FormData(form).getAll("title")).toEqual(["🚀 "]);
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});
