package org.akbal.sidecar;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class MainTest {

    @Test
    void answersEachRequestAndShutsDownWhenInputCloses() throws Exception {
        MqOps ops = mock(MqOps.class);
        when(ops.dispatch(eq("ping"), any())).thenReturn(Map.of("pong", true));
        when(ops.dispatch(eq("boom"), any())).thenThrow(Errors.invalid("Unknown method: boom"));

        String input = String.join("\n",
                "",
                "not json",
                "{\"id\":1,\"method\":\"ping\",\"params\":{}}",
                "{\"id\":2,\"method\":\"boom\"}");
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        PrintStream out = new PrintStream(buf, true, StandardCharsets.UTF_8);

        Main.serve(new BufferedReader(new StringReader(input)), out, ops);

        List<JsonNode> lines = new ArrayList<>();
        for (String l : buf.toString(StandardCharsets.UTF_8).split("\\R")) {
            lines.add(Main.JSON.readTree(l));
        }
        assertEquals(3, lines.size());
        assertTrue(lines.get(0).path("ready").asBoolean());
        JsonNode ping = lines.stream().filter(n -> n.path("id").asInt() == 1).findFirst().orElseThrow();
        assertTrue(ping.path("result").path("pong").asBoolean());
        JsonNode boom = lines.stream().filter(n -> n.path("id").asInt() == 2).findFirst().orElseThrow();
        assertEquals("INVALID_REQUEST", boom.path("error").path("name").asText());
        verify(ops).shutdown();
    }

    @Test
    void respondTurnsUnserializableResultsIntoErrors() throws Exception {
        MqOps ops = mock(MqOps.class);
        when(ops.dispatch(any(), any())).thenReturn(new Object() {
            @SuppressWarnings("unused")
            public String getValue() {
                throw new IllegalStateException("cannot read");
            }
        });
        JsonNode res = Main.JSON.readTree(Main.respond(ops, Main.JSON.readTree("{\"id\":7,\"method\":\"x\"}")));
        assertEquals(7, res.path("id").asInt());
        assertTrue(res.has("error"));
    }
}
