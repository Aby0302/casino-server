import SwiftUI
import WebKit

@main
struct RetailerwayCasinoApp: App {
    var body: some Scene {
        WindowGroup {
            WebShellView()
                .ignoresSafeArea()
        }
    }
}

struct WebShellView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "casinoShell")

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.applicationNameForUserAgent = "RetailerwayCasinoiOS/1"
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        if #available(iOS 10.0, *) {
            configuration.mediaTypesRequiringUserActionForPlayback = []
        }

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.02, green: 0.02, blue: 0.03, alpha: 1.0)
        context.coordinator.webView = webView
        webView.load(URLRequest(url: CasinoShellConfig.lobbyURL()))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "casinoShell",
                  let payload = message.body as? [String: Any],
                  payload["type"] as? String == "setPlayer",
                  let id = payload["id"] as? String else {
                return
            }

            CasinoShellConfig.savePlayer(id: id, name: payload["name"] as? String)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            showError(error.localizedDescription)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            showError(error.localizedDescription)
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            let scheme = navigationAction.request.url?.scheme?.lowercased()
            decisionHandler((scheme == nil || scheme == "http" || scheme == "https") ? .allow : .cancel)
        }

        private func showError(_ message: String) {
            let safeMessage = CasinoShellConfig.escapeHTML(message)
            let safeRetryURL = CasinoShellConfig.escapeHTML(CasinoShellConfig.lobbyURL().absoluteString)
            let html = """
            <!doctype html>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <body style="margin:0;background:#050508;color:#fff;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:grid;place-items:center;height:100vh;text-align:center;padding:24px;box-sizing:border-box">
              <main>
                <h1>Retailerway Casino</h1>
                <p>\(safeMessage)</p>
                <a href="\(safeRetryURL)" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#ff3d81;color:#fff;font-weight:800;text-decoration:none">Retry</a>
              </main>
            </body>
            """
            webView?.loadHTMLString(html, baseURL: URL(string: CasinoShellConfig.serverBase()))
        }
    }
}

enum CasinoShellConfig {
    private static let defaults = UserDefaults.standard

    static func serverBase() -> String {
        let configured = bundleString("CasinoServerBase")
        return trimTrailingSlash(configured.isEmpty ? "https://casino.retailerway.com" : configured)
    }

    static func lobbyURL() -> URL {
        var components = URLComponents(string: serverBase() + "/client/lobby")!
        var queryItems = [URLQueryItem(name: "sessionID", value: sessionID())]
        let secret = bundleString("ClientRenderSecret")
        if !secret.isEmpty {
            queryItems.append(URLQueryItem(name: "clientSecret", value: secret))
        }
        components.queryItems = queryItems
        return components.url!
    }

    static func sessionID() -> String {
        if let existing = defaults.string(forKey: "session_id"), !existing.isEmpty {
            return existing
        }
        let created = "ios-" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(8).lowercased()
        defaults.set(String(created), forKey: "session_id")
        return String(created)
    }

    static func savePlayer(id: String, name: String?) {
        let cleanID = sanitizeSessionID(id)
        guard !cleanID.isEmpty else { return }
        let trimmedName = name ?? ""
        let cleanName = trimmedName.isEmpty ? cleanID : trimmedName
        defaults.set(cleanID, forKey: "session_id")
        defaults.set(cleanName, forKey: "player_name")
    }

    static func escapeHTML(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }

    private static func bundleString(_ key: String) -> String {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return "" }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.hasPrefix("$(") ? "" : value
    }

    private static func trimTrailingSlash(_ value: String) -> String {
        var result = value
        while result.hasSuffix("/") {
            result.removeLast()
        }
        return result
    }

    private static func sanitizeSessionID(_ value: String) -> String {
        String(value.filter { character in
            character.isLetter || character.isNumber || character == "_" || character == "." || character == ":" || character == "-"
        }.prefix(128))
    }
}
