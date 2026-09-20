package com.aa.jm

import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.WindowCompat
import androidx.documentfile.provider.DocumentFile
import java.io.File

/**
 * Native side of the shell bridge exposed to the web layer as `window.JMShell`.
 *
 * Two responsibilities:
 *
 * 1. Keep the status/navigation bar icons in sync with the in-app theme.
 *    `tauri-plugin-edge-to-edge` derives them from the *system* night mode once,
 *    at plugin load, and exposes no command to change it later.
 *
 * 2. Make "export to a directory of my choosing" work on Android. Anything
 *    outside the app's own folders is only writable through the Storage Access
 *    Framework, so the tree URI is captured with a system folder picker, its
 *    permission persisted, and files are streamed into it from a staged copy.
 *
 * The bridge is only reachable from the bundled frontend, which is the only
 * content this WebView loads.
 */
class MainActivity : TauriActivity() {
  private var webViewRef: WebView? = null
  private var pickDirLauncher: ActivityResultLauncher<Uri?>? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    pickDirLauncher =
      registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null) {
          try {
            contentResolver.takePersistableUriPermission(
              uri,
              Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            )
            prefs().edit().putString(PREF_TREE_URI, uri.toString()).apply()
          } catch (e: Exception) {
            Log.w(TAG, "persist tree permission failed: $e")
          }
        }
        val arg = if (uri != null) "\"$uri\"" else "null"
        notifyJs("window.__jmShellOnDirPicked && window.__jmShellOnDirPicked($arg);")
      }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webViewRef = webView
    webView.addJavascriptInterface(ShellBridge(), "JMShell")
  }

  override fun onDestroy() {
    webViewRef = null
    super.onDestroy()
  }

  private fun prefs(): SharedPreferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)

  private fun notifyJs(script: String) {
    val view = webViewRef ?: return
    view.post { view.evaluateJavascript(script, null) }
  }

  inner class ShellBridge {
    // ---- Theme -----------------------------------------------------------

    @JavascriptInterface
    fun setDarkSystemBars(dark: Boolean) {
      runOnUiThread {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        // Light bars means dark icons. Same API the edge-to-edge plugin uses
        // once at startup from the system night mode.
        controller.isAppearanceLightStatusBars = !dark
        controller.isAppearanceLightNavigationBars = !dark
      }
    }

    // ---- Export destination ---------------------------------------------

    /**
     * Always-writable location that needs no permission and is still reachable
     * from a file manager: `Android/data/<pkg>/files/JM`.
     */
    @JavascriptInterface
    fun defaultExportDir(): String {
      val dir = File(getExternalFilesDir(null), "JM")
      if (!dir.exists()) dir.mkdirs()
      return dir.absolutePath
    }

    /** Tree URI of the folder the user picked, or null. */
    @JavascriptInterface
    fun savedExportDir(): String? = prefs().getString(PREF_TREE_URI, null)

    /** Human readable name of the picked folder, or empty. */
    @JavascriptInterface
    fun savedExportDirLabel(): String {
      val uri = prefs().getString(PREF_TREE_URI, null) ?: return ""
      return try {
        DocumentFile.fromTreeUri(this@MainActivity, Uri.parse(uri))?.name ?: ""
      } catch (e: Exception) {
        ""
      }
    }

    /** Opens the system folder picker; the result arrives via a JS callback. */
    @JavascriptInterface
    fun pickExportDir() {
      runOnUiThread {
        try {
          pickDirLauncher?.launch(null)
        } catch (e: Exception) {
          Log.w(TAG, "launch folder picker failed: $e")
          notifyJs("window.__jmShellOnDirPicked && window.__jmShellOnDirPicked(null);")
        }
      }
    }

    @JavascriptInterface
    fun clearExportDir(): Boolean {
      val uri = prefs().getString(PREF_TREE_URI, null) ?: return true
      return try {
        contentResolver.releasePersistableUriPermission(
          Uri.parse(uri),
          Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        )
        prefs().edit().remove(PREF_TREE_URI).apply()
        true
      } catch (e: Exception) {
        Log.w(TAG, "release tree permission failed: $e")
        prefs().edit().remove(PREF_TREE_URI).apply()
        false
      }
    }

    /**
     * Streams `sourcePath` into the picked folder at `relativePath`
     * (e.g. `漫画名/001-第一话/0001.jpg`), creating directories as needed.
     * Returns an empty string on success, otherwise an error message.
     */
    @JavascriptInterface
    fun copyToTree(relativePath: String, sourcePath: String): String {
      val uriString = prefs().getString(PREF_TREE_URI, null) ?: return "未选择导出目录"
      val parts = relativePath.split('/').filter { it.isNotBlank() }
      if (parts.isEmpty()) return "路径无效"
      val source = File(sourcePath)
      if (!source.isFile) return "源文件不存在"

      return try {
        val tree = DocumentFile.fromTreeUri(this@MainActivity, Uri.parse(uriString))
          ?: return "无法访问所选目录"
        var dir = tree
        for (i in 0 until parts.size - 1) {
          val name = parts[i]
          dir = dir.findFile(name) ?: dir.createDirectory(name)
            ?: return "创建目录失败：$name"
        }
        val fileName = parts.last()
        // Overwrite a previous export of the same file.
        dir.findFile(fileName)?.delete()
        val target = dir.createFile(mimeOf(fileName), fileName)
          ?: return "创建文件失败：$fileName"
        contentResolver.openOutputStream(target.uri)?.use { output ->
          source.inputStream().use { input -> input.copyTo(output, 64 * 1024) }
        } ?: return "无法写入：$fileName"
        ""
      } catch (e: Exception) {
        Log.w(TAG, "copyToTree failed: $e")
        e.toString()
      }
    }

    /** Whether the persisted grant still resolves to a usable folder. */
    @JavascriptInterface
    fun exportDirWritable(): Boolean {
      val uriString = prefs().getString(PREF_TREE_URI, null) ?: return false
      return try {
        DocumentFile.fromTreeUri(this@MainActivity, Uri.parse(uriString))?.canWrite() == true
      } catch (e: Exception) {
        false
      }
    }
  }

  private fun mimeOf(name: String): String =
    when (name.substringAfterLast('.', "").lowercase()) {
      "pdf" -> "application/pdf"
      "png" -> "image/png"
      "webp" -> "image/webp"
      "gif" -> "image/gif"
      "txt" -> "text/plain"
      "json" -> "application/json"
      "zip" -> "application/zip"
      else -> "image/jpeg"
    }

  companion object {
    private const val TAG = "jm-shell"
    private const val PREFS_NAME = "jm_shell_prefs"
    private const val PREF_TREE_URI = "export_tree_uri"
  }
}
