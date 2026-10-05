package org.akbal.sidecar;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ibm.mq.MQException;
import com.ibm.mq.MQGetMessageOptions;
import com.ibm.mq.MQMessage;
import com.ibm.mq.MQPutMessageOptions;
import com.ibm.mq.MQQueue;
import com.ibm.mq.MQQueueManager;
import com.ibm.mq.constants.CMQC;
import com.ibm.mq.constants.MQConstants;
import com.ibm.mq.headers.pcf.PCFMessage;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.Enumeration;
import java.util.GregorianCalendar;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/** The operations exposed over RPC. Every method maps to one UI action in the design. */
public final class MqOps {

    /** Payload bytes included with each browsed row; larger bodies are fetched with "detail". */
    private static final int ROW_PAYLOAD_CAP = 64 * 1024;
    /** Upper bound for "detail" so a huge message can't exhaust the UI. */
    private static final int DETAIL_PAYLOAD_CAP = 8 * 1024 * 1024;
    private static final int PREVIEW_CHARS = 240;

    private static final ObjectMapper MAPPER = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    private static final DateTimeFormatter MQ_DATE = DateTimeFormatter.ofPattern("yyyyMMdd").withZone(ZoneOffset.UTC);
    private static final DateTimeFormatter MQ_TIME = DateTimeFormatter.ofPattern("HHmmssSS").withZone(ZoneOffset.UTC);

    private final ConnectionPool pool;

    public MqOps(ConnectionPool pool) {
        this.pool = pool;
    }

    public void shutdown() {
        pool.closeAll();
    }

    public Object dispatch(String method, JsonNode p) throws Exception {
        return switch (method) {
            case "ping" -> Map.of("pong", true);
            case "test" -> test(config(p));
            case "connect" -> connect(config(p));
            case "disconnect" -> {
                pool.disconnect(p.path("connId").asText());
                yield Map.of("ok", true);
            }
            case "listQueues" -> pool.with(connId(p), h -> listQueues(h, strings(p.path("known"))));
            case "browse" -> pool.with(connId(p), h -> browse(h.qmgr, queue(p),
                    p.path("offset").asInt(0), p.path("limit").asInt(50)));
            case "detail" -> pool.with(connId(p), h -> detail(h.qmgr, queue(p), p.path("msgId").asText()));
            case "put" -> pool.with(connId(p), h -> put(h.qmgr, queue(p), p));
            case "delete" -> pool.with(connId(p), h -> delete(h.qmgr, queue(p), strings(p.path("msgIds"))));
            case "purge" -> pool.with(connId(p), h -> purge(h, queue(p)));
            default -> throw Errors.invalid("Unknown method: " + method);
        };
    }

    // ── connection ──────────────────────────────────────────────────────────

    public record QmgrInfo(String qmgr, String version, int cmdLevel, String platform,
                           long elapsedMs, String tlsProtocol, String tlsCipher, boolean pcf) {
    }

    private QmgrInfo test(Config c) throws Exception {
        long t0 = System.nanoTime();
        ConnectionPool.Handle h = pool.openDetached(c);
        try {
            return info(h, (System.nanoTime() - t0) / 1_000_000);
        } finally {
            ConnectionPool.close(h);
        }
    }

    private QmgrInfo connect(Config c) throws Exception {
        long t0 = System.nanoTime();
        ConnectionPool.Handle h = pool.connect(c);
        return info(h, (System.nanoTime() - t0) / 1_000_000);
    }

    private QmgrInfo info(ConnectionPool.Handle h, long elapsed) throws Exception {
        String name = h.qmgr.getName().trim();
        int cmdLevel = h.qmgr.getCommandLevel();
        String version = null;
        String platform = null;
        if (h.pcf != null) {
            try {
                PCFMessage req = new PCFMessage(MQConstants.MQCMD_INQUIRE_Q_MGR);
                req.addParameter(MQConstants.MQIACF_Q_MGR_ATTRS, new int[]{MQConstants.MQIACF_ALL});
                PCFMessage[] res = h.pcf.send(req);
                if (res.length > 0) {
                    version = formatVersion(str(res[0], MQConstants.MQCA_VERSION));
                    Integer pl = integer(res[0], MQConstants.MQIA_PLATFORM);
                    platform = pl == null ? null : Errors.lookup(pl, "MQPL_.*");
                }
            } catch (Exception ignored) {
                // Not authorised for PCF: fall back to the command level.
            }
        }
        if (version == null) {
            version = (cmdLevel / 100) + "." + (cmdLevel / 10 % 10) + "." + (cmdLevel % 10);
        }
        TlsFactory.Session tls = h.tls;
        return new QmgrInfo(name, version, cmdLevel, platform, elapsed,
                tls == null ? null : tls.protocol, tls == null ? null : tls.cipher, h.pcf != null);
    }

