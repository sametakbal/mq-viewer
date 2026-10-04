package org.akbal.sidecar;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Map;

/** Payload helpers: CCSID → charset, content-kind detection and MQ byte-field encoding. */
public final class Payloads {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HexFormat HEX = HexFormat.of().withUpperCase();

    private static final Map<Integer, String> CCSIDS = Map.ofEntries(
            Map.entry(1208, "UTF-8"), Map.entry(1200, "UTF-16BE"), Map.entry(1202, "UTF-16LE"),
            Map.entry(819, "ISO-8859-1"), Map.entry(912, "ISO-8859-2"), Map.entry(920, "ISO-8859-9"),
            Map.entry(923, "ISO-8859-15"), Map.entry(437, "IBM437"), Map.entry(850, "IBM850"),
            Map.entry(857, "IBM857"), Map.entry(1250, "windows-1250"), Map.entry(1252, "windows-1252"),
            Map.entry(1254, "windows-1254"), Map.entry(367, "US-ASCII"), Map.entry(37, "IBM037"),
            Map.entry(500, "IBM500"), Map.entry(1026, "IBM1026"), Map.entry(1140, "IBM01140"),
            Map.entry(1148, "IBM01148"), Map.entry(1047, "IBM1047"), Map.entry(5348, "windows-1252"));

    private Payloads() {
    }

    public static Charset charset(int ccsid) {
        String name = CCSIDS.get(ccsid);
        try {
            if (name == null) {
                name = com.ibm.mq.headers.CCSID.getCodepage(ccsid);
            }
            return Charset.forName(name);
        } catch (Exception e) {
            return StandardCharsets.UTF_8;
        }
    }

    public static String charsetLabel(int ccsid) {
        String name = CCSIDS.get(ccsid);
        if (name != null) {
            return name;
        }
        return charset(ccsid).name();
    }

    /**
     * Decodes bytes as text, or returns null when they are not valid in that charset. Control
     * characters are kept: framed messages (STX…ETX, SOH-separated fields) are still text and the
     * UI can show those characters on request.
     */
    public static String decodeText(byte[] data, int ccsid) {
        try {
            return charset(ccsid).newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(data)).toString();
        } catch (CharacterCodingException e) {
            return null;
        }
    }

    /** json | xml | text | binary — drives which payload view the UI opens first. */
    public static String kind(String text) {
        if (text == null || mostlyControl(text)) {
            return "binary";
        }
        String t = text.stripLeading();
        if ((t.startsWith("{") || t.startsWith("[")) && isJson(t)) {
            return "json";
        }
        if (t.startsWith("<") && t.stripTrailing().endsWith(">")) {
            return "xml";
        }
        return "text";
    }

    /**
     * Controls used to frame or separate text (SOH, STX, ETX, EOT, ENQ, ACK, NAK, ETB, SUB, ESC,
     * FS, GS, RS, US, TAB, LF, VT, FF, CR); they don't make a message binary.
     */
    private static final String FRAMING = "\u0001\u0002\u0003\u0004\u0005\u0006\u0015\u0017\u001a\u001b"
            + "\u001c\u001d\u001e\u001f\t\n\u000b\f\r";

    /** Single-byte charsets decode anything, so real binary shows up as NULs and other odd controls. */
    static boolean mostlyControl(String text) {
        if (text.isEmpty()) {
            return false;
        }
        int odd = 0;
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if ((ch < 32 && FRAMING.indexOf(ch) < 0) || ch == 127) {
                odd++;
            }
        }
        return odd * 100 > text.length() * 10;
    }

    private static boolean isJson(String s) {
        try {
            JSON.readTree(s);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public static String preview(String text, int max) {
        if (text == null) {
            return null;
        }
        String flat = text.replaceAll("\\s+", " ").trim();
        return flat.length() > max ? flat.substring(0, max) : flat;
    }

    public static String hex(byte[] b) {
        return b == null ? "" : HEX.formatHex(b);
    }

    public static boolean isZero(byte[] b) {
        if (b == null) {
            return true;
        }
        for (byte x : b) {
            if (x != 0) {
                return false;
            }
        }
        return true;
    }

    /**
     * Converts a user-entered MsgId/CorrelId into the 24-byte field: 48 hex digits are taken as-is,
     * anything else is treated as text and padded with nulls (truncated past 24 bytes).
     */
    public static byte[] idBytes(String value) {
        byte[] out = new byte[24];
        if (value == null || value.isBlank()) {
            return out;
        }
        String v = value.trim();
        if (v.matches("(?i)[0-9a-f]{48}")) {
            return HexFormat.of().parseHex(v.toLowerCase(Locale.ROOT));
        }
        byte[] raw = v.getBytes(StandardCharsets.UTF_8);
        System.arraycopy(raw, 0, out, 0, Math.min(raw.length, 24));
        return out;
    }

    public static byte[] parseHex(String hex) {
        return HexFormat.of().parseHex(hex.toLowerCase(Locale.ROOT));
    }

    /** Pads/truncates to the 8-char MQMD Format field; "NONE" or blank means MQFMT_NONE. */
    public static String format(String f) {
        if (f == null || f.isBlank() || f.equalsIgnoreCase("NONE")) {
            return "        ";
        }
        String s = f.length() > 8 ? f.substring(0, 8) : f;
        return String.format("%-8s", s);
    }
}
