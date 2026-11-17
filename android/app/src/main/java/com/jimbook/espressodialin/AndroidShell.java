package com.jimbook.espressodialin;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Base64;
import android.view.WindowManager;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

@CapacitorPlugin(name = "AndroidShell")
public class AndroidShell extends Plugin {
    @PluginMethod
    public void hasBluetoothPermissions(PluginCall call) {
        boolean granted = Build.VERSION.SDK_INT >= 31
            ? isPermissionGranted(Manifest.permission.BLUETOOTH_SCAN) && isPermissionGranted(Manifest.permission.BLUETOOTH_CONNECT)
            : isPermissionGranted(Manifest.permission.ACCESS_FINE_LOCATION)
                && isPermissionGranted(Manifest.permission.ACCESS_COARSE_LOCATION);
        call.resolve(new JSObject().put("granted", granted));
    }

    private boolean isPermissionGranted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void keepAwake(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (Boolean.TRUE.equals(call.getBoolean("enabled"))) {
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } else {
                getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void exportFile(PluginCall call) {
        String filename = call.getString("filename", "");
        String mimeType = call.getString("mimeType", "");
        if (!filename.matches("[A-Za-z0-9][A-Za-z0-9_. -]{0,127}")
            || !("image/png".equals(mimeType) || "application/json".equals(mimeType))) {
            call.reject("Unsupported export.");
            return;
        }
        if (Boolean.TRUE.equals(call.getBoolean("share")) && "image/png".equals(mimeType)) {
            sharePng(call, filename);
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mimeType)
            .putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "writeExport");
    }

    @ActivityCallback
    private void writeExport(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent intent = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || intent == null || intent.getData() == null) {
            call.resolve();
            return;
        }
        try (OutputStream output = getContext().getContentResolver().openOutputStream(intent.getData(), "wt")) {
            if (output == null) throw new IOException("No output stream");
            writeData(call, output);
            call.resolve();
        } catch (IOException | IllegalArgumentException | SecurityException error) {
            call.reject("Unable to save the export.", error);
        }
    }

    private void sharePng(PluginCall call, String filename) {
        try {
            File directory = new File(getContext().getCacheDir(), "shot-share");
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("No cache directory");
            File image = File.createTempFile("shot-", ".png", directory);
            try (OutputStream output = new FileOutputStream(image)) {
                writeData(call, output);
            }
            Intent send = new Intent(Intent.ACTION_SEND).setType("image/png")
                .putExtra(Intent.EXTRA_STREAM, FileProvider.getUriForFile(
                    getContext(), getContext().getPackageName() + ".fileprovider", image, filename))
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(send, "Espresso shot"));
            call.resolve();
        } catch (IOException | RuntimeException error) {
            call.reject("Unable to share the shot card.", error);
        }
    }

    private void writeData(PluginCall call, OutputStream output) throws IOException {
        String encoded = call.getString("data", "");
        if (encoded.length() > 89_478_488) throw new IOException("Export exceeds 64 MiB");
        output.write(Base64.decode(encoded, Base64.DEFAULT));
    }
}
