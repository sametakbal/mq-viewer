package org.akbal.sidecar;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.BufferedReader;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Line-delimited JSON-RPC over stdin/stdout.
 * <pre>
 * request:  {"id": 1, "method": "browse", "params": {...}}
 * response: {"id": 1, "result": ...} | {"id": 1, "error": {...}}
 * </pre>
 * stdout is reserved for responses; anything else the MQ client prints goes to stderr.
 */
public final class Main {

    static final ObjectMapper JSON = new ObjectMapper();

    private Main() {
    }

    public static void main(String[] args) throws Exception {
        PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
        System.setOut(System.err);

        // Use JSSE cipher suite names (TLS_AES_256_GCM_SHA384) instead of IBM JRE mappings.
        System.setProperty("com.ibm.mq.cfg.useIBMCipherMappings", "false");

        serve(new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8)), out,
                new MqOps(new ConnectionPool()));
    }

    /** Answers requests from `in` until it closes, each on its own virtual thread, then closes all connections. */
    static void serve(BufferedReader in, PrintStream out, MqOps ops) throws Exception {
        ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
        out.println("{\"ready\":true}");

        String line;
        while ((line = in.readLine()) != null) {
            if (line.isBlank()) {
                continue;
            }
            JsonNode req;
            try {
                req = JSON.readTree(line);
            } catch (Exception e) {
                System.err.println("sidecar: invalid request: " + e.getMessage());
                continue;
            }
            executor.submit(() -> {
                String text = respond(ops, req);
                synchronized (out) {
                    out.println(text);
                }
            });
        }

        executor.shutdown();
        executor.awaitTermination(5, TimeUnit.SECONDS);
        ops.shutdown();
    }

    static String respond(MqOps ops, JsonNode req) {
        ObjectNode res = JSON.createObjectNode();
        res.set("id", req.get("id"));
        try {
            Object result = ops.dispatch(req.path("method").asText(), req.path("params"));
            res.set("result", JSON.valueToTree(result));
        } catch (Throwable t) {
            res.set("error", JSON.valueToTree(Errors.toError(t)));
        }
        try {
            return JSON.writeValueAsString(res);
        } catch (Exception e) {
            return "{\"id\":" + req.get("id") + ",\"error\":{\"code\":0,\"name\":\"SERIALIZATION\",\"message\":\"Response could not be serialized\"}}";
        }
    }
}
