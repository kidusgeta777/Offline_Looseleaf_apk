package expo.modules.looseoverlay

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LooseOverlayModule : Module() {
  private val ctx: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  override fun definition() = ModuleDefinition {
    Name("LooseOverlay")

    Function("canDrawOverlays") {
      Settings.canDrawOverlays(ctx)
    }

    Function("requestOverlayPermission") {
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:" + ctx.packageName)
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(intent)
    }

    Function("start") {
      val c = ctx
      if (!Settings.canDrawOverlays(c)) return@Function false
      LoosePrefs.setEnabled(c, true)
      val intent = Intent(c, OverlayService::class.java)
      if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(intent) else c.startService(intent)
      true
    }

    Function("stop") {
      val c = ctx
      LoosePrefs.setEnabled(c, false)
      c.stopService(Intent(c, OverlayService::class.java))
    }

    Function("isEnabled") {
      LoosePrefs.enabled(ctx)
    }

    Function("isRunning") {
      OverlayService.running
    }

    Function("getIdeas") {
      LoosePrefs.ideasJson(ctx)
    }

    Function("addIdea") { text: String ->
      LoosePrefs.addIdea(ctx, text)
    }

    Function("setIdeas") { json: String ->
      LoosePrefs.setIdeasJson(ctx, json)
    }

    Function("deleteIdea") { id: String ->
      LoosePrefs.deleteIdea(ctx, id)
    }

    Function("clearIdeas") {
      LoosePrefs.clearIdeas(ctx)
    }
  }
}
