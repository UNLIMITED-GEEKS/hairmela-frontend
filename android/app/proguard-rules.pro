# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ── Capacitor / plugins ────────────────────────────────────────────────────
# Capacitor resolves plugin classes REFLECTIVELY by the name recorded in
# capacitor.plugins.json, and calls @PluginMethod methods by name from JS. R8
# sees no static reference to any of it and would strip or rename the lot —
# producing a build that runs but where every native call silently fails.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public <methods>;
}

# Installed plugins, same reflective lookup.
-keep class com.capacitorjs.plugins.** { *; }
-keep class io.capawesome.capacitorjs.plugins.** { *; }

# Cordova compatibility layer Capacitor bridges to.
-keep class org.apache.cordova.** { *; }

# ── Firebase / FCM ─────────────────────────────────────────────────────────
# Message classes are deserialised reflectively from the wire format.
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# ── ML Kit barcode scanning ────────────────────────────────────────────────
# Google Play Services loads the scanner module dynamically at runtime.
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.mlkit.**

# Keep JavascriptInterface methods — the WebView bridge calls these by name.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