    static String formatVersion(String v) {
        if (v == null || !v.matches("\\d{8}")) {
            return v;
        }
        return Integer.parseInt(v.substring(0, 2)) + "." + Integer.parseInt(v.substring(2, 4)) + "."
                + Integer.parseInt(v.substring(4, 6)) + "." + Integer.parseInt(v.substring(6, 8));
    }

    // ── queues ──────────────────────────────────────────────────────────────

    /**
     * @param access what this user may do on the queue; null when the list came from PCF, which
     *               already leaves out queues the user has no display authority for.
     * @param error  set when a probed queue could not be used at all (not found, no authority).
     */
    public record QueueInfo(String name, String type, Integer depth, Integer maxDepth, Integer ipprocs,
                            Integer opprocs, String target, String description, boolean getInhibited,
                            boolean putInhibited, Access access, String error) {
    }

    public record Access(boolean inquire, boolean browse, boolean put, boolean get) {
        boolean any() {
            return inquire || browse || put || get;
        }
    }

    /** "pcf": every queue the user may display. "probe": only the known queues, checked one by one. */
    public record QueueList(String source, List<QueueInfo> queues) {
    }

    private QueueList listQueues(ConnectionPool.Handle h, List<String> known) throws Exception {
        if (h.pcf != null) {
            try {
                return new QueueList("pcf", inquireQueues(h));
            } catch (Exception e) {
                // Connected to the command queue but not allowed to inquire: same as no PCF.
                if (Errors.toError(e).code() != CMQC.MQRC_NOT_AUTHORIZED) {
                    throw e;
                }
            }
        }
        List<QueueInfo> out = new ArrayList<>();
        for (String name : new LinkedHashSet<>(known.stream().map(String::trim).filter(s -> !s.isEmpty()).toList())) {
            out.add(probe(h.qmgr, name));
        }
        return new QueueList("probe", out);
    }

    /**
     * Works out what the user can do on one queue without PCF: one MQOPEN per kind of access
     * (no message is read or written), plus MQINQ for the attributes when inquire is allowed.
     */
    static QueueInfo probe(MQQueueManager qm, String name) {
        int inq = tryOpen(qm, name, CMQC.MQOO_INQUIRE);
        if (inq == CMQC.MQRC_UNKNOWN_OBJECT_NAME) {
            return new QueueInfo(name, "Unknown", null, null, null, null, null, null, false, false,
                    new Access(false, false, false, false), "MQRC_UNKNOWN_OBJECT_NAME");
        }
        Access access = new Access(allowed(inq),
                allowed(tryOpen(qm, name, CMQC.MQOO_BROWSE)),
                allowed(tryOpen(qm, name, CMQC.MQOO_OUTPUT)),
                allowed(tryOpen(qm, name, CMQC.MQOO_INPUT_AS_Q_DEF)));
        if (!access.any()) {
            return new QueueInfo(name, "Unknown", null, null, null, null, null, null, false, false, access,
                    "MQRC_NOT_AUTHORIZED");
        }
        if (!access.inquire()) {
            return new QueueInfo(name, "Unknown", null, null, null, null, null, null, false, false, access, null);
        }
        try {
            MQQueue q = qm.accessQueue(name, CMQC.MQOO_INQUIRE | CMQC.MQOO_FAIL_IF_QUIESCING);
            try {
                int type = q.getQueueType();
                boolean local = type == CMQC.MQQT_LOCAL;
                String target = null;
                if (type == CMQC.MQQT_ALIAS) {
                    target = inquireString(q, CMQC.MQCA_BASE_OBJECT_NAME, CMQC.MQ_Q_NAME_LENGTH);
                } else if (type == CMQC.MQQT_REMOTE) {
                    String rq = inquireString(q, CMQC.MQCA_REMOTE_Q_NAME, CMQC.MQ_Q_NAME_LENGTH);
                    String rqm = inquireString(q, CMQC.MQCA_REMOTE_Q_MGR_NAME, CMQC.MQ_Q_MGR_NAME_LENGTH);
                    target = trim(rq) + (rqm == null || rqm.isEmpty() ? "" : " @ " + rqm);
                }
                return new QueueInfo(name, typeName(type),
                        local ? q.getCurrentDepth() : null,
                        local ? q.getMaximumDepth() : null,
                        local ? q.getOpenInputCount() : null,
                        local ? q.getOpenOutputCount() : null,
                        target, inquireString(q, CMQC.MQCA_Q_DESC, CMQC.MQ_Q_DESC_LENGTH),
                        type != CMQC.MQQT_REMOTE && q.getInhibitGet() == CMQC.MQQA_GET_INHIBITED,
                        q.getInhibitPut() == CMQC.MQQA_PUT_INHIBITED,
                        access, null);
            } finally {
                q.close();
            }
        } catch (MQException e) {
            return new QueueInfo(name, "Unknown", null, null, null, null, null, null, false, false, access, null);
        }
    }

