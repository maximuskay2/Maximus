import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  BotAvatar,
  MausAvatar,
  resolveBotAvatarOutcome,
  type BotAvatarProps,
  type MausAvatarProps,
} from "./Avatar";

const render = (props: Partial<MausAvatarProps>) =>
  renderToStaticMarkup(createElement(MausAvatar, { color: "green", animated: false, ...props }));

const renderBot = (bot: Partial<BotAvatarProps["bot"]>) =>
  renderToStaticMarkup(
    createElement(BotAvatar, { bot: { color: "green", ...bot }, animated: false }),
  );

describe("MausAvatar body", () => {
  it("paints the colorizable bull for every ordinary body", () => {
    for (const bodyId of [undefined, "cursor", "star", "blob"] as const) {
      const markup = render(bodyId ? { bodyId } : {});
      expect(markup).toContain('data-bull-avatar=""');
      expect(markup).toContain("/bull-avatar.png");
      expect(markup).toContain("mix-blend-mode:color");
    }
  });

  it("tints the bull with the per-bot gradient", () => {
    const markup = render({ color: "blue" });
    expect(markup).toContain("linear-gradient(180deg");
    expect(markup).toContain("#377FE6");
  });
});

describe("mascot facial feature colors", () => {
  it("keeps carved Halloween inks when an override is set", () => {
    expect(renderBot({ mascotBody: "pumpkin", mascotFaceColor: "black" })).toContain('fill="#000000"');
    expect(renderBot({ mascotBody: "pumpkin" })).toContain('stroke="#0d0a10"');
  });

  it("does not paint features over an uploaded image", () => {
    const markup = renderBot({ mascotFaceColor: "black", avatarUrl: "/api/attachments/photo.png", avatarCrop: "circle" });
    expect(markup).toContain("<img");
    expect(markup).not.toContain("<svg");
  });
});

describe("BotAvatar's two avatar outcomes", () => {
  it("zooms and positions a custom image inside its crop", () => {
    const markup = renderBot({
      avatarUrl: "/api/attachments/cat.webp",
      avatarCrop: "circle",
      avatarZoom: 2,
      avatarFocusX: 0.25,
      avatarFocusY: 0.75,
    });
    expect(markup).toContain("scale(2)");
    expect(markup).toContain("25% 75%");
    expect(markup).toContain("border-radius:50%");
  });

  it("renders a flat cropped image for circle/rounded/square, with no mascot at all", () => {
    const markup = renderBot({ avatarUrl: "/api/attachments/cat.webp", avatarCrop: "circle" });
    expect(markup).toContain("<img");
    expect(markup).not.toContain("<svg");
  });

  it("shows the image as it is, with no mascot face painted on it", () => {
    const markup = renderBot({ avatarUrl: "/api/attachments/cat.webp", avatarCrop: "square" });
    expect(markup).toContain("border-radius:0");
    expect(markup).toContain("<img");
    expect(markup).not.toContain("<image");
    expect(markup).not.toContain("radialGradient");
  });

  it("renders the colorizable bull when the crop is mascot, image or not", () => {
    const markup = renderBot({ avatarUrl: "/api/attachments/cat.webp", avatarCrop: "mascot" });
    expect(markup).toContain('data-bull-avatar=""');
    expect(markup).toContain("/bull-avatar.png");
  });

  it("falls back to the bull when a flat crop has no valid image", () => {
    const markup = renderBot({ avatarUrl: undefined, avatarCrop: "circle" });
    expect(markup).toContain('data-bull-avatar=""');
  });
});

describe("resolveBotAvatarOutcome", () => {
  it("falls back to the gradient mascot for an image that failed to load", () => {
    expect(
      resolveBotAvatarOutcome({ avatarCrop: "circle", hasUrl: true, imageFailed: true }),
    ).toBe("gradientMascot");
  });

  it("renders a good flat image flat", () => {
    expect(
      resolveBotAvatarOutcome({ avatarCrop: "rounded", hasUrl: true, imageFailed: false }),
    ).toBe("flatImage");
  });

  it("keeps the mascot crop on the gradient mascot even with a loaded image", () => {
    expect(
      resolveBotAvatarOutcome({ avatarCrop: "mascot", hasUrl: true, imageFailed: false }),
    ).toBe("gradientMascot");
  });

  it("falls back to the gradient mascot when there is no image at all", () => {
    expect(
      resolveBotAvatarOutcome({ avatarCrop: "square", hasUrl: false, imageFailed: false }),
    ).toBe("gradientMascot");
  });
});
