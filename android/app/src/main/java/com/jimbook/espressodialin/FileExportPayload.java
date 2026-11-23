package com.jimbook.espressodialin;

import java.io.BufferedInputStream;
import java.io.DataInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.zip.CRC32;

final class FileExportPayload {
    static final int CHUNK_SIZE = 256 * 1024;
    static final int LIMIT = 64 * 1024 * 1024;
    static final int REPLAY_LIMIT = 256 * 1024 * 1024;
    private static final Pattern BASE64 = Pattern.compile("[A-Za-z0-9+/]+={0,2}");
    final File file;
    final int expected;
    private int received;

    FileExportPayload(File file, int expected) throws IOException {
        this(file, expected, false);
    }

    FileExportPayload(File file, int expected, boolean replay) throws IOException {
        if (expected <= 0 || expected > (replay ? REPLAY_LIMIT : LIMIT) || file.length() != 0) {
            throw new IOException("Invalid export size");
        }
        this.file = file;
        this.expected = expected;
    }

    void append(int offset, String encoded, Function<String, byte[]> decode) throws IOException {
        int count = Math.min(CHUNK_SIZE, expected - received);
        int padding = (3 - count % 3) % 3;
        if (offset != received || count <= 0 || encoded == null || encoded.length() != ((count + 2) / 3) * 4
            || !BASE64.matcher(encoded).matches() || encoded.indexOf('=') != (padding == 0 ? -1 : encoded.length() - padding)) {
            throw new IOException("Missing or invalid export chunk");
        }
        byte[] bytes = decode.apply(encoded);
        if (bytes.length != count) throw new IOException("Incomplete export chunk");
        try (OutputStream output = new FileOutputStream(file, true)) {
            output.write(bytes);
        }
        received += count;
    }

    void verify(String mimeType) throws IOException {
        if (received != expected || file.length() != expected) throw new IOException("Incomplete export");
        if ("video/mp4".equals(mimeType) || "video/webm".equals(mimeType)) {
            verifyVideoHeader(mimeType);
            return;
        }
        if (!"image/png".equals(mimeType)) return;
        try (DataInputStream png = new DataInputStream(new BufferedInputStream(new FileInputStream(file)))) {
            if (expected < 57 || png.readLong() != 0x89504e470d0a1a0aL) throw new IOException("Invalid PNG signature");
            byte[] buffer = new byte[32 * 1024];
            CRC32 crc = new CRC32();
            boolean hasImageData = false;
            int remaining = expected - 8;
            while (remaining >= 12) {
                int length = png.readInt();
                int type = png.readInt();
                if (length < 0 || length > remaining - 12) break;
                boolean first = remaining == expected - 8;
                if (first != (type == 0x49484452) || (first && length != 13)) break;
                crc.reset();
                for (int shift = 24; shift >= 0; shift -= 8) crc.update(type >>> shift);
                for (int offset = 0; offset < length;) {
                    int count = Math.min(buffer.length, length - offset);
                    png.readFully(buffer, 0, count);
                    if (first && (intAt(buffer, 0) <= 0 || intAt(buffer, 4) <= 0)) throw new IOException("Invalid PNG dimensions");
                    crc.update(buffer, 0, count);
                    offset += count;
                }
                if ((int) crc.getValue() != png.readInt()) throw new IOException("Invalid PNG checksum");
                remaining -= length + 12;
                hasImageData |= type == 0x49444154 && length > 0;
                if (type == 0x49454e44) {
                    if (hasImageData && length == 0 && remaining == 0) return;
                    break;
                }
            }
            throw new IOException("Incomplete PNG");
        }
    }

    private void verifyVideoHeader(String mimeType) throws IOException {
        try (DataInputStream input = new DataInputStream(new FileInputStream(file))) {
            int header = input.readInt();
            if ("video/webm".equals(mimeType)) {
                if (header != 0x1a45dfa3 || expected <= 4) throw new IOException("Invalid WebM header");
            } else if (header < 16 || header > expected || input.readInt() != 0x66747970) {
                throw new IOException("Invalid MP4 header");
            }
        }
    }

    private static int intAt(byte[] header, int offset) {
        return ((header[offset] & 0xff) << 24) | ((header[offset + 1] & 0xff) << 16)
            | ((header[offset + 2] & 0xff) << 8) | (header[offset + 3] & 0xff);
    }

    void copyTo(OutputStream output) throws IOException {
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[32 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        }
    }

    void verifyCopy(InputStream destination) throws IOException {
        try (DataInputStream source = new DataInputStream(new BufferedInputStream(new FileInputStream(file)))) {
            DataInputStream written = new DataInputStream(destination);
            byte[] original = new byte[32 * 1024];
            byte[] actual = new byte[original.length];
            for (int offset = 0; offset < expected; offset += original.length) {
                int count = Math.min(original.length, expected - offset);
                source.readFully(original, 0, count);
                written.readFully(actual, 0, count);
                if (!Arrays.equals(original, actual)) throw new IOException("Saved export differs from original");
            }
            if (written.read() != -1) throw new IOException("Saved export contains extra bytes");
        }
    }

    void saveVerified(Destination destination) throws IOException {
        try {
            try (OutputStream output = destination.openOutput()) {
                if (output == null) throw new IOException("No output stream");
                copyTo(output);
            }
            try (InputStream input = destination.openInput()) {
                if (input == null) throw new IOException("No input stream");
                verifyCopy(input);
            }
        } catch (IOException | RuntimeException error) {
            destination.discard();
            throw error;
        }
    }

    interface Destination {
        OutputStream openOutput() throws IOException;
        InputStream openInput() throws IOException;
        void discard();
    }
}