    /** Reason code of opening and closing `name` with `options`; 0 when it opened. */
    private static int tryOpen(MQQueueManager qm, String name, int options) {
        try {
            qm.accessQueue(name, options | CMQC.MQOO_FAIL_IF_QUIESCING).close();
            return 0;
        } catch (MQException e) {
            return e.reasonCode;
        }
    }

    /** In use by someone else (2042) still means the open passed the authority check. */
    static boolean allowed(int reason) {
        return reason == 0 || reason == CMQC.MQRC_OBJECT_IN_USE;
    }

    private static String inquireString(MQQueue q, int selector, int length) {
        try {
            return q.getAttributeString(selector, length).trim();
        } catch (MQException e) {
            return null;
        }
    }

    private static String typeName(int type) {
        return switch (type) {
            case CMQC.MQQT_LOCAL -> "Local";
            case CMQC.MQQT_ALIAS -> "Alias";
            case CMQC.MQQT_REMOTE -> "Remote";
            case CMQC.MQQT_MODEL -> "Model";
            case CMQC.MQQT_CLUSTER -> "Cluster";
            default -> "Unknown";
        };
    }

    private List<QueueInfo> inquireQueues(ConnectionPool.Handle h) throws Exception {
        PCFMessage req = new PCFMessage(MQConstants.MQCMD_INQUIRE_Q);
        req.addParameter(MQConstants.MQCA_Q_NAME, "*");
        req.addParameter(MQConstants.MQIA_Q_TYPE, MQConstants.MQQT_ALL);
        req.addParameter(MQConstants.MQIACF_Q_ATTRS, new int[]{MQConstants.MQIACF_ALL});
        PCFMessage[] res = h.pcf.send(req);

        List<QueueInfo> out = new ArrayList<>();
        for (PCFMessage m : res) {
            String name = str(m, MQConstants.MQCA_Q_NAME);
            if (name == null) {
                continue;
            }
            Integer type = integer(m, MQConstants.MQIA_Q_TYPE);
            Integer defType = integer(m, MQConstants.MQIA_DEFINITION_TYPE);
            if (type != null && type == MQConstants.MQQT_LOCAL
                    && defType != null && defType == MQConstants.MQQDT_TEMPORARY_DYNAMIC) {
                // Reply queues of PCF agents (ours included) — not something to browse.
                continue;
            }
            String typeName = type == null ? "Unknown" : typeName(type);
            String target = null;
            if ("Alias".equals(typeName)) {
                target = str(m, MQConstants.MQCA_BASE_OBJECT_NAME);
            } else if ("Remote".equals(typeName)) {
                String rq = str(m, MQConstants.MQCA_REMOTE_Q_NAME);
                String rqm = str(m, MQConstants.MQCA_REMOTE_Q_MGR_NAME);
                target = (rq == null ? "" : rq) + (rqm == null || rqm.isEmpty() ? "" : " @ " + rqm);
            }
            Integer getInh = integer(m, MQConstants.MQIA_INHIBIT_GET);
            Integer putInh = integer(m, MQConstants.MQIA_INHIBIT_PUT);
            boolean local = "Local".equals(typeName);
            out.add(new QueueInfo(name, typeName,
                    local ? integer(m, MQConstants.MQIA_CURRENT_Q_DEPTH) : null,
                    local || "Model".equals(typeName) ? integer(m, MQConstants.MQIA_MAX_Q_DEPTH) : null,
                    local ? integer(m, MQConstants.MQIA_OPEN_INPUT_COUNT) : null,
                    local ? integer(m, MQConstants.MQIA_OPEN_OUTPUT_COUNT) : null,
                    target, str(m, MQConstants.MQCA_Q_DESC),
                    getInh != null && getInh == MQConstants.MQQA_GET_INHIBITED,
                    putInh != null && putInh == MQConstants.MQQA_PUT_INHIBITED, null, null));
        }
        return out;
    }

