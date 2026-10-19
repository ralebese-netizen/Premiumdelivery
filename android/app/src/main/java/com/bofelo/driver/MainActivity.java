package com.bofelo.driver;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
                android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            );
        }

        WebView webView = this.bridge.getWebView();
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            settings.setDomStorageEnabled(true);
            settings.setJavaScriptEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setGeolocationEnabled(true);
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
            settings.setBlockNetworkLoads(false);
        }

        if (webView != null) {
            webView.postDelayed(() -> {
                try {
                    FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                        if (task.isSuccessful() && task.getResult() != null) {
                            String token = task.getResult();
                            webView.evaluateJavascript("if(window.receiveNativeFcmToken) window.receiveNativeFcmToken('" + token + "');", null);
                        }
                    });
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }, 3500);
        }
    }
}
