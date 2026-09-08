package dev.opensarthi.android

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * RuntimeServicePlugin — exposes RuntimeService notification controls to JS.
 *
 * Usage from JS:
 *   import { Cap } from "@capacitor/core";
 *   Cap.RuntimeService.updateTaskState({ active: true, paused: false });
 */
@CapacitorPlugin(name = "RuntimeService")
class RuntimeServicePlugin : Plugin() {

    @PluginMethod
    fun updateTaskState(call: PluginCall) {
        val active = call.getBoolean("active") ?: false
        val paused = call.getBoolean("paused") ?: false
        RuntimeService.updateTaskState(active, paused)
        call.resolve(JSObject().put("ok", true))
    }
}
