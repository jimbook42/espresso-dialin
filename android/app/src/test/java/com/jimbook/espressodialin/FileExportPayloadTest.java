package com.jimbook.espressodialin;

import static org.junit.Assert.*;
import java.io.*;
import java.util.Base64;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class FileExportPayloadTest {
    private static final String PNG =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWO4PCkaAAP8AcFWn39rAAAAAElFTkSuQmCC";
    @Rule public TemporaryFolder temp = new TemporaryFolder();

    private FileExportPayload png() throws IOException {
        return new FileExportPayload(temp.newFile(), Base64.getDecoder().decode(PNG).length);
    }

    @Test public void rejectsMissingTruncatedAndWrongOffsetBeforePicker() throws IOException {
        FileExportPayload payload = png();
        assertThrows(IOException.class, () -> payload.append(0, null, Base64.getDecoder()::decode));
        assertThrows(IOException.class, () -> payload.append(0, PNG.substring(0, PNG.length() - 4), Base64.getDecoder()::decode));
        assertThrows(IOException.class, () -> payload.append(1, PNG, Base64.getDecoder()::decode));
        assertThrows(IOException.class, () -> payload.verify("image/png"));
        assertEquals(0L, payload.file.length());
    }

    @Test public void verifiedPngSupportsSaveAndShareWithOriginalBytes() throws IOException {
        FileExportPayload payload = png();
        payload.append(0, PNG, Base64.getDecoder()::decode);
        payload.verify("image/png");
        assertEquals(payload.expected, payload.file.length());
        MemoryDestination destination = new MemoryDestination();
        payload.saveVerified(destination);
        assertArrayEquals(Base64.getDecoder().decode(PNG), destination.bytes.toByteArray());
        assertFalse(destination.discarded);
    }

    @Test public void rejectsWrongSignatureAndTruncatedPngAtTheDeclaredSize() throws IOException {
        byte[] bytes = Base64.getDecoder().decode(PNG);
        for (int index : new int[] {0, bytes.length - 20, bytes.length - 1}) {
            FileExportPayload payload = png();
            bytes[index] ^= 1;
            payload.append(0, Base64.getEncoder().encodeToString(bytes), Base64.getDecoder()::decode);
            assertThrows(IOException.class, () -> payload.verify("image/png"));
            bytes[index] ^= 1;
        }
    }

    @Test public void discardsNewDestinationIfWriteFailsOrReadbackIsShort() throws IOException {
        FileExportPayload payload = png();
        payload.append(0, PNG, Base64.getDecoder()::decode);
        MemoryDestination failedWrite = new MemoryDestination() {
            @Override public OutputStream openOutput() throws IOException { throw new IOException("out of space"); }
        };
        assertThrows(IOException.class, () -> payload.saveVerified(failedWrite));
        assertTrue(failedWrite.discarded);
        MemoryDestination truncated = new MemoryDestination() {
            @Override public InputStream openInput() { return new ByteArrayInputStream(new byte[0]); }
        };
        assertThrows(IOException.class, () -> payload.saveVerified(truncated));
        assertTrue(truncated.discarded);
    }

    private static class MemoryDestination implements FileExportPayload.Destination {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        boolean discarded;
        public OutputStream openOutput() throws IOException { return bytes; }
        public InputStream openInput() { return new ByteArrayInputStream(bytes.toByteArray()); }
        public void discard() { discarded = true; }
    }
}
