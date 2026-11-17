package com.jimbook.espressodialin;

import android.webkit.PermissionRequest;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    @Override
    protected void load() {
        registerPlugin(AndroidShell.class);
        super.load();
        bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(bridge) {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                String[] resources = request.getResources();
                if (!"https://localhost/".equals(request.getOrigin().toString())
                    && !"https://localhost".equals(request.getOrigin().toString())) {
                    request.deny();
                    return;
                }
                if (resources.length == 1 && PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resources[0])) {
                    super.onPermissionRequest(request);
                } else {
                    request.deny();
                }
            }
        });
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge.getWebView().canGoBack()) {
                    bridge.getWebView().goBack();
                } else {
                    moveTaskToBack(true);
                }
            }
        });
    }
}
