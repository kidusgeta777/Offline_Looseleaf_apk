package expo.modules.looseoverlay

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/** Ideas saved on the phone, the on/off choice and the circle's position. Nothing leaves the device. */
object LoosePrefs {
  private const val NAME = "loose_prefs"

  private fun sp(c: Context): SharedPreferences =
    c.applicationContext.getSharedPreferences(NAME, Context.MODE_PRIVATE)

  // ---- ideas (stored as a JSON array, newest first) ----
  fun ideasJson(c: Context): String = sp(c).getString("ideas", "[]") ?: "[]"

  private fun readIdeas(c: Context): JSONArray =
    try { JSONArray(ideasJson(c)) } catch (e: Exception) { JSONArray() }

  @Synchronized
  fun addIdea(c: Context, text: String) {
    val old = readIdeas(c)
    val now = System.currentTimeMillis()
    val out = JSONArray()
    out.put(
      JSONObject()
        .put("id", now.toString() + "-" + (Math.random() * 100000).toInt())
        .put("text", text)
        .put("ts", now)
    )
    for (i in 0 until old.length()) out.put(old.getJSONObject(i))
    sp(c).edit().putString("ideas", out.toString()).commit()
  }

  @Synchronized
  fun deleteIdea(c: Context, id: String) {
    val old = readIdeas(c)
    val out = JSONArray()
    for (i in 0 until old.length()) {
      val o = old.getJSONObject(i)
      if (o.optString("id") != id) out.put(o)
    }
    sp(c).edit().putString("ideas", out.toString()).commit()
  }

  /** Replaces the whole list (used after Open / edit). Ignored if the text is not a JSON array. */
  @Synchronized
  fun setIdeasJson(c: Context, json: String) {
    val arr = try { JSONArray(json) } catch (e: Exception) { return }
    sp(c).edit().putString("ideas", arr.toString()).commit()
  }

  @Synchronized
  fun clearIdeas(c: Context) {
    sp(c).edit().putString("ideas", "[]").commit()
  }

  // ---- circle on/off and position ----
  fun enabled(c: Context): Boolean = sp(c).getBoolean("enabled", false)
  fun setEnabled(c: Context, on: Boolean) {
    sp(c).edit().putBoolean("enabled", on).apply()
  }

  fun posX(c: Context, def: Int): Int = sp(c).getInt("x", def)
  fun posY(c: Context, def: Int): Int = sp(c).getInt("y", def)
  fun savePos(c: Context, x: Int, y: Int) {
    sp(c).edit().putInt("x", x).putInt("y", y).apply()
  }
}
