package dev.opensarthi.android

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

class SarthiAccessibilityService : AccessibilityService() {
    companion object {
        private var instance: SarthiAccessibilityService? = null
        
        @JvmStatic
        fun getInstance(): SarthiAccessibilityService? = instance
        
        @JvmStatic
        fun isServiceRunning(): Boolean {
            return instance != null
        }
        
        @JvmStatic
        fun click(x: Int, y: Int): Boolean {
            val service = instance ?: return false
            val path = Path()
            path.moveTo(x.toFloat(), y.toFloat())
            val gesture = GestureDescription.Builder()
                .addStroke(GestureDescription.StrokeDescription(path, 0, 100))
                .build()
            return service.dispatchGesture(gesture, null, null)
        }
        
        @JvmStatic
        fun scroll(startX: Int, startY: Int, endX: Int, endY: Int): Boolean {
            val service = instance ?: return false
            val path = Path()
            path.moveTo(startX.toFloat(), startY.toFloat())
            path.lineTo(endX.toFloat(), endY.toFloat())
            val gesture = GestureDescription.Builder()
                .addStroke(GestureDescription.StrokeDescription(path, 0, 400))
                .build()
            return service.dispatchGesture(gesture, null, null)
        }

        @JvmStatic
        fun typeText(text: String): Boolean {
            val service = instance ?: return false
            val root = service.rootInActiveWindow ?: return false
            val focused = findFocusedNode(root) ?: findFirstEditableNode(root) ?: return false
            val arguments = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
            }
            return focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
        }

        @JvmStatic
        fun pressKey(key: String): Boolean {
            val service = instance ?: return false
            when (key.lowercase()) {
                "back" -> return service.performGlobalAction(GLOBAL_ACTION_BACK)
                "home" -> return service.performGlobalAction(GLOBAL_ACTION_HOME)
                "recents" -> return service.performGlobalAction(GLOBAL_ACTION_RECENTS)
                "enter", "return" -> {
                    val root = service.rootInActiveWindow ?: return false
                    val focused = findFocusedNode(root) ?: findFirstEditableNode(root)
                    if (focused != null) {
                        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                            val success = focused.performAction(0x00020000)
                            if (success) return true
                        }
                    }
                    return clickSearchOrGoButton(root)
                }
            }
            return false
        }

        private fun findFocusedNode(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
            if (node.isFocused) return node
            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                val found = findFocusedNode(child)
                if (found != null) return found
            }
            return null
        }

        private fun findFirstEditableNode(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
            if (node.isEditable || node.className?.toString()?.contains("EditText", ignoreCase = true) == true) {
                return node
            }
            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                val found = findFirstEditableNode(child)
                if (found != null) return found
            }
            return null
        }

        private fun clickSearchOrGoButton(node: AccessibilityNodeInfo): Boolean {
            val text = node.text?.toString()?.lowercase() ?: ""
            val desc = node.contentDescription?.toString()?.lowercase() ?: ""
            
            if (node.isClickable && (
                text.contains("search") || text.contains("go") || text.contains("submit") || text.contains("done") || text.contains("enter") ||
                desc.contains("search") || desc.contains("go") || desc.contains("submit") || desc.contains("done") || desc.contains("enter")
            )) {
                return node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            }
            
            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                if (clickSearchOrGoButton(child)) return true
            }
            return false
        }

        @JvmStatic
        fun getScreenStructure(): String {
            val service = instance ?: return "{\"error\": \"Accessibility service not enabled\"}"
            val root = service.rootInActiveWindow ?: return "{\"error\": \"No active window found\"}"
            val rootObj = JSONObject()
            try {
                dumpNode(root, rootObj)
            } catch (e: Exception) {
                return "{\"error\": \"Failed to dump: ${e.message}\"}"
            }
            return rootObj.toString()
        }

        private fun dumpNode(node: AccessibilityNodeInfo, parentObj: JSONObject) {
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            
            parentObj.put("class", node.className?.toString() ?: "")
            parentObj.put("text", node.text?.toString() ?: "")
            parentObj.put("desc", node.contentDescription?.toString() ?: "")
            parentObj.put("clickable", node.isClickable)
            parentObj.put("bounds", "[${bounds.left},${bounds.top}][${bounds.right},${bounds.bottom}]")
            
            val childrenArray = JSONArray()
            for (i in 0 until node.childCount) {
                val child = node.getChild(i)
                if (child != null) {
                    val childObj = JSONObject()
                    dumpNode(child, childObj)
                    childrenArray.put(childObj)
                }
            }
            if (childrenArray.length() > 0) {
                parentObj.put("children", childrenArray)
            }
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Not used
    }

    override fun onInterrupt() {
        // Not used
    }

    override fun onDestroy() {
        super.onDestroy()
        if (instance == this) {
            instance = null
        }
    }
}
