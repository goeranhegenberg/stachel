package com.intsode.stachel

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.util.concurrent.Executors

// Stachel app (channels of stachel_client, which host apps embedding it serve the same way).
//
// Share target „Teilen → Stachel“ (stachel_client stachel_share_target.dart): ACTION_SEND / SEND_MULTIPLE with text,
// images or PDFs. The shared streams are copied into <cache>/shared/ right away (content URIs are only readable for a
// short time) and handed to Dart on the channel "stachel/share": "initial" = the share that started the app (once),
// "shared" = a share while the app runs.
class MainActivity : FlutterActivity() {
    private var channel: MethodChannel? = null
    private var initialShare: Intent? = null
    private val io = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        // not again after a rotation/restore or when reopened from the recent apps (same old intent)
        val fromHistory = (intent?.flags ?: 0) and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0
        if (savedInstanceState == null && !fromHistory && isShare(intent)) initialShare = intent
        super.onCreate(savedInstanceState)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Stachel copy (stachel_client stachel_clipboard.dart): text + text/html with the web's stachel/objects@1 payload, so
        // copied board objects paste in the browser like between two browsers (Flutter's clipboard has no text/html).
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "stachel/clipboard").setMethodCallHandler { call, result ->
            when (call.method) {
                "setHtml" -> {
                    val text = call.argument<String>("text") ?: ""
                    val html = call.argument<String>("html") ?: ""
                    val cm = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                    if (cm == null) {
                        result.success(false)
                    } else {
                        cm.setPrimaryClip(ClipData.newHtmlText("Stachel", text, html))
                        result.success(true)
                    }
                }
                else -> result.notImplemented()
            }
        }
        channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "stachel/share").also { ch ->
            ch.setMethodCallHandler { call, result ->
                when (call.method) {
                    "initial" -> {
                        val share = initialShare
                        initialShare = null
                        if (share == null) result.success(null) else read(share) { result.success(it) }
                    }
                    else -> result.notImplemented()
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (isShare(intent)) read(intent) { data -> channel?.invokeMethod("shared", data) }
    }

    private fun isShare(intent: Intent?): Boolean =
        intent?.action == Intent.ACTION_SEND || intent?.action == Intent.ACTION_SEND_MULTIPLE

    /** Copies the shared streams in the background, then [done] on the main thread with the map for Dart. */
    private fun read(intent: Intent, done: (Map<String, Any?>) -> Unit) {
        io.execute {
            val data = try {
                collect(intent)
            } catch (e: Exception) {
                mapOf("text" to "", "subject" to "", "files" to emptyList<Any>())
            }
            runOnUiThread { done(data) }
        }
    }

    @Suppress("DEPRECATION")
    private fun collect(intent: Intent): Map<String, Any?> {
        val uris = mutableListOf<Uri>()
        if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
            intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.let { uris.addAll(it) }
        } else {
            intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)?.let { uris.add(it) }
        }
        val dir = File(cacheDir, "shared").apply { mkdirs() }
        cleanUp(dir)
        val files = uris.take(MAX_FILES).mapIndexed { i, uri -> copy(uri, dir, i, intent.type) }
        return mapOf(
            "text" to (intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: ""),
            "subject" to (intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: ""),
            "files" to files,
        )
    }

    private fun copy(uri: Uri, dir: File, index: Int, fallbackType: String?): Map<String, Any?> {
        var name = uri.lastPathSegment?.substringAfterLast('/') ?: "datei"
        var size = -1L
        try {
            contentResolver.query(uri, null, null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (n >= 0 && !c.isNull(n)) name = c.getString(n)
                    val s = c.getColumnIndex(OpenableColumns.SIZE)
                    if (s >= 0 && !c.isNull(s)) size = c.getLong(s)
                }
            }
        } catch (_: Exception) {
        }
        val mime = (contentResolver.getType(uri) ?: fallbackType ?: "application/octet-stream").lowercase()
        val base = mapOf("name" to name, "mime" to mime)
        if (size > MAX_BYTES) return base + mapOf("path" to "", "size" to size, "error" to "too_large")
        val safe = name.replace(Regex("[^A-Za-z0-9._-]"), "_").takeLast(80)
        val target = File(dir, "${System.currentTimeMillis()}_${index}_$safe")
        return try {
            var copied = 0L
            contentResolver.openInputStream(uri)!!.use { input ->
                target.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        copied += n
                        if (copied > MAX_BYTES) throw TooLarge()
                        out.write(buf, 0, n)
                    }
                }
            }
            base + mapOf("path" to target.absolutePath, "size" to copied)
        } catch (e: TooLarge) {
            target.delete()
            base + mapOf("path" to "", "size" to size, "error" to "too_large")
        } catch (e: Exception) {
            target.delete()
            base + mapOf("path" to "", "size" to size, "error" to "unreadable")
        }
    }

    /** Copies older than a day are leftovers of shares nobody finished. */
    private fun cleanUp(dir: File) {
        val old = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
        dir.listFiles()?.forEach { if (it.lastModified() < old) it.delete() }
    }

    private class TooLarge : Exception()

    companion object {
        /** Same as stachelShareMaxBytes in Dart (board limit for images and PDFs: 15 MB). */
        private const val MAX_BYTES = 15L * 1024 * 1024
        private const val MAX_FILES = 20
    }
}
