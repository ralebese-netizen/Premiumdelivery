package com.bofelo.driver;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.PermissionRequest;
import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        WebView webView = this.bridge.getWebView();
        WebSettings settings = webView.getSettings();
        
        settings.setDomStorageEnabled(true);
        settings.setJavaScriptEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setGeolocationEnabled(true);
        
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                
                // 1. Inject the fake Notification object so your web code doesn't crash
                String injection = 
                    "if (typeof Notification === 'undefined') {" +
                    "  window.Notification = function(title, options) {};" +
                    "  window.Notification.permission = 'granted';" +
                    "  window.Notification.requestPermission = function() { return Promise.resolve('granted'); };" +
                    "}";
                view.evaluateJavascript(injection, null);

                // 2. Fetch the Native FCM Token and send it to the website after a 2-second delay
                FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                    if (task.isSuccessful() && task.getResult() != null) {
                        String token = task.getResult();
                        view.postDelayed(() -> {
                            view.evaluateJavascript("if(window.receiveNativeFcmToken) window.receiveNativeFcmToken('" + token + "');", null);
                        }, 2000); 
                    }
                });
            }
        });
    }
}
