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

        MqOps ops = new MqOps(new ConnectionPool());
        ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));

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
                ObjectNode res = JSON.createObjectNode();
                res.set("id", req.get("id"));
                try {
                    Object result = ops.dispatch(req.path("method").asText(), req.path("params"));
                    res.set("result", JSON.valueToTree(result));
                } catch (Throwable t) {
                    res.set("error", JSON.valueToTree(Errors.toError(t)));
                }
                String text;
                try {
                    text = JSON.writeValueAsString(res);
                } catch (Exception e) {
                    text = "{\"id\":" + req.get("id") + ",\"error\":{\"code\":0,\"name\":\"SERIALIZATION\",\"message\":\"Response could not be serialized\"}}";
                }
                synchronized (out) {
                    out.println(text);
                }
            });
        }

        executor.shutdown();
        ops.shutdown();
    }
}
