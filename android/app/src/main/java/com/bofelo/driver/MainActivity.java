package com.bofelo.driver;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Access the Capacitor WebView safely
        WebView webView = this.bridge.getWebView();
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            
            // Essential settings for web app functionality & local storage
            settings.setDomStorageEnabled(true);
            settings.setJavaScriptEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setGeolocationEnabled(true);
            
            // Standard secure file access (removed universal/dangerous flags)
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
            settings.setBlockNetworkLoads(false);
        }
        
        /* 
         * IMPORTANT ARCHITECTURAL NOTE:
         * 1. Do NOT override WebViewClient (e.g. webView.setWebViewClient(...)). 
         *    Doing so strips away Capacitor's internal routing engine and causes a blank screen.
         * 2. Push notifications and FCM tokens should be handled cleanly via the 
         *    official `@capacitor/push-notifications` plugin in your frontend JS/TS code 
         *    rather than injecting raw tokens via arbitrary timeouts.
         */
    }
}
