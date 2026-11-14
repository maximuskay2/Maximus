import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ServiceEndpointPicker, ServiceEndpointView, type EndpointInfo } from "./ServiceEndpoint";

const editable: EndpointInfo = {
  url: "http://127.0.0.1:8787",
  source: "settings",
  managedByEnv: false,
  defaultUrl: "https://accounts.meetnote.cc",
  localUrl: "http://127.0.0.1:8787",
};

describe("service endpoint picker", () => {
  it("renders presets and custom input when the install owns the address", () => {
    const noop = (): void => undefined;
    const html = renderToStaticMarkup(createElement(ServiceEndpointView, {
      info: editable, custom: "", busy: false, error: null, onCustom: noop, onSave: noop,
    }));
    expect(html).toContain("http://127.0.0.1:8787");
    expect(html).toContain("Production");
    expect(html).toContain("Local worker");
    expect(html).toContain("Custom service address");
    expect(html).not.toContain("set by the server environment");
  });

  it("locks the picker and shows errors", () => {
    const noop = (): void => undefined;
    const managed = renderToStaticMarkup(createElement(ServiceEndpointView, {
      info: { ...editable, managedByEnv: true }, custom: "", busy: false, error: null, onCustom: noop, onSave: noop,
    }));
    expect(managed).toContain("set by the server environment");
    expect(managed).not.toContain("Local worker");
    const failed = renderToStaticMarkup(createElement(ServiceEndpointView, {
      info: editable, custom: "", busy: false, error: "That address did not answer.", onCustom: noop, onSave: noop,
    }));
    expect(failed).toContain("That address did not answer.");
  });

  it("renders nothing before the endpoint loads", () => {
    expect(renderToStaticMarkup(createElement(ServiceEndpointPicker, {}))).toBe("");
  });
});
