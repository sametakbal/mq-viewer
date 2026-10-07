package org.akbal.sidecar;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PayloadsTest {

    @Test
    void detectsKinds() {
        assertEquals("json", Payloads.kind(" {\"a\": [1, 2]}"));
        assertEquals("text", Payloads.kind("{not json"));
        assertEquals("xml", Payloads.kind("<?xml version=\"1.0\"?><a/>"));
        assertEquals("text", Payloads.kind("HEARTBEAT|OK"));
        assertEquals("binary", Payloads.kind(null));
    }

    @Test
    void binaryBytesAreNotText() {
        assertNull(Payloads.decodeText(new byte[]{0, 1, 2, 3, (byte) 0xFF, (byte) 0xFE}, 1208));
        assertEquals("héllo", Payloads.decodeText("héllo".getBytes(StandardCharsets.UTF_8), 1208));
    }

    @Test
    void framedMessagesStayText() {
        String framed = "\u0002MSG|A\u0001B\u0001C\r\n\u0003";
        assertEquals(framed, Payloads.decodeText(framed.getBytes(StandardCharsets.UTF_8), 1208));
        assertEquals("text", Payloads.kind(framed));
        assertEquals("binary", Payloads.kind("\u0000\u0001\u0002\u0003AB"));
    }

    @Test
    void decodesEbcdic() {
        byte[] ebcdic = "HELLO".getBytes(java.nio.charset.Charset.forName("IBM037"));
        assertEquals("HELLO", Payloads.decodeText(ebcdic, 37));
    }

    @Test
    void idBytesAcceptHexOrText() {
        String hex = "414D5120514D3120202020202020202094A1C26A0F290040";
        assertEquals(hex, Payloads.hex(Payloads.idBytes(hex)));
        byte[] text = Payloads.idBytes("ORDER-42");
        assertEquals(24, text.length);
        assertEquals("ORDER-42", new String(text, 0, 8, StandardCharsets.UTF_8));
        assertTrue(Payloads.isZero(Payloads.idBytes("")));
    }

    @Test
    void formatIsPaddedToEightChars() {
        assertEquals("MQSTR   ", Payloads.format("MQSTR"));
        assertEquals("        ", Payloads.format("NONE"));
        assertArrayEquals("MQHRF2  ".getBytes(), Payloads.format("MQHRF2").getBytes());
    }

    @Test
    void picksSpecificAlias() {
        assertEquals("MQMT_REQUEST", Errors.pickAlias("MQMT_SYSTEM_FIRST/MQMT_REQUEST"));
        assertEquals("MQAT_JAVA", Errors.pickAlias("MQAT_JAVA/MQAT_DEFAULT"));
        assertEquals("MQPL_UNIX", Errors.pickAlias("MQPL_AIX/MQPL_UNIX"));
        assertEquals("MQRC_NOT_AUTHORIZED", Errors.reasonName(2035));
    }

    @Test
    void formatsQmgrVersion() {
        assertEquals("9.4.0.5", MqOps.formatVersion("09040005"));
        assertEquals("10.0.0.5", MqOps.formatVersion("10000005"));
    }

    @Test
    void charsetsFallBackToUtf8() {
        assertEquals(StandardCharsets.UTF_8, Payloads.charset(1208));
        assertEquals("IBM1047", Payloads.charset(1047).name());
        assertEquals("UTF-8", Payloads.charset(-5).name());
        assertEquals("ISO-8859-9", Payloads.charsetLabel(920));
        assertEquals("UTF-8", Payloads.charsetLabel(-5));
        assertEquals(Payloads.charset(1051).name(), Payloads.charsetLabel(1051));
    }

    @Test
    void moreKinds() {
        assertEquals("json", Payloads.kind("[1, 2]"));
        assertEquals("text", Payloads.kind(""));
        assertEquals("text", Payloads.kind("<open only"));
        assertEquals("binary", Payloads.kind("\u007f\u007f\u007fAB"));
        assertFalse(Payloads.mostlyControl(""));
    }

    @Test
    void previewFlattensWhitespaceAndCuts() {
        assertNull(Payloads.preview(null, 5));
        assertEquals("a b c", Payloads.preview("a\n  b\tc", 10));
        assertEquals("abc", Payloads.preview("abcdef", 3));
    }

    @Test
    void byteHelpers() {
        assertEquals("", Payloads.hex(null));
        assertEquals("0AFF", Payloads.hex(new byte[]{10, (byte) 255}));
        assertTrue(Payloads.isZero(null));
        assertFalse(Payloads.isZero(new byte[]{0, 1}));
        assertArrayEquals(new byte[]{(byte) 0xAB, 1}, Payloads.parseHex("aB01"));
        assertTrue(Payloads.isZero(Payloads.idBytes(null)));
        byte[] longText = Payloads.idBytes("X".repeat(30));
        assertEquals(24, longText.length);
        assertEquals('X', longText[23]);
    }

    @Test
    void formatEdgeCases() {
        assertEquals("        ", Payloads.format(null));
        assertEquals("        ", Payloads.format(" "));
        assertEquals("ABCDEFGH", Payloads.format("ABCDEFGHIJ"));
    }

    @Test
    void configHelpers() {
        Config plain = new Config("c1", "mq1", 1414, "CH", "QM1", null, null, null);
        assertFalse(plain.tlsEnabled());
        assertEquals("mq1:1414", plain.endpoint());
        Config.Tls off = new Config.Tls(false, null, null, null, null, null, null, null);
        assertFalse(new Config("c1", "mq1", 1414, "CH", "QM1", null, null, off).tlsEnabled());
        Config.Tls on = new Config.Tls(true, null, null, null, null, null, null, null);
        assertTrue(new Config("c1", "mq1", 1414, "CH", "QM1", null, null, on).tlsEnabled());
    }
}
