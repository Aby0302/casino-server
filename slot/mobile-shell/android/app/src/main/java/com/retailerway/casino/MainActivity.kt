package com.retailerway.casino

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import java.util.UUID

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private val prefs by lazy { getSharedPreferences("casino-shell", Context.MODE_PRIVATE) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        CookieManager.getInstance().setAcceptCookie(true)

        webView = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            setBackgroundColor(Color.rgb(5, 5, 8))
            addJavascriptInterface(CasinoBridge(), "CasinoShell")
            webChromeClient = WebChromeClient()
            webViewClient = ShellWebViewClient()
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.loadWithOverviewMode = true
            settings.useWideViewPort = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.userAgentString = settings.userAgentString + " RetailerwayCasinoAndroid/1"
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)
        setContentView(webView)

        webView.loadUrl(lobbyUrl())
    }

    @Deprecated("Deprecated by Android framework; kept to avoid AndroidX dependency.")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
            return
        }
        super.onBackPressed()
    }

    private fun lobbyUrl(): String {
        val builder = Uri.parse(baseUrl().trimEnd('/') + "/client/lobby").buildUpon()
            .appendQueryParameter("sessionID", sessionId())

        if (BuildConfig.CLIENT_RENDER_SECRET.isNotBlank()) {
            builder.appendQueryParameter("clientSecret", BuildConfig.CLIENT_RENDER_SECRET)
        }

        return builder.build().toString()
    }

    private fun baseUrl(): String = BuildConfig.CASINO_SERVER_BASE.ifBlank {
        "https://casino.retailerway.com"
    }

    private fun sessionId(): String {
        val existing = prefs.getString("session_id", null)
        if (!existing.isNullOrBlank()) return existing
        val created = "android-" + UUID.randomUUID().toString().replace("-", "").take(8)
        prefs.edit().putString("session_id", created).apply()
        return created
    }

    private fun savePlayer(id: String, name: String) {
        val cleanId = sanitizeSessionId(id)
        if (cleanId.isBlank()) return
        prefs.edit()
            .putString("session_id", cleanId)
            .putString("player_name", name.ifBlank { cleanId })
            .apply()
    }

    private fun sanitizeSessionId(value: String): String = value
        .filter { it.isLetterOrDigit() || it == '_' || it == '.' || it == ':' || it == '-' }
        .take(128)

    inner class CasinoBridge {
        @JavascriptInterface
        fun setPlayer(id: String, name: String) {
            savePlayer(id, name)
        }

        @JavascriptInterface
        fun platform(): String = "android"
    }

    inner class ShellWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val scheme = request.url.scheme ?: return false
            return scheme != "http" && scheme != "https"
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) {
                showError("Network error: ${error.description}")
            }
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
            if (request.isForMainFrame && errorResponse.statusCode >= 400) {
                showError("Server error: HTTP ${errorResponse.statusCode}")
            }
        }
    }

    private fun showError(message: String) {
        val safeMessage = escapeHtml(message)
        val safeRetryUrl = escapeHtml(lobbyUrl())
        val html = """
            <!doctype html>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <body style="margin:0;background:#050508;color:#fff;font-family:sans-serif;display:grid;place-items:center;height:100vh;text-align:center;padding:24px;box-sizing:border-box">
              <main>
                <h1>Retailerway Casino</h1>
                <p>$safeMessage</p>
                <button onclick="location.href='$safeRetryUrl'" style="padding:12px 18px;border:0;border-radius:12px;background:#ff3d81;color:#fff;font-weight:800">Retry</button>
              </main>
            </body>
        """.trimIndent()
        webView.loadDataWithBaseURL(baseUrl(), html, "text/html", "UTF-8", null)
    }

    private fun escapeHtml(value: String): String = value
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
}
