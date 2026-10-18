package com.bofelo.driver;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
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
        
        // 🟢 FORCE ALLOW LOADING (Fixes the stuck loading screen)
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        
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
            // 🟢 FIX: Ignore SSL errors on redirects (common in Capacitor)
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.proceed(); 
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                
                // 1. Inject the fake Notification object
                String injection = 
                    "if (typeof Notification === 'undefined') {" +
                    "  window.Notification = function(title, options) {};" +
                    "  window.Notification.permission = 'granted';" +
                    "  window.Notification.requestPermission = function() { return Promise.resolve('granted'); };" +
                    "}";
                view.evaluateJavascript(injection, null);

                // 2. Fetch the Native FCM Token
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
