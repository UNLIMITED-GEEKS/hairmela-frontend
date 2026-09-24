package com.hairmela.app;

import android.os.Bundle;
import android.os.Build;
import android.view.View;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Set once the WebView has painted its first frame. Until then the system
     * splash stays up.
     */
    private boolean webViewReady = false;

    /** Hard ceiling on the splash, for when first paint never arrives. */
    private static final long MAX_SPLASH_MS = 5000;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // BEFORE super.onCreate: installSplashScreen() has to swap the launch
        // theme for the post-splash theme while the activity is still starting.
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);

        // Hold the system splash until the WebView actually has something to
        // show. Without this it dismisses on its own schedule and hands off to
        // a WebView that has not painted yet — a white or black flash between
        // the splash and the app.
        //
        // This app draws NO web splash on Android (see index.html): the system
        // splash is the whole launch screen, so it has to cover the entire gap
        // rather than half of it.
        splashScreen.setKeepOnScreenCondition(() -> !webViewReady);

        // Ceiling. If the WebView never reports a first paint — a page that
        // fails to load, a crash inside the bridge — the condition above would
        // hold the splash on screen forever with no way out. Release it after
        // MAX_SPLASH_MS regardless, so a broken launch shows the broken app
        // rather than a frozen logo.
        new android.os.Handler(android.os.Looper.getMainLooper())
            .postDelayed(() -> webViewReady = true, MAX_SPLASH_MS);

        super.onCreate(savedInstanceState);

        // Make the Capacitor WebView participate explicitly in Android's
        // Autofill Framework so password managers can detect the username and
        // password fields declared by the web form.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getBridge().getWebView().setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_YES);
        }

        // First paint of the WebView's content. postVisualStateCallback fires
        // once the given state has been rendered to the screen — not merely
        // laid out — which is the signal we want. The request id is arbitrary.
        //
        // Guarded by a post() so the bridge and its WebView exist: super's
        // onCreate builds them, but the callback below is registered against
        // an object that is only valid afterwards.
        getBridge()
            .getWebView()
            .post(
                () ->
                    getBridge()
                        .getWebView()
                        .postVisualStateCallback(
                            0,
                            new android.webkit.WebView.VisualStateCallback() {
                                @Override
                                public void onComplete(long requestId) {
                                    webViewReady = true;
                                }
                            }
                        )
            );
    }
}
