import Social
import UIKit
import UniformTypeIdentifiers

/// Share sheet → opens Maximus with maximus://share?text=…
class ShareViewController: SLComposeServiceViewController {
  override func isContentValid() -> Bool {
    !(contentText ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      || hasIncomingTextAttachment()
  }

  override func didSelectPost() {
    Task { await finishShare() }
  }

  override func configurationItems() -> [Any]! { [] }

  private func finishShare() async {
    var text = (contentText ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if text.isEmpty {
      text = await loadSharedText() ?? ""
    }
    guard !text.isEmpty,
      var components = URLComponents(string: "maximus://share")
    else {
      extensionContext?.completeRequest(returningItems: nil)
      return
    }
    components.queryItems = [URLQueryItem(name: "text", value: text)]
    guard let url = components.url else {
      extensionContext?.completeRequest(returningItems: nil)
      return
    }
    await openInHost(url)
    extensionContext?.completeRequest(returningItems: nil)
  }

  private func hasIncomingTextAttachment() -> Bool {
    guard let items = extensionContext?.inputItems as? [NSExtensionItem] else { return false }
    for item in items {
      for provider in item.attachments ?? [] {
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier)
          || provider.hasItemConformingToTypeIdentifier(UTType.url.identifier)
        {
          return true
        }
      }
    }
    return false
  }

  private func loadSharedText() async -> String? {
    guard let items = extensionContext?.inputItems as? [NSExtensionItem] else { return nil }
    for item in items {
      for provider in item.attachments ?? [] {
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
          if let value = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier),
            let text = value as? String
          {
            return text.trimmingCharacters(in: .whitespacesAndNewlines)
          }
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
          if let value = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier),
            let url = value as? URL
          {
            return url.absoluteString
          }
        }
      }
    }
    return nil
  }

  @MainActor
  private func openInHost(_ url: URL) async {
    var responder: UIResponder? = self
    while let current = responder {
      if let application = current as? UIApplication {
        await application.open(url)
        return
      }
      // Share extensions cannot always reach UIApplication; fall back to openURL selector.
      if current.responds(to: Selector(("openURL:options:completionHandler:"))) {
        current.perform(Selector(("openURL:options:completionHandler:")), with: url, with: [:])
        return
      }
      responder = current.next
    }
    _ = openURL(url)
  }

  @objc @discardableResult
  private func openURL(_ url: URL) -> Bool {
    var responder: UIResponder? = self
    while let current = responder {
      let selector = sel_registerName("openURL:")
      if current.responds(to: selector) {
        current.perform(selector, with: url)
        return true
      }
      responder = current.next
    }
    return false
  }
}