    // ── browse / detail ─────────────────────────────────────────────────────

    public record MqmdField(String k, String v, String dec) {
    }

    public record Prop(String k, String t, String v) {
    }

    public record Message(int seq, String msgId, String correlId, String putTime, String format, int size,
                          int priority, int persistence, int ccsid, String charset, String kind, String preview,
                          String text, String base64, boolean truncated, List<MqmdField> mqmd, List<Prop> props,
                          String putAppl, String userId, int backoutCount) {
    }

    public record BrowseResult(String queue, int depth, int maxDepth, int offset, List<Message> messages,
                               boolean more, String browsedAt) {
    }

    private BrowseResult browse(MQQueueManager qm, String queueName, int offset, int limit) throws Exception {
        limit = Math.max(1, Math.min(limit, 5000));
        MQQueue q = qm.accessQueue(queueName, CMQC.MQOO_BROWSE | CMQC.MQOO_FAIL_IF_QUIESCING);
        int depth = -1;
        int maxDepth = -1;
        try {
            try {
                MQQueue iq = qm.accessQueue(queueName, CMQC.MQOO_INQUIRE | CMQC.MQOO_FAIL_IF_QUIESCING);
                try {
                    depth = iq.getCurrentDepth();
                    maxDepth = iq.getMaximumDepth();
                } finally {
                    iq.close();
                }
            } catch (MQException ignored) {
                // Alias/remote queues or no +inq authority: depth stays unknown.
            }

            List<Message> out = new ArrayList<>();
            MQGetMessageOptions gmo = browseOptions(CMQC.MQGMO_BROWSE_FIRST);
            int seq = 0;
            boolean more = false;
            while (true) {
                MQMessage msg = new MQMessage();
                try {
                    q.get(msg, gmo);
                } catch (MQException e) {
                    if (e.reasonCode == CMQC.MQRC_NO_MSG_AVAILABLE) {
                        break;
                    }
                    throw e;
                }
                gmo.options = browseOptions(CMQC.MQGMO_BROWSE_NEXT).options;
                seq++;
                if (seq <= offset) {
                    continue;
                }
                if (out.size() == limit) {
                    more = true;
                    break;
                }
                out.add(toMessage(msg, seq, ROW_PAYLOAD_CAP));
            }
            return new BrowseResult(queueName, depth, maxDepth, offset, out, more, Instant.now().toString());
        } finally {
            q.close();
        }
    }

    private Message detail(MQQueueManager qm, String queueName, String msgId) throws Exception {
        MQQueue q = qm.accessQueue(queueName, CMQC.MQOO_BROWSE | CMQC.MQOO_FAIL_IF_QUIESCING);
        try {
            MQMessage msg = new MQMessage();
            msg.messageId = Payloads.parseHex(msgId);
            MQGetMessageOptions gmo = browseOptions(CMQC.MQGMO_BROWSE_FIRST);
            gmo.matchOptions = CMQC.MQMO_MATCH_MSG_ID;
            q.get(msg, gmo);
            return toMessage(msg, 0, DETAIL_PAYLOAD_CAP);
        } finally {
            q.close();
        }
    }

