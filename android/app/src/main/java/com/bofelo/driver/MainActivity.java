package com.bofelo.driver;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebChromeClient;
import android.webkit.GeolocationPermissions;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
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

            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                    callback.invoke(origin, true, false);
                }
            });
        }
    }
}
