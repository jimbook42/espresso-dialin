package com.jimbook.espressodialin;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.pm.PackageManager;
import android.os.Build;
import android.net.Uri;
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
import java.io.InputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "AndroidShell")
public class AndroidShell extends Plugin {
    private static final int BACKUP_CHUNK_LIMIT = 256 * 1024;
    private static final long BACKUP_LIMIT = 512L * 1024 * 1024;
    private OutputStream backupStream;
    private Uri backupUri;
    private long backupBytes;
    private boolean openingBackup;
    private FileExportPayload fileExport;
    private String fileId;
    private String fileName;
    private String fileMime;
    private boolean openingFile;

    @PluginMethod
    public synchronized void beginBackupExport(PluginCall call) {
        String filename = call.getString("filename", "");
        if (!filename.matches("[A-Za-z0-9-]{1,80}\\.dialinbackup") || openingBackup || backupStream != null
            || fileExport != null || openingFile) {
            call.reject("Invalid backup filename or an export is already open.");
            return;
        }
        openingBackup = true;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/octet-stream")
            .putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "openBackupExport");
    }

    @ActivityCallback
    private synchronized void openBackupExport(PluginCall call, ActivityResult result) {
        openingBackup = false;
        if (call == null) return;
        Intent intent = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || intent == null || intent.getData() == null) {
            call.resolve(new JSObject().put("opened", false));
            return;
        }
        backupUri = intent.getData();
        try {
            backupStream = getContext().getContentResolver().openOutputStream(backupUri, "wt");
            if (backupStream == null) throw new IOException("No output stream");
            backupBytes = 0;
            call.resolve(new JSObject().put("opened", true));
        } catch (IOException | RuntimeException error) {
            discardFailedBackup();
            call.reject("Unable to open the backup destination.", error);
        }
    }

    @PluginMethod
    public synchronized void appendBackupExport(PluginCall call) {
        if (backupStream == null) {
            call.reject("No backup destination is open.");
            return;
        }
        try {
            String encoded = call.getString("data", "");
            if (encoded.length() > ((BACKUP_CHUNK_LIMIT + 2) / 3) * 4) throw new IOException("Chunk too large");
            byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
            if (bytes.length > BACKUP_CHUNK_LIMIT || backupBytes + bytes.length > BACKUP_LIMIT) {
                throw new IOException("Backup size limit exceeded");
            }
            backupStream.write(bytes);
            backupBytes += bytes.length;
            call.resolve();
        } catch (IOException | RuntimeException error) {
            discardFailedBackup();
            call.reject("Could not write the backup. Check available storage and retry.", error);
        }
    }

    @PluginMethod
    public synchronized void finishBackupExport(PluginCall call) {
        if (backupStream == null) {
            call.reject("No backup destination is open.");
            return;
        }
        try {
            backupStream.close();
            backupStream = null;
            backupUri = null;
            call.resolve();
        } catch (IOException error) {
            discardFailedBackup();
            call.reject("Could not finish writing the backup.", error);
        }
    }

    @PluginMethod
    public synchronized void cancelBackupExport(PluginCall call) {
        discardFailedBackup();
        call.resolve();
    }

    @Override
    protected synchronized void handleOnDestroy() {
        discardFailedBackup();
        discardFileExport();
        super.handleOnDestroy();
    }

    private void discardFailedBackup() {
        if (backupStream != null) {
            try { backupStream.close(); } catch (IOException ignored) {}
        }
        if (backupUri != null) {
            try {
                // Only the document just created through ACTION_CREATE_DOCUMENT.
                android.provider.DocumentsContract.deleteDocument(getContext().getContentResolver(), backupUri);
            } catch (IOException | RuntimeException ignored) {}
        }
        backupStream = null;
        backupUri = null;
    }

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
    public void getDiagnosticDevice(PluginCall call) {
        call.resolve(new JSObject()
            .put("androidVersion", Build.VERSION.RELEASE)
            .put("model", Build.MODEL));
    }

    @PluginMethod
    public synchronized void beginFileExport(PluginCall call) {
        String id = call.getString("id", "");
        String filename = call.getString("filename", "");
        String mimeType = call.getString("mimeType", "");
        int expected = call.getInt("byteCount", 0);
        if (fileExport != null || openingFile || openingBackup || backupStream != null) {
            call.reject("An export is already open.");
            return;
        }
        if (!id.matches("[a-f0-9-]{36}") || expected <= 0 || expected > FileExportPayload.LIMIT
            || !filename.matches("[A-Za-z0-9][A-Za-z0-9_. -]{0,127}")
            || !("image/png".equals(mimeType) || "application/json".equals(mimeType) || "text/csv".equals(mimeType))) {
            call.reject("Unsupported export.");
            return;
        }
        File staged = null;
        try {
            File directory = new File(getContext().getCacheDir(), "shot-share");
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("No cache directory");
            long expiry = System.currentTimeMillis() - 24L * 60 * 60 * 1000;
            File[] stale = directory.listFiles(file -> file.isFile() && file.getName().startsWith("shared-")
                && file.lastModified() < expiry);
            if (stale != null) for (File file : stale) file.delete();
            String suffix = "image/png".equals(mimeType) ? ".png" : "text/csv".equals(mimeType) ? ".csv" : ".json";
            staged = File.createTempFile("shared-", suffix, directory);
            fileExport = new FileExportPayload(staged, expected);
            fileId = id;
            fileName = filename;
            fileMime = mimeType;
            call.resolve();
        } catch (IOException | RuntimeException error) {
            if (staged != null) staged.delete();
            call.reject("Unable to prepare the export.", error);
        }
    }

    @PluginMethod
    public synchronized void appendFileExport(PluginCall call) {
        if (!hasFileExport(call)) return;
        try {
            fileExport.append(call.getInt("offset", -1), call.getString("data"), data -> Base64.decode(data, Base64.DEFAULT));
            call.resolve();
        } catch (IOException | RuntimeException error) {
            discardFileExport();
            call.reject("The export data is incomplete or invalid.", error);
        }
    }

    @PluginMethod
    public synchronized void cancelFileExport(PluginCall call) {
        if (!openingFile && call.getString("id", "").equals(fileId)) discardFileExport();
        call.resolve();
    }

    private boolean hasFileExport(PluginCall call) {
        if (!openingFile && fileExport != null && call.getString("id", "").equals(fileId)) return true;
        call.reject("The export is no longer open. Try again.");
        return false;
    }

    private void discardFileExport() {
        if (fileExport != null) fileExport.file.delete();
        fileExport = null;
    }

    @PluginMethod
    public synchronized void exportFile(PluginCall call) {
        if (!hasFileExport(call)) return;
        try {
            fileExport.verify(fileMime);
            if (Boolean.TRUE.equals(call.getBoolean("share"))) {
                shareFile(call, fileExport.file, fileName, fileMime);
                int byteCount = fileExport.expected;
                fileExport = null; // Keep the verified file available to the recipient.
                call.resolve(new JSObject().put("bytesWritten", byteCount));
                return;
            }
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType(fileMime)
                .putExtra(Intent.EXTRA_TITLE, fileName);
            // Capacitor can serialize the picker call into Activity state. It carries only the ID.
            openingFile = true;
            startActivityForResult(call, intent, "writeExport");
        } catch (IOException | RuntimeException error) {
            openingFile = false;
            discardFileExport();
            call.reject("Unable to verify or open the export.", error);
        }
    }

    @ActivityCallback
    private synchronized void writeExport(PluginCall call, ActivityResult result) {
        Intent intent = result.getData();
        Uri uri = result.getResultCode() == Activity.RESULT_OK && intent != null ? intent.getData() : null;
        if (uri == null) {
            openingFile = false;
            discardFileExport();
            if (call != null) call.resolve(new JSObject().put("cancelled", true));
            return;
        }
        FileExportPayload payload = fileExport;
        fileExport = null;
        getBridge().execute(() -> finishFileExport(call, uri, payload));
    }

    private void finishFileExport(PluginCall call, Uri uri, FileExportPayload payload) {
        ContentResolver resolver = getContext().getContentResolver();
        try {
            if (payload == null || call == null) {
                deleteCreatedDocument(resolver, uri);
                throw new IOException("The file picker interrupted the export");
            }
            payload.saveVerified(new FileExportPayload.Destination() {
                public OutputStream openOutput() throws IOException { return resolver.openOutputStream(uri, "wt"); }
                public InputStream openInput() throws IOException { return resolver.openInputStream(uri); }
                public void discard() { deleteCreatedDocument(resolver, uri); }
            });
            call.resolve(new JSObject().put("bytesWritten", payload.expected));
        } catch (IOException | RuntimeException error) {
            if (call != null) call.reject("Unable to save and verify the export. Try again with a local folder.", error);
        } finally {
            if (payload != null) payload.file.delete();
            synchronized (this) { openingFile = false; }
        }
    }

    private void deleteCreatedDocument(ContentResolver resolver, Uri uri) {
        try { android.provider.DocumentsContract.deleteDocument(resolver, uri); }
        catch (IOException | RuntimeException ignored) { /* Some providers do not support deletion. */ }
    }

    private void shareFile(PluginCall call, File attachment, String filename, String mimeType) {
        Uri uri = FileProvider.getUriForFile(
            getContext(), getContext().getPackageName() + ".fileprovider", attachment, filename);
        Intent send = new Intent(Intent.ACTION_SEND).setType(mimeType)
            .putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        send.setClipData(ClipData.newRawUri(filename, uri));
        if (Boolean.TRUE.equals(call.getBoolean("feedback")) && "application/json".equals(mimeType)) {
            send.putExtra(Intent.EXTRA_EMAIL, new String[]{"TullLabs@outlook.com"});
            send.putExtra(Intent.EXTRA_SUBJECT, "Espresso Dial-In beta feedback");
        }
        getActivity().startActivity(Intent.createChooser(send, "Share Espresso Dial-In file"));
    }
}