    private static MQGetMessageOptions browseOptions(int position) {
        MQGetMessageOptions gmo = new MQGetMessageOptions();
        gmo.options = position | CMQC.MQGMO_NO_WAIT | CMQC.MQGMO_FAIL_IF_QUIESCING | CMQC.MQGMO_PROPERTIES_IN_HANDLE;
        gmo.matchOptions = CMQC.MQMO_NONE;
        return gmo;
    }

    static Message toMessage(MQMessage m, int seq, int cap) throws Exception {
        int size = m.getTotalMessageLength();
        byte[] data = new byte[m.getDataLength()];
        m.readFully(data);
        boolean truncated = data.length > cap;
        byte[] shown = truncated ? java.util.Arrays.copyOf(data, cap) : data;

        // Decode the whole body for kind detection; a cut-off JSON document would not parse.
        String full = Payloads.decodeText(data, m.characterSet);
        String text = full == null ? null : truncated ? full.substring(0, Math.min(full.length(), cap)) : full;
        String kind = Payloads.kind(full);

        return new Message(seq, Payloads.hex(m.messageId), Payloads.hex(m.correlationId), putTime(m),
                m.format == null ? "" : m.format.trim(), size, m.priority, m.persistence, m.characterSet,
                Payloads.charsetLabel(m.characterSet), kind, "binary".equals(kind) ? null : Payloads.preview(text, PREVIEW_CHARS), text,
                Base64.getEncoder().encodeToString(shown), truncated, mqmd(m), props(m),
                trim(m.putApplicationName), trim(m.userId), m.backoutCount);
    }

    private static String putTime(MQMessage m) {
        GregorianCalendar c = m.putDateTime;
        return c == null ? null : c.toInstant().toString();
    }

    static List<MqmdField> mqmd(MQMessage m) {
        Instant put = m.putDateTime == null ? null : m.putDateTime.toInstant();
        List<MqmdField> f = new ArrayList<>();
        f.add(new MqmdField("StrucId", "MD", ""));
        f.add(new MqmdField("Version", "2", "MQMD_VERSION_2"));
        f.add(new MqmdField("Report", m.report == 0 ? "0" : String.format("0x%08X", m.report), m.report == 0 ? "MQRO_NONE" : reportFlags(m.report)));
        f.add(new MqmdField("MsgType", String.valueOf(m.messageType), name(m.messageType, "MQMT_.*")));
        f.add(new MqmdField("Expiry", String.valueOf(m.expiry), m.expiry == CMQC.MQEI_UNLIMITED ? "MQEI_UNLIMITED" : m.expiry / 10.0 + " s"));
        f.add(new MqmdField("Feedback", String.valueOf(m.feedback), m.feedback == 0 ? "MQFB_NONE" : name(m.feedback, "MQFB_.*|MQRC_.*")));
        f.add(new MqmdField("Encoding", String.valueOf(m.encoding), encoding(m.encoding)));
        f.add(new MqmdField("CodedCharSetId", String.valueOf(m.characterSet), Payloads.charsetLabel(m.characterSet)));
        f.add(new MqmdField("Format", m.format == null ? "" : m.format.trim(), m.format == null || m.format.isBlank() ? "MQFMT_NONE" : ""));
        f.add(new MqmdField("Priority", String.valueOf(m.priority), ""));
        f.add(new MqmdField("Persistence", String.valueOf(m.persistence), name(m.persistence, "MQPER_.*")));
        f.add(new MqmdField("MsgId", Payloads.hex(m.messageId), ""));
        f.add(new MqmdField("CorrelId", Payloads.hex(m.correlationId), Payloads.isZero(m.correlationId) ? "MQCI_NONE" : ""));
        f.add(new MqmdField("BackoutCount", String.valueOf(m.backoutCount), ""));
        f.add(new MqmdField("ReplyToQ", trim(m.replyToQueueName), ""));
        f.add(new MqmdField("ReplyToQMgr", trim(m.replyToQueueManagerName), ""));
        f.add(new MqmdField("UserIdentifier", trim(m.userId), ""));
        f.add(new MqmdField("AccountingToken", Payloads.hex(m.accountingToken), ""));
        f.add(new MqmdField("ApplIdentityData", trim(m.applicationIdData), ""));
        f.add(new MqmdField("PutApplType", String.valueOf(m.putApplicationType), name(m.putApplicationType, "MQAT_.*")));
        f.add(new MqmdField("PutApplName", trim(m.putApplicationName), ""));
        f.add(new MqmdField("PutDate", put == null ? "" : MQ_DATE.format(put), "GMT"));
        f.add(new MqmdField("PutTime", put == null ? "" : MQ_TIME.format(put), "GMT"));
        f.add(new MqmdField("ApplOriginData", trim(m.applicationOriginData), ""));
        f.add(new MqmdField("GroupId", Payloads.hex(m.groupId), Payloads.isZero(m.groupId) ? "MQGI_NONE" : ""));
        f.add(new MqmdField("MsgSeqNumber", String.valueOf(m.messageSequenceNumber), ""));
        f.add(new MqmdField("Offset", String.valueOf(m.offset), ""));
        f.add(new MqmdField("MsgFlags", String.valueOf(m.messageFlags), m.messageFlags == 0 ? "MQMF_NONE" : ""));
        f.add(new MqmdField("OriginalLength", String.valueOf(m.originalLength), m.originalLength == CMQC.MQOL_UNDEFINED ? "MQOL_UNDEFINED" : ""));
        return f;
    }

