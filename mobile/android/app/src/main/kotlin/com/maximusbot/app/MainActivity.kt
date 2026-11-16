package com.maximusbot.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.AlarmClock
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.time.Instant
import java.time.ZoneId

class MainActivity : FlutterActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    rewriteShareIntent(intent)
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getSystemService(NotificationManager::class.java).createNotificationChannel(
        NotificationChannel("maximus_push", "Maximus", NotificationManager.IMPORTANCE_HIGH),
      )
    }
  }

  override fun onNewIntent(intent: Intent) {
    rewriteShareIntent(intent)
    super.onNewIntent(intent)
    setIntent(intent)
  }

  override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
    super.configureFlutterEngine(flutterEngine)
    MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "maximus/phone_apps")
      .setMethodCallHandler { call, result ->
        when (call.method) {
          "alarms.create" -> {
            val title = call.argument<String>("title") ?: ""
            val at = call.argument<String>("at")
            if (title.isEmpty() || at.isNullOrBlank()) {
              result.error("bad_args", "title and at required", null)
              return@setMethodCallHandler
            }
            try {
              val instant = Instant.parse(at)
              val local = instant.atZone(ZoneId.systemDefault())
              val intent = Intent(AlarmClock.ACTION_SET_ALARM).apply {
                putExtra(AlarmClock.EXTRA_MESSAGE, title)
                putExtra(AlarmClock.EXTRA_HOUR, local.hour)
                putExtra(AlarmClock.EXTRA_MINUTES, local.minute)
                putExtra(AlarmClock.EXTRA_SKIP_UI, false)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
              }
              startActivity(intent)
              result.success("android-alarm")
            } catch (error: Exception) {
              result.error("save_failed", error.message, null)
            }
          }
          "alarms.list", "alarms.delete",
          "reminders.permission", "reminders.requestPermission",
          "home.permission", "home.requestPermission" ->
            result.success(
              when (call.method) {
                "alarms.list" -> emptyList<Any>()
                "alarms.delete" -> false
                else -> "denied"
              },
            )
          else -> result.notImplemented()
        }
      }
  }

  /** ACTION_SEND text becomes maximus://share?text=… for app_links. */
  private fun rewriteShareIntent(intent: Intent?) {
    if (intent == null) return
    if (intent.action != Intent.ACTION_SEND) return
    if (intent.type?.startsWith("text/") != true) return
    val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty()
    if (text.isEmpty()) return
    intent.action = Intent.ACTION_VIEW
    intent.data = Uri.parse("maximus://share").buildUpon()
      .appendQueryParameter("text", text)
      .build()
  }
}
