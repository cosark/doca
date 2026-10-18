import { expect, it } from "vitest";
import {
  splitTitleIcon,
  titleIcon,
  withTitleIcon,
  titleEditParts,
} from "@web/shared/utils/resource-title.js";

it.each(["📊", "👩🏽‍💻", "🇨🇳", "1️⃣", "🗂️", "👨‍👩‍👧‍👦"])(
  "uses one complete %s grapheme as the title icon",
  (icon) => {
    expect(titleIcon(icon)).toBe(icon);
    expect(splitTitleIcon(`${icon} 项目进展`)).toEqual({
      icon,
      text: "项目进展",
    });
    expect(withTitleIcon(`${icon} 项目进展`, "🚀")).toBe("🚀 项目进展");
    expect(withTitleIcon(`${icon} 项目进展`, null)).toBe("项目进展");
  },
);
it.each(["2026 项目", "A 标题", "📊项目", "📊 ", "📊", "# 标题", "⭐\n标题"])(
  "keeps the complete non-prefix title %s",
  (title) => {
    expect(splitTitleIcon(title)).toEqual({ icon: null, text: title });
  },
);
it("preserves the original stored title and rejects multiple/manual non-icons", () => {
  const title = "👩🏽‍💻  团队记录";
  expect(splitTitleIcon(title).text).toBe("团队记录");
  expect(title).toBe("👩🏽‍💻  团队记录");
  expect(titleIcon("🚀🎯")).toBeNull();
  expect(titleIcon("1")).toBeNull();
  expect(titleIcon("title")).toBeNull();
});

it("separates an existing icon without changing original title bytes", () => {
  expect(titleEditParts("👩🏽‍💻  团队记录")).toEqual({
    icon: "👩🏽‍💻",
    prefix: "👩🏽‍💻  ",
    text: "团队记录",
  });
  expect(titleEditParts("🗓️ 问题跟踪")).toEqual({
    icon: "🗓️",
    prefix: "🗓️ ",
    text: "问题跟踪",
  });
});
it("keeps an icon in the selector while its new title draft is empty", () => {
  expect(titleEditParts("🚀 ")).toEqual({
    icon: "🚀",
    prefix: "🚀 ",
    text: "",
  });
  expect(splitTitleIcon("🚀 ")).toEqual({ icon: null, text: "🚀 " });
  expect(titleEditParts("🚀计划")).toEqual({
    icon: null,
    prefix: "",
    text: "🚀计划",
  });
});