    private static String reportFlags(int report) {
        Map<String, Integer> flags = new LinkedHashMap<>();
        flags.put("MQRO_COA", CMQC.MQRO_COA);
        flags.put("MQRO_COD", CMQC.MQRO_COD);
        flags.put("MQRO_EXCEPTION", CMQC.MQRO_EXCEPTION);
        flags.put("MQRO_EXPIRATION", CMQC.MQRO_EXPIRATION);
        flags.put("MQRO_PAN", CMQC.MQRO_PAN);
        flags.put("MQRO_NAN", CMQC.MQRO_NAN);
        flags.put("MQRO_PASS_CORREL_ID", CMQC.MQRO_PASS_CORREL_ID);
        flags.put("MQRO_PASS_MSG_ID", CMQC.MQRO_PASS_MSG_ID);
        flags.put("MQRO_DISCARD_MSG", CMQC.MQRO_DISCARD_MSG);
        List<String> names = new ArrayList<>();
        flags.forEach((label, bits) -> {
            if ((report & bits) == bits) {
                names.add(label);
            }
        });
        return String.join(" + ", names);
    }

    private static String encoding(int enc) {
        int integer = enc & CMQC.MQENC_INTEGER_MASK;
        if (integer == CMQC.MQENC_INTEGER_NORMAL) {
            return "big-endian integers";
        }
        if (integer == CMQC.MQENC_INTEGER_REVERSED) {
            return "little-endian integers";
        }
        return "";
    }

    static List<Prop> props(MQMessage m) {
        List<Prop> out = new ArrayList<>();
        try {
            Enumeration<String> names = m.getPropertyNames("%");
            for (String n : Collections.list(names)) {
                Object v = m.getObjectProperty(n);
                out.add(new Prop(n, propType(v), v instanceof byte[] b ? Payloads.hex(b) : String.valueOf(v)));
            }
        } catch (Exception ignored) {
            // Properties not available (for example PROPCTL(NONE)); show none.
        }
        return out;
    }

    private static String propType(Object v) {
        if (v == null) {
            return "Null";
        }
        return switch (v) {
            case String s -> "String";
            case Integer i -> "Int32";
            case Long l -> "Int64";
            case Short s -> "Int16";
            case Byte b -> "Int8";
            case Boolean b -> "Boolean";
            case Float f -> "Float32";
            case Double d -> "Float64";
            case byte[] b -> "Bytes";
            default -> v.getClass().getSimpleName();
        };
    }

    // ── put ─────────────────────────────────────────────────────────────────

    public record PropIn(String name, String type, String value) {
    }

    public record PutResult(int count, List<String> msgIds, long elapsedMs) {
    }

