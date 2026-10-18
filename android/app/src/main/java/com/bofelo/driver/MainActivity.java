package com.bofelo.driver;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        WebView webView = this.bridge.getWebView();
        WebSettings settings = webView.getSettings();
        
        // Enable standard web features
        settings.setDomStorageEnabled(true);
        settings.setJavaScriptEnabled(true);
        settings.setDatabaseEnabled(true);
        
        // 🟢 Force the WebView to allow and handle GPS requests natively
        settings.setGeolocationEnabled(true);
        
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                // Automatically grant GPS permission so your web tracking code works instantly
                callback.invoke(origin, true, false);
            }
        });
    }
}
