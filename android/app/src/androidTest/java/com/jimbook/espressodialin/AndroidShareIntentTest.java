package com.jimbook.espressodialin;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import androidx.core.content.IntentCompat;
import androidx.core.content.FileProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.DataInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.junit.Test;
import org.junit.runner.RunWith;

import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class AndroidShareIntentTest {
    @Test public void feedbackIntentReferencesReadableStagedJsonWithATemporaryReadGrant() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File folder = new File(context.getCacheDir(), "shot-share");
        assertTrue(folder.isDirectory() || folder.mkdirs());
        File file = File.createTempFile("share-test-", ".json", folder);
        try {
            byte[] bytes = "{\"shotId\":\"test\",\"testerFeedback\":\"Test only\"}".getBytes(StandardCharsets.UTF_8);
            try (FileOutputStream output = new FileOutputStream(file)) { output.write(bytes); }
            String name = "replay-test-pressure.json";
            Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file, name);
            Intent intent = AndroidShell.fileShareIntent(uri, name, "application/json", true, "Shot report");
            assertEquals(Intent.ACTION_SEND, intent.getAction());
            assertEquals("application/json", intent.getType());
            assertEquals(uri, IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class));
            assertEquals(uri, intent.getClipData().getItemAt(0).getUri());
            assertEquals(name, intent.getClipData().getDescription().getLabel().toString());
            assertTrue((intent.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0);
            assertEquals(0, intent.getFlags() & Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            assertArrayEquals(new String[] { "TullLabs@outlook.com" }, intent.getStringArrayExtra(Intent.EXTRA_EMAIL));
            assertEquals("Shot report", intent.getStringExtra(Intent.EXTRA_SUBJECT));
            try (InputStream input = context.getContentResolver().openInputStream(uri)) {
                assertNotNull(input);
                byte[] contents = new byte[bytes.length];
                new DataInputStream(input).readFully(contents);
                assertArrayEquals(bytes, contents);
            }
        } finally {
            file.delete();
        }
    }
}