    private PutResult put(MQQueueManager qm, String queueName, JsonNode p) throws Exception {
        JsonNode md = p.path("mqmd");
        int count = Math.max(1, Math.min(p.path("count").asInt(1), 10_000));
        int ccsid = md.path("ccsid").asInt(1208);
        byte[] body = p.hasNonNull("bodyBase64")
                ? Base64.getDecoder().decode(p.get("bodyBase64").asText())
                : p.path("body").asText("").getBytes(Payloads.charset(ccsid));
        List<PropIn> props = new ArrayList<>();
        for (JsonNode n : p.path("properties")) {
            props.add(MAPPER.treeToValue(n, PropIn.class));
        }

        MQQueue q = qm.accessQueue(queueName, CMQC.MQOO_OUTPUT | CMQC.MQOO_FAIL_IF_QUIESCING);
        List<String> ids = new ArrayList<>();
        long t0 = System.nanoTime();
        try {
            for (int i = 0; i < count; i++) {
                MQMessage m = new MQMessage();
                m.format = Payloads.format(md.path("format").asText("MQSTR"));
                m.characterSet = ccsid;
                m.priority = md.path("priority").asInt(CMQC.MQPRI_PRIORITY_AS_Q_DEF);
                m.persistence = switch (md.path("persistence").asText("Q")) {
                    case "P" -> CMQC.MQPER_PERSISTENT;
                    case "NP" -> CMQC.MQPER_NOT_PERSISTENT;
                    default -> CMQC.MQPER_PERSISTENCE_AS_Q_DEF;
                };
                m.expiry = md.hasNonNull("expiry") ? md.get("expiry").asInt() : CMQC.MQEI_UNLIMITED;
                String replyQ = md.path("replyToQ").asText("");
                if (!replyQ.isBlank()) {
                    m.replyToQueueName = replyQ;
                    m.replyToQueueManagerName = md.path("replyToQmgr").asText("");
                    m.messageType = CMQC.MQMT_REQUEST;
                }
                String correl = md.path("correlId").asText("");
                if (!correl.isBlank()) {
                    m.correlationId = Payloads.idBytes(correl);
                }
                String msgId = md.path("msgId").asText("");
                MQPutMessageOptions pmo = new MQPutMessageOptions();
                pmo.options = CMQC.MQPMO_NO_SYNCPOINT | CMQC.MQPMO_FAIL_IF_QUIESCING;
                if (msgId.isBlank()) {
                    pmo.options |= CMQC.MQPMO_NEW_MSG_ID;
                } else {
                    m.messageId = Payloads.idBytes(msgId);
                }
                for (PropIn pr : props) {
                    setProperty(m, pr);
                }
                m.write(body);
                q.put(m, pmo);
                ids.add(Payloads.hex(m.messageId));
            }
        } finally {
            q.close();
        }
        return new PutResult(count, ids, (System.nanoTime() - t0) / 1_000_000);
    }

    private static void setProperty(MQMessage m, PropIn p) throws MQException {
        if (p.name() == null || p.name().isBlank()) {
            return;
        }
        String v = p.value() == null ? "" : p.value();
        switch (p.type() == null ? "String" : p.type()) {
            case "Int32" -> m.setIntProperty(p.name(), Integer.parseInt(v.trim()));
            case "Int64" -> m.setLongProperty(p.name(), Long.parseLong(v.trim()));
            case "Int16" -> m.setShortProperty(p.name(), Short.parseShort(v.trim()));
            case "Int8" -> m.setByteProperty(p.name(), Byte.parseByte(v.trim()));
            case "Boolean" -> m.setBooleanProperty(p.name(), Boolean.parseBoolean(v.trim()));
            case "Float32" -> m.setFloatProperty(p.name(), Float.parseFloat(v.trim()));
            case "Float64" -> m.setDoubleProperty(p.name(), Double.parseDouble(v.trim()));
            case "Bytes" -> m.setBytesProperty(p.name(), Payloads.parseHex(v.trim()));
            default -> m.setStringProperty(p.name(), v);
        }
    }

    // ── delete / purge ──────────────────────────────────────────────────────

    public record DeleteResult(int deleted, List<String> notFound, int depth) {
    }

    private DeleteResult delete(MQQueueManager qm, String queueName, List<String> msgIds) throws Exception {
        MQQueue q = qm.accessQueue(queueName, CMQC.MQOO_INPUT_AS_Q_DEF | CMQC.MQOO_INQUIRE | CMQC.MQOO_FAIL_IF_QUIESCING);
        int deleted = 0;
        List<String> notFound = new ArrayList<>();
        try {
            for (String id : msgIds) {
                byte[] msgId = Payloads.parseHex(id);
                if (Payloads.isZero(msgId)) {
                    // MQMI_NONE matches any message; never let it delete an arbitrary one.
                    notFound.add(id);
                    continue;
                }
                MQMessage m = new MQMessage();
                m.messageId = msgId;
                MQGetMessageOptions gmo = new MQGetMessageOptions();
                gmo.options = CMQC.MQGMO_NO_WAIT | CMQC.MQGMO_SYNCPOINT | CMQC.MQGMO_FAIL_IF_QUIESCING;
                gmo.matchOptions = CMQC.MQMO_MATCH_MSG_ID;
                try {
                    q.get(m, gmo);
                    deleted++;
                } catch (MQException e) {
                    if (e.reasonCode != CMQC.MQRC_NO_MSG_AVAILABLE) {
                        qm.backout();
                        throw e;
                    }
                    notFound.add(id);
                }
            }
            qm.commit();
            return new DeleteResult(deleted, notFound, q.getCurrentDepth());
        } finally {
            q.close();
        }
    }

    public record PurgeResult(int removed, String method) {
    }

    private PurgeResult purge(ConnectionPool.Handle h, String queueName) throws Exception {
        int before = -1;
        try {
            MQQueue iq = h.qmgr.accessQueue(queueName, CMQC.MQOO_INQUIRE | CMQC.MQOO_FAIL_IF_QUIESCING);
            try {
                before = iq.getCurrentDepth();
            } finally {
                iq.close();
            }
        } catch (MQException ignored) {
        }

        if (h.pcf != null) {
            try {
                PCFMessage req = new PCFMessage(MQConstants.MQCMD_CLEAR_Q);
                req.addParameter(MQConstants.MQCA_Q_NAME, queueName);
                h.pcf.send(req);
                return new PurgeResult(before, "CLEAR QLOCAL");
            } catch (Exception e) {
                // CLEAR fails while the queue is open (2042) or without +clr authority: drain instead.
            }
        }

        MQQueue q = h.qmgr.accessQueue(queueName, CMQC.MQOO_INPUT_AS_Q_DEF | CMQC.MQOO_FAIL_IF_QUIESCING);
        int removed = 0;
        try {
            while (true) {
                MQMessage m = new MQMessage();
                MQGetMessageOptions gmo = new MQGetMessageOptions();
                gmo.options = CMQC.MQGMO_NO_WAIT | CMQC.MQGMO_SYNCPOINT | CMQC.MQGMO_FAIL_IF_QUIESCING;
                try {
                    q.get(m, gmo);
                } catch (MQException e) {
                    if (e.reasonCode == CMQC.MQRC_NO_MSG_AVAILABLE) {
                        break;
                    }
                    h.qmgr.commit();
                    throw e;
                }
                removed++;
                if (removed % 500 == 0) {
                    h.qmgr.commit();
                }
            }
            h.qmgr.commit();
        } finally {
            q.close();
        }
        return new PurgeResult(removed, "destructive get");
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private static Config config(JsonNode p) throws Exception {
        Config c = MAPPER.treeToValue(p.path("conn"), Config.class);
        if (c == null || c.id() == null || c.host() == null) {
            throw Errors.invalid("conn with id and host is required");
        }
        return c;
    }

    private static String connId(JsonNode p) {
        String id = p.path("connId").asText("");
        if (id.isBlank()) {
            throw Errors.invalid("connId is required");
        }
        return id;
    }

    private static String queue(JsonNode p) {
        String q = p.path("queue").asText("");
        if (q.isBlank()) {
            throw Errors.invalid("queue is required");
        }
        return q;
    }

    private static List<String> strings(JsonNode arr) {
        List<String> out = new ArrayList<>();
        arr.forEach(n -> out.add(n.asText()));
        return out;
    }

    private static String str(PCFMessage m, int id) {
        try {
            Object v = m.getParameterValue(id);
            return v == null ? null : v.toString().trim();
        } catch (Exception e) {
            return null;
        }
    }

    private static Integer integer(PCFMessage m, int id) {
        try {
            Object v = m.getParameterValue(id);
            return v instanceof Integer i ? i : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static String name(int value, String filter) {
        String n = Errors.lookup(value, filter);
        return n == null ? "" : n;
    }

    private static String trim(String s) {
        return s == null ? "" : s.trim();
    }
}
