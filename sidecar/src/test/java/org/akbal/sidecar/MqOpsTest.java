package org.akbal.sidecar;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ibm.mq.MQException;
import com.ibm.mq.MQGetMessageOptions;
import com.ibm.mq.MQMessage;
import com.ibm.mq.MQPutMessageOptions;
import com.ibm.mq.MQQueue;
import com.ibm.mq.MQQueueManager;
import com.ibm.mq.constants.CMQC;
import com.ibm.mq.constants.MQConstants;
import com.ibm.mq.headers.pcf.PCFException;
import com.ibm.mq.headers.pcf.PCFMessage;
import com.ibm.mq.headers.pcf.PCFMessageAgent;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.stubbing.Answer;

import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Base64;
import java.util.Collections;
import java.util.Deque;
import java.util.GregorianCalendar;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;
import java.util.function.Consumer;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class MqOpsTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int INQ = CMQC.MQOO_INQUIRE | CMQC.MQOO_FAIL_IF_QUIESCING;
    private static final int BROWSE = CMQC.MQOO_BROWSE | CMQC.MQOO_FAIL_IF_QUIESCING;

    private ConnectionPool pool;
    private ConnectionPool.Handle h;
    private MQQueueManager qm;
    private PCFMessageAgent pcf;
    private MqOps ops;

    @BeforeEach
    void setUp() throws Exception {
        pool = mock(ConnectionPool.class);
        h = new ConnectionPool.Handle(new Config("c1", "mq1", 1414, "CH", "QM1", null, null, null));
        qm = mock(MQQueueManager.class);
        pcf = mock(PCFMessageAgent.class);
        h.qmgr = qm;
        h.pcf = pcf;
        when(pool.with(eq("c1"), any())).thenAnswer(inv -> inv.<ConnectionPool.Op<?>>getArgument(1).run(h));
        ops = new MqOps(pool);
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private static MQException mqe(int reason) {
        return new MQException(CMQC.MQCC_FAILED, reason, "test");
    }

    private static ObjectNode params(Object... kv) {
        ObjectNode n = JSON.createObjectNode();
        for (int i = 0; i < kv.length; i += 2) {
            n.set((String) kv[i], JSON.valueToTree(kv[i + 1]));
        }
        return n;
    }

    private Object call(String method, Object... kv) throws Exception {
        return ops.dispatch(method, params(kv));
    }

    private static void fill(MQMessage target, String body, Consumer<MQMessage> extra) throws Exception {
        target.characterSet = 1208;
        target.format = "MQSTR   ";
        extra.accept(target);
        target.write(body.getBytes(StandardCharsets.UTF_8));
        target.seek(0);
    }

    /** Hands out the given bodies to successive MQGET calls, then MQRC_NO_MSG_AVAILABLE. */
    private static Answer<Void> gets(String... bodies) {
        Deque<String> left = new ArrayDeque<>(List.of(bodies));
        return inv -> {
            if (left.isEmpty()) {
                throw mqe(CMQC.MQRC_NO_MSG_AVAILABLE);
            }
            MQMessage m = inv.getArgument(0);
            String body = left.pop();
            fill(m, body, x -> x.messageId = Payloads.idBytes(body.length() > 24 ? body.substring(0, 24) : body));
            return null;
        };
    }

    private static PCFMessage pcfMsg(Object... kv) {
        PCFMessage m = new PCFMessage(MQConstants.MQCMD_INQUIRE_Q);
        for (int i = 0; i < kv.length; i += 2) {
            int id = (Integer) kv[i];
            if (kv[i + 1] instanceof String s) {
                m.addParameter(id, s);
            } else {
                m.addParameter(id, (Integer) kv[i + 1]);
            }
        }
        return m;
    }

    private static String body(MQMessage m) throws Exception {
        m.seek(0);
        byte[] b = new byte[m.getDataLength()];
        m.readFully(b);
        return new String(b, StandardCharsets.UTF_8);
    }

    // ── dispatch / validation ───────────────────────────────────────────────

    @Test
    void pingUnknownAndMissingParameters() throws Exception {
        assertEquals(Map.of("pong", true), call("ping"));
        assertEquals("Unknown method: nope", assertThrows(Errors.OpException.class, () -> call("nope")).getMessage());
        assertEquals("connId is required", assertThrows(Errors.OpException.class, () -> call("browse")).getMessage());
        assertEquals("queue is required", assertThrows(Errors.OpException.class, () -> call("browse", "connId", "c1")).getMessage());
        assertEquals("conn with id and host is required",
                assertThrows(Errors.OpException.class, () -> call("connect", "conn", Map.of("id", "c1"))).getMessage());
        assertEquals("conn with id and host is required", assertThrows(Errors.OpException.class, () -> call("test")).getMessage());
    }

    @Test
    void disconnectAndShutdown() throws Exception {
        assertEquals(Map.of("ok", true), call("disconnect", "connId", "c1"));
        verify(pool).disconnect("c1");
        ops.shutdown();
        verify(pool).closeAll();
    }

    // ── connect / test ──────────────────────────────────────────────────────

    @Test
    void testConnectionReportsVersionAndPlatformFromPcfAndCloses() throws Exception {
        when(pool.openDetached(any())).thenReturn(h);
        when(qm.getName()).thenReturn("QM1   ");
        when(qm.getCommandLevel()).thenReturn(940);
        PCFMessage res = pcfMsg(MQConstants.MQCA_VERSION, "09040005", MQConstants.MQIA_PLATFORM, MQConstants.MQPL_UNIX);
        when(pcf.send(any())).thenReturn(new PCFMessage[]{res});

        MqOps.QmgrInfo info = (MqOps.QmgrInfo) call("test", "conn", Map.of("id", "c1", "host", "mq1", "port", 1414));
        assertEquals("QM1", info.qmgr());
        assertEquals("9.4.0.5", info.version());
        assertEquals("MQPL_UNIX", info.platform());
        assertTrue(info.pcf());
        assertNull(info.tlsProtocol());
        verify(qm).disconnect();
        verify(pcf).disconnect();
    }

    @Test
    void connectFallsBackToTheCommandLevel() throws Exception {
        when(pool.connect(any())).thenReturn(h);
        when(qm.getName()).thenReturn("QM1");
        when(qm.getCommandLevel()).thenReturn(940);
        h.tls = new TlsFactory.Session();
        h.tls.protocol = "TLSv1.3";
        h.tls.cipher = "TLS_AES_256_GCM_SHA384";
        Map<String, Object> conn = Map.of("id", "c1", "host", "mq1");

        when(pcf.send(any())).thenThrow(new PCFException(2, CMQC.MQRC_NOT_AUTHORIZED, "x"));
        MqOps.QmgrInfo a = (MqOps.QmgrInfo) call("connect", "conn", conn);
        assertEquals("9.4.0", a.version());
        assertEquals("TLSv1.3", a.tlsProtocol());
        assertEquals("TLS_AES_256_GCM_SHA384", a.tlsCipher());

        doReturn(new PCFMessage[0]).when(pcf).send(any());
        assertEquals("9.4.0", ((MqOps.QmgrInfo) call("connect", "conn", conn)).version());

        doReturn(new PCFMessage[]{pcfMsg(MQConstants.MQCA_VERSION, "custom")}).when(pcf).send(any());
        MqOps.QmgrInfo c = (MqOps.QmgrInfo) call("connect", "conn", conn);
        assertEquals("custom", c.version());
        assertNull(c.platform());

        h.pcf = null;
        MqOps.QmgrInfo d = (MqOps.QmgrInfo) call("connect", "conn", conn);
        assertFalse(d.pcf());
        assertEquals("9.4.0", d.version());
        verify(qm, never()).disconnect();
    }

    @Test
    void formatVersion() {
        assertNull(MqOps.formatVersion(null));
        assertEquals("9.4", MqOps.formatVersion("9.4"));
    }

    // ── queue list ──────────────────────────────────────────────────────────

    @Test
    void listsQueuesThroughPcf() throws Exception {
        when(pcf.send(any())).thenReturn(new PCFMessage[]{
                pcfMsg(MQConstants.MQCA_Q_NAME, "PAY.IN  ", MQConstants.MQIA_Q_TYPE, MQConstants.MQQT_LOCAL,
                        MQConstants.MQIA_CURRENT_Q_DEPTH, 3, MQConstants.MQIA_MAX_Q_DEPTH, 5000,
                        MQConstants.MQIA_OPEN_INPUT_COUNT, 1, MQConstants.MQIA_OPEN_OUTPUT_COUNT, 2,
                        MQConstants.MQCA_Q_DESC, "Payments ", MQConstants.MQIA_INHIBIT_GET, MQConstants.MQQA_GET_INHIBITED,
                        MQConstants.MQIA_INHIBIT_PUT, MQConstants.MQQA_PUT_ALLOWED),
                pcfMsg(MQConstants.MQCA_Q_NAME, "AMQ.TEMP", MQConstants.MQIA_Q_TYPE, MQConstants.MQQT_LOCAL,
                        MQConstants.MQIA_DEFINITION_TYPE, MQConstants.MQQDT_TEMPORARY_DYNAMIC),
                pcfMsg(MQConstants.MQCA_Q_NAME, "PERM", MQConstants.MQIA_Q_TYPE, MQConstants.MQQT_LOCAL,
                        MQConstants.MQIA_DEFINITION_TYPE, MQConstants.MQQDT_PREDEFINED),
                pcfMsg(MQConstants.MQCA_Q_NAME, "PAY.API", MQConstants.MQIA_Q_TYPE, MQConstants.MQQT_ALIAS,
                        MQConstants.MQCA_BASE_OBJECT_NAME, "PAY.IN", MQConstants.MQIA_INHIBIT_PUT, MQConstants.MQQA_PUT_INHIBITED),
                pcfMsg(MQConstants.MQCA_Q_NAME, "CLR.OUT", MQConstants.MQIA_Q_TYPE, MQConstants.MQQT_REMOTE,
                        MQConstants.MQCA_REMOTE_Q_NAME, "CLR.IN", MQConstants.MQCA_REMOTE_Q_MGR_NAME, "QM2"),
                pcfMsg(MQConstants.MQCA_Q_NAME, "XMIT.DEF", MQConstants.MQIA_Q_TYPE, MQConstants.MQQT_REMOTE,
                        MQConstants.MQCA_REMOTE_Q_MGR_NAME, ""),
                pcfMsg(MQConstants.MQCA_Q_NAME, "MODEL", MQConstants.MQIA_Q_TYPE, MQConstants.MQQT_MODEL,
                        MQConstants.MQIA_MAX_Q_DEPTH, 100),
                pcfMsg(MQConstants.MQCA_Q_NAME, "CLUS", MQConstants.MQIA_Q_TYPE, MQConstants.MQQT_CLUSTER),
                pcfMsg(MQConstants.MQCA_Q_NAME, "ODD", MQConstants.MQIA_Q_TYPE, 99),
                pcfMsg(MQConstants.MQCA_Q_NAME, "NOTYPE"),
                pcfMsg(MQConstants.MQIA_Q_TYPE, MQConstants.MQQT_LOCAL),
        });

        MqOps.QueueList list = (MqOps.QueueList) call("listQueues", "connId", "c1");
        assertEquals("pcf", list.source());
        Map<String, MqOps.QueueInfo> q = list.queues().stream().collect(Collectors.toMap(MqOps.QueueInfo::name, x -> x));
        assertEquals(List.of("PAY.IN", "PERM", "PAY.API", "CLR.OUT", "XMIT.DEF", "MODEL", "CLUS", "ODD", "NOTYPE"),
                list.queues().stream().map(MqOps.QueueInfo::name).toList());
        assertEquals(new MqOps.QueueInfo("PAY.IN", "Local", 3, 5000, 1, 2, null, "Payments", true, false, null, null), q.get("PAY.IN"));
        assertEquals("PAY.IN", q.get("PAY.API").target());
        assertTrue(q.get("PAY.API").putInhibited());
        assertNull(q.get("PAY.API").depth());
        assertEquals("CLR.IN @ QM2", q.get("CLR.OUT").target());
        assertEquals("", q.get("XMIT.DEF").target());
        assertEquals(100, q.get("MODEL").maxDepth());
        assertEquals("Cluster", q.get("CLUS").type());
        assertEquals("Unknown", q.get("ODD").type());
        assertEquals("Unknown", q.get("NOTYPE").type());
    }

    @Test
    void probesKnownQueuesWithoutPcfAuthority() throws Exception {
        when(pcf.send(any())).thenThrow(new PCFException(2, CMQC.MQRC_NOT_AUTHORIZED, "x"));
        when(qm.accessQueue(eq("MISSING"), anyInt())).thenThrow(mqe(CMQC.MQRC_UNKNOWN_OBJECT_NAME));

        MqOps.QueueList list = (MqOps.QueueList) ops.dispatch("listQueues",
                JSON.readTree("{\"connId\":\"c1\",\"known\":[\" MISSING \",\"\",\"MISSING\"]}"));
        assertEquals("probe", list.source());
        assertEquals(1, list.queues().size());
        assertEquals("MQRC_UNKNOWN_OBJECT_NAME", list.queues().get(0).error());
        verify(qm, times(1)).accessQueue(eq("MISSING"), anyInt());
    }

    @Test
    void otherPcfErrorsFailTheList() throws Exception {
        when(pcf.send(any())).thenThrow(new PCFException(2, CMQC.MQRC_Q_MGR_STOPPING, "x"));
        assertThrows(PCFException.class, () -> call("listQueues", "connId", "c1"));
    }

    @Test
    void noPcfAgentMeansProbing() throws Exception {
        h.pcf = null;
        MqOps.QueueList list = (MqOps.QueueList) call("listQueues", "connId", "c1");
        assertEquals(new MqOps.QueueList("probe", List.of()), list);
    }

    /** accessQueue answers by open option: a reason code per option, or a queue mock for MQOO_INQUIRE. */
    private void access(String name, int inquire, int browse, int output, int input, MQQueue inqQueue) throws Exception {
        when(qm.accessQueue(eq(name), anyInt())).thenAnswer(inv -> {
            int opts = inv.getArgument(1);
            int rc = (opts & CMQC.MQOO_INQUIRE) != 0 ? inquire : (opts & CMQC.MQOO_BROWSE) != 0 ? browse
                    : (opts & CMQC.MQOO_OUTPUT) != 0 ? output : input;
            if (rc != 0) {
                throw mqe(rc);
            }
            return (opts & CMQC.MQOO_INQUIRE) != 0 && inqQueue != null ? inqQueue : mock(MQQueue.class);
        });
    }

    @Test
    void probeReportsAccessAndAttributes() throws Exception {
        int na = CMQC.MQRC_NOT_AUTHORIZED;
        access("DENIED", na, na, na, na, null);
        MqOps.QueueInfo denied = MqOps.probe(qm, "DENIED");
        assertEquals("MQRC_NOT_AUTHORIZED", denied.error());
        assertFalse(denied.access().any());

        access("PUTONLY", na, na, 0, CMQC.MQRC_OBJECT_IN_USE, null);
        MqOps.QueueInfo putOnly = MqOps.probe(qm, "PUTONLY");
        assertNull(putOnly.error());
        assertEquals(new MqOps.Access(false, false, true, true), putOnly.access());
        assertEquals("Unknown", putOnly.type());

        MQQueue local = mock(MQQueue.class);
        when(local.getQueueType()).thenReturn(CMQC.MQQT_LOCAL);
        when(local.getCurrentDepth()).thenReturn(4);
        when(local.getMaximumDepth()).thenReturn(100);
        when(local.getOpenInputCount()).thenReturn(1);
        when(local.getOpenOutputCount()).thenReturn(0);
        when(local.getInhibitGet()).thenReturn(CMQC.MQQA_GET_ALLOWED);
        when(local.getInhibitPut()).thenReturn(CMQC.MQQA_PUT_INHIBITED);
        when(local.getAttributeString(eq(CMQC.MQCA_Q_DESC), anyInt())).thenReturn("Orders   ");
        access("LOCAL", 0, 0, 0, 0, local);
        assertEquals(new MqOps.QueueInfo("LOCAL", "Local", 4, 100, 1, 0, null, "Orders", false, true,
                new MqOps.Access(true, true, true, true), null), MqOps.probe(qm, "LOCAL"));
        verify(local, times(2)).close(); // once by the access probe, once after reading attributes

        MQQueue alias = mock(MQQueue.class);
        when(alias.getQueueType()).thenReturn(CMQC.MQQT_ALIAS);
        when(alias.getInhibitGet()).thenReturn(CMQC.MQQA_GET_INHIBITED);
        when(alias.getAttributeString(eq(CMQC.MQCA_BASE_OBJECT_NAME), anyInt())).thenReturn("LOCAL  ");
        when(alias.getAttributeString(eq(CMQC.MQCA_Q_DESC), anyInt())).thenThrow(mqe(CMQC.MQRC_SELECTOR_ERROR));
        access("ALIAS", 0, 0, 0, na, alias);
        MqOps.QueueInfo a = MqOps.probe(qm, "ALIAS");
        assertEquals("Alias", a.type());
        assertEquals("LOCAL", a.target());
        assertNull(a.description());
        assertNull(a.depth());
        assertTrue(a.getInhibited());

        MQQueue remote = mock(MQQueue.class);
        when(remote.getQueueType()).thenReturn(CMQC.MQQT_REMOTE);
        when(remote.getAttributeString(anyInt(), anyInt())).thenReturn(" ");
        when(remote.getInhibitGet()).thenReturn(CMQC.MQQA_GET_INHIBITED);
        when(remote.getAttributeString(eq(CMQC.MQCA_REMOTE_Q_NAME), anyInt())).thenReturn("IN ");
        when(remote.getAttributeString(eq(CMQC.MQCA_REMOTE_Q_MGR_NAME), anyInt())).thenReturn("QM2 ");
        access("REMOTE", 0, na, 0, na, remote);
        MqOps.QueueInfo r = MqOps.probe(qm, "REMOTE");
        assertEquals("IN @ QM2", r.target());
        assertFalse(r.getInhibited());

        when(remote.getAttributeString(eq(CMQC.MQCA_REMOTE_Q_MGR_NAME), anyInt())).thenReturn("  ");
        assertEquals("IN", MqOps.probe(qm, "REMOTE").target());
        when(remote.getAttributeString(eq(CMQC.MQCA_REMOTE_Q_MGR_NAME), anyInt())).thenThrow(mqe(CMQC.MQRC_SELECTOR_ERROR));
        when(remote.getAttributeString(eq(CMQC.MQCA_REMOTE_Q_NAME), anyInt())).thenThrow(mqe(CMQC.MQRC_SELECTOR_ERROR));
        assertEquals("", MqOps.probe(qm, "REMOTE").target());

        MQQueue model = mock(MQQueue.class);
        when(model.getQueueType()).thenReturn(CMQC.MQQT_MODEL);
        when(model.getAttributeString(anyInt(), anyInt())).thenReturn(" ");
        access("MODEL", 0, 0, 0, 0, model);
        assertEquals("Model", MqOps.probe(qm, "MODEL").type());

        MQQueue broken = mock(MQQueue.class);
        when(broken.getQueueType()).thenThrow(mqe(CMQC.MQRC_CONNECTION_BROKEN));
        access("BROKEN", 0, 0, 0, 0, broken);
        MqOps.QueueInfo b = MqOps.probe(qm, "BROKEN");
        assertEquals("Unknown", b.type());
        assertTrue(b.access().inquire());
    }

    @Test
    void probeWhenTheAttributeOpenFails() throws Exception {
        // The probing open works, the second MQOPEN for attributes does not.
        MQQueue q = mock(MQQueue.class);
        when(qm.accessQueue(eq("FLAKY"), anyInt())).thenReturn(q, q, q, q).thenThrow(mqe(CMQC.MQRC_CONNECTION_BROKEN));
        assertEquals("Unknown", MqOps.probe(qm, "FLAKY").type());
    }

    // ── browse / detail ─────────────────────────────────────────────────────

    @Test
    void browsePagesThroughMessages() throws Exception {
        MQQueue bq = mock(MQQueue.class);
        MQQueue iq = mock(MQQueue.class);
        when(qm.accessQueue("Q", BROWSE)).thenReturn(bq);
        when(qm.accessQueue("Q", INQ)).thenReturn(iq);
        when(iq.getCurrentDepth()).thenReturn(4);
        when(iq.getMaximumDepth()).thenReturn(5000);
        doAnswer(gets("{\"a\":1}", "<x/>", "plain text", "fourth")).when(bq).get(any(), any());

        MqOps.BrowseResult r = (MqOps.BrowseResult) call("browse", "connId", "c1", "queue", "Q", "offset", 1, "limit", 2);
        assertEquals(4, r.depth());
        assertEquals(5000, r.maxDepth());
        assertTrue(r.more());
        assertEquals(List.of(2, 3), r.messages().stream().map(MqOps.Message::seq).toList());
        assertEquals(List.of("xml", "text"), r.messages().stream().map(MqOps.Message::kind).toList());
        verify(bq).close();
        verify(iq).close();

        ArgumentCaptor<MQGetMessageOptions> gmo = ArgumentCaptor.forClass(MQGetMessageOptions.class);
        verify(bq, atLeastOnce()).get(any(), gmo.capture());
        assertTrue((gmo.getAllValues().get(gmo.getAllValues().size() - 1).options & CMQC.MQGMO_BROWSE_NEXT) != 0);
    }

    @Test
    void browseWithoutInquireAuthorityAndToTheEnd() throws Exception {
        MQQueue bq = mock(MQQueue.class);
        when(qm.accessQueue("Q", BROWSE)).thenReturn(bq);
        when(qm.accessQueue("Q", INQ)).thenThrow(mqe(CMQC.MQRC_NOT_AUTHORIZED));
        doAnswer(gets("one")).when(bq).get(any(), any());

        MqOps.BrowseResult r = (MqOps.BrowseResult) call("browse", "connId", "c1", "queue", "Q", "limit", 0);
        assertEquals(-1, r.depth());
        assertFalse(r.more());
        assertEquals(1, r.messages().size());
        assertEquals("one", r.messages().get(0).text());
    }

    @Test
    void browseErrorsOtherThanEndOfQueueFail() throws Exception {
        MQQueue bq = mock(MQQueue.class);
        when(qm.accessQueue(eq("Q"), anyInt())).thenReturn(bq);
        doThrow(mqe(CMQC.MQRC_GET_INHIBITED)).when(bq).get(any(), any());
        MQException e = assertThrows(MQException.class, () -> call("browse", "connId", "c1", "queue", "Q"));
        assertEquals(CMQC.MQRC_GET_INHIBITED, e.reasonCode);
        verify(bq, times(2)).close();
    }

    @Test
    void detailMatchesByMsgId() throws Exception {
        MQQueue q = mock(MQQueue.class);
        when(qm.accessQueue("Q", BROWSE)).thenReturn(q);
        String id = "414D5120514D3120202020202020202094A1C26A0F290040";
        doAnswer(inv -> {
            MQMessage m = inv.getArgument(0);
            MQGetMessageOptions gmo = inv.getArgument(1);
            assertEquals(id, Payloads.hex(m.messageId));
            assertEquals(CMQC.MQMO_MATCH_MSG_ID, gmo.matchOptions);
            fill(m, "full body", x -> { });
            return null;
        }).when(q).get(any(), any());

        MqOps.Message m = (MqOps.Message) call("detail", "connId", "c1", "queue", "Q", "msgId", id);
        assertEquals(0, m.seq());
        assertEquals("full body", m.text());
        verify(q).close();
    }

    @Test
    void toMessageHandlesLargeBinaryAndBareMessages() throws Exception {
        MQMessage big = new MQMessage();
        fill(big, "x".repeat(70_000), x -> { });
        MqOps.Message m = MqOps.toMessage(big, 1, 64 * 1024);
        assertTrue(m.truncated());
        assertEquals(64 * 1024, m.text().length());
        assertEquals(64 * 1024, Base64.getDecoder().decode(m.base64()).length);
        assertEquals(240, m.preview().length());

        MQMessage bin = new MQMessage();
        bin.characterSet = 1208;
        bin.format = null;
        bin.write(new byte[]{0, 0, 0, (byte) 0xFF, (byte) 0xFE});
        bin.seek(0);
        MqOps.Message b = MqOps.toMessage(bin, 1, 100);
        assertEquals("binary", b.kind());
        assertNull(b.text());
        assertNull(b.preview());
        assertEquals("", b.format());
        assertNull(b.putTime());

        MQMessage ctl = new MQMessage();
        ctl.characterSet = 819;
        ctl.write(new byte[]{0, 0, 0, 0, 65});
        ctl.seek(0);
        MqOps.Message c = MqOps.toMessage(ctl, 1, 100);
        assertEquals("binary", c.kind());
        assertNull(c.preview());

        MQMessage cut = new MQMessage();
        cut.characterSet = 1200;
        cut.write("héllo".getBytes(StandardCharsets.UTF_16BE));
        cut.seek(0);
        assertEquals("hé", MqOps.toMessage(cut, 1, 4).text().substring(0, 2));
    }

    @Test
    void mqmdDescribesEveryField() throws Exception {
        MQMessage m = new MQMessage();
        m.report = CMQC.MQRO_COA | CMQC.MQRO_PASS_MSG_ID;
        m.messageType = CMQC.MQMT_REQUEST;
        m.expiry = 600;
        m.feedback = CMQC.MQFB_EXPIRATION;
        m.encoding = CMQC.MQENC_INTEGER_REVERSED;
        m.characterSet = 1208;
        m.format = "        ";
        m.persistence = CMQC.MQPER_PERSISTENT;
        m.correlationId = Payloads.idBytes("ORDER-1");
        m.groupId = Payloads.idBytes("G1");
        m.messageFlags = CMQC.MQMF_LAST_MSG_IN_GROUP;
        m.originalLength = 10;
        m.replyToQueueName = "REPLY  ";
        GregorianCalendar put = new GregorianCalendar(TimeZone.getTimeZone("UTC"));
        put.setTimeInMillis(1_791_000_000_120L);
        m.putDateTime = put;

        Map<String, MqOps.MqmdField> f = MqOps.mqmd(m).stream().collect(Collectors.toMap(MqOps.MqmdField::k, x -> x));
        assertEquals(29, f.size());
        assertEquals("MQRO_COA + MQRO_PASS_MSG_ID", f.get("Report").dec());
        assertEquals(String.format("0x%08X", m.report), f.get("Report").v());
        assertEquals("MQMT_REQUEST", f.get("MsgType").dec());
        assertEquals("60.0 s", f.get("Expiry").dec());
        assertEquals("MQFB_EXPIRATION", f.get("Feedback").dec());
        assertEquals("little-endian integers", f.get("Encoding").dec());
        assertEquals("MQFMT_NONE", f.get("Format").dec());
        assertEquals("MQPER_PERSISTENT", f.get("Persistence").dec());
        assertEquals("", f.get("CorrelId").dec());
        assertEquals("", f.get("GroupId").dec());
        assertEquals("", f.get("MsgFlags").dec());
        assertEquals("", f.get("OriginalLength").dec());
        assertEquals("REPLY", f.get("ReplyToQ").v());
        assertEquals("20261003", f.get("PutDate").v());
        assertEquals(8, f.get("PutTime").v().length());

        MQMessage plain = new MQMessage();
        plain.format = null;
        plain.encoding = CMQC.MQENC_INTEGER_NORMAL;
        Map<String, MqOps.MqmdField> p = MqOps.mqmd(plain).stream().collect(Collectors.toMap(MqOps.MqmdField::k, x -> x));
        assertEquals("MQRO_NONE", p.get("Report").dec());
        assertEquals("MQEI_UNLIMITED", p.get("Expiry").dec());
        assertEquals("MQFB_NONE", p.get("Feedback").dec());
        assertEquals("big-endian integers", p.get("Encoding").dec());
        assertEquals("MQFMT_NONE", p.get("Format").dec());
        assertEquals("MQCI_NONE", p.get("CorrelId").dec());
        assertEquals("MQGI_NONE", p.get("GroupId").dec());
        assertEquals("MQMF_NONE", p.get("MsgFlags").dec());
        assertEquals("MQOL_UNDEFINED", p.get("OriginalLength").dec());
        assertEquals("", p.get("PutDate").v());

        plain.encoding = 0;
        plain.persistence = 99;
        Map<String, MqOps.MqmdField> z = MqOps.mqmd(plain).stream().collect(Collectors.toMap(MqOps.MqmdField::k, x -> x));
        assertEquals("", z.get("Encoding").dec());
        assertEquals("", z.get("Persistence").dec());
    }

    @Test
    void propertiesOfEveryType() throws Exception {
        MQMessage m = new MQMessage();
        m.setStringProperty("s", "text");
        m.setIntProperty("i", 1);
        m.setLongProperty("l", 2L);
        m.setShortProperty("sh", (short) 3);
        m.setByteProperty("b", (byte) 4);
        m.setBooleanProperty("bo", true);
        m.setFloatProperty("f", 1.5f);
        m.setDoubleProperty("d", 2.5);
        m.setBytesProperty("by", new byte[]{1, (byte) 0xAB});
        Map<String, MqOps.Prop> p = MqOps.props(m).stream().collect(Collectors.toMap(MqOps.Prop::k, x -> x));
        assertEquals(new MqOps.Prop("s", "String", "text"), p.get("s"));
        assertEquals("Int32", p.get("i").t());
        assertEquals("Int64", p.get("l").t());
        assertEquals("Int16", p.get("sh").t());
        assertEquals("Int8", p.get("b").t());
        assertEquals("Boolean", p.get("bo").t());
        assertEquals("Float32", p.get("f").t());
        assertEquals("Float64", p.get("d").t());
        assertEquals(new MqOps.Prop("by", "Bytes", "01AB"), p.get("by"));

        MQMessage odd = mock(MQMessage.class);
        when(odd.getPropertyNames("%")).thenReturn(Collections.enumeration(List.of("n", "c")));
        when(odd.getObjectProperty("n")).thenReturn(null);
        when(odd.getObjectProperty("c")).thenReturn('x');
        assertEquals(List.of(new MqOps.Prop("n", "Null", "null"), new MqOps.Prop("c", "Character", "x")), MqOps.props(odd));

        MQMessage none = mock(MQMessage.class);
        when(none.getPropertyNames("%")).thenThrow(mqe(CMQC.MQRC_PROPERTY_NOT_AVAILABLE));
        assertTrue(MqOps.props(none).isEmpty());
    }

    // ── put ─────────────────────────────────────────────────────────────────

    private ArgumentCaptor<MQMessage> putCaptor(MQQueue q) throws Exception {
        ArgumentCaptor<MQMessage> c = ArgumentCaptor.forClass(MQMessage.class);
        doAnswer(inv -> {
            MQMessage m = inv.getArgument(0);
            MQPutMessageOptions pmo = inv.getArgument(1);
            if ((pmo.options & CMQC.MQPMO_NEW_MSG_ID) != 0) {
                m.messageId = Payloads.idBytes("NEW");
            }
            return null;
        }).when(q).put(c.capture(), any());
        return c;
    }

    @Test
    void putsCopiesWithMqmdAndProperties() throws Exception {
        MQQueue q = mock(MQQueue.class);
        when(qm.accessQueue("Q", CMQC.MQOO_OUTPUT | CMQC.MQOO_FAIL_IF_QUIESCING)).thenReturn(q);
        ArgumentCaptor<MQMessage> sent = putCaptor(q);

        JsonNode p = JSON.readTree("""
                {"connId":"c1","queue":"Q","body":"héllo","count":2,
                 "mqmd":{"format":"MQSTR","ccsid":1208,"priority":7,"persistence":"P","expiry":300,
                         "replyToQ":"REPLY","replyToQmgr":"QM2","correlId":"ORDER-1","msgId":"ID-1"},
                 "properties":[
                   {"name":"s","value":"v"},{"name":"i","type":"Int32","value":" 1 "},{"name":"l","type":"Int64","value":"2"},
                   {"name":"sh","type":"Int16","value":"3"},{"name":"b","type":"Int8","value":"4"},
                   {"name":"bo","type":"Boolean","value":"true"},{"name":"f","type":"Float32","value":"1.5"},
                   {"name":"d","type":"Float64","value":"2.5"},{"name":"by","type":"Bytes","value":"01ab"},
                   {"name":"nv","type":"String"},{"name":" ","value":"skip"},{"value":"no name"}]}""");
        MqOps.PutResult r = (MqOps.PutResult) ops.dispatch("put", p);

        assertEquals(2, r.count());
        assertEquals(2, sent.getAllValues().size());
        MQMessage m = sent.getValue();
        assertEquals("héllo", body(m));
        assertEquals("MQSTR   ", m.format);
        assertEquals(7, m.priority);
        assertEquals(CMQC.MQPER_PERSISTENT, m.persistence);
        assertEquals(300, m.expiry);
        assertEquals("REPLY", m.replyToQueueName);
        assertEquals("QM2", m.replyToQueueManagerName);
        assertEquals(CMQC.MQMT_REQUEST, m.messageType);
        assertArrayEquals(Payloads.idBytes("ORDER-1"), m.correlationId);
        assertEquals(Payloads.hex(Payloads.idBytes("ID-1")), r.msgIds().get(0));
        assertEquals(1, m.getIntProperty("i"));
        assertEquals(2L, m.getLongProperty("l"));
        assertEquals((short) 3, m.getShortProperty("sh"));
        assertEquals((byte) 4, m.getByteProperty("b"));
        assertTrue(m.getBooleanProperty("bo"));
        assertEquals(1.5f, m.getFloatProperty("f"));
        assertEquals(2.5, m.getDoubleProperty("d"));
        assertArrayEquals(new byte[]{1, (byte) 0xAB}, m.getBytesProperty("by"));
        assertEquals("", m.getStringProperty("nv"));
        assertEquals("v", m.getStringProperty("s"));
        verify(q).close();
    }

    @Test
    void putDefaultsBase64AndRenderedBodies() throws Exception {
        MQQueue q = mock(MQQueue.class);
        when(qm.accessQueue(eq("Q"), anyInt())).thenReturn(q);
        ArgumentCaptor<MQMessage> sent = putCaptor(q);

        MqOps.PutResult a = (MqOps.PutResult) ops.dispatch("put", JSON.readTree(
                "{\"connId\":\"c1\",\"queue\":\"Q\",\"bodyBase64\":\"AAEC\",\"count\":0,\"mqmd\":{\"persistence\":\"NP\"}}"));
        assertEquals(1, a.count());
        assertEquals(Payloads.hex(Payloads.idBytes("NEW")), a.msgIds().get(0));
        MQMessage m = sent.getValue();
        m.seek(0);
        byte[] raw = new byte[m.getDataLength()];
        m.readFully(raw);
        assertArrayEquals(new byte[]{0, 1, 2}, raw);
        assertEquals(CMQC.MQPER_NOT_PERSISTENT, m.persistence);
        assertEquals(CMQC.MQEI_UNLIMITED, m.expiry);
        assertEquals(CMQC.MQPRI_PRIORITY_AS_Q_DEF, m.priority);
        assertEquals(CMQC.MQMT_DATAGRAM, m.messageType);

        MqOps.PutResult b = (MqOps.PutResult) ops.dispatch("put", JSON.readTree(
                "{\"connId\":\"c1\",\"queue\":\"Q\",\"bodies\":[\"one\",\"two\"],\"count\":5,\"mqmd\":{\"replyToQ\":\" \"}}"));
        assertEquals(2, b.count());
        List<MQMessage> all = sent.getAllValues();
        assertEquals("one", body(all.get(1)));
        assertEquals("two", body(all.get(2)));
        assertEquals(CMQC.MQPER_PERSISTENCE_AS_Q_DEF, all.get(2).persistence);
        assertEquals("", all.get(2).replyToQueueName.trim());

        MqOps.PutResult big = (MqOps.PutResult) ops.dispatch("put", JSON.readTree(
                "{\"connId\":\"c1\",\"queue\":\"Q\",\"count\":99999}"));
        assertEquals(10_000, big.count());

        ArrayNode many = JSON.createArrayNode();
        for (int i = 0; i < 10_001; i++) {
            many.add("m" + i);
        }
        ObjectNode p = params("connId", "c1", "queue", "Q");
        p.set("bodies", many);
        assertEquals(10_000, ((MqOps.PutResult) ops.dispatch("put", p)).count());
    }

    @Test
    void putClosesTheQueueOnFailure() throws Exception {
        MQQueue q = mock(MQQueue.class);
        when(qm.accessQueue(eq("Q"), anyInt())).thenReturn(q);
        doThrow(mqe(CMQC.MQRC_Q_FULL)).when(q).put(any(), any());
        assertThrows(MQException.class, () -> call("put", "connId", "c1", "queue", "Q", "body", "x"));
        verify(q).close();
    }

    // ── delete / purge ──────────────────────────────────────────────────────

    @Test
    void deletesByMsgIdAndNeverWithANullId() throws Exception {
        MQQueue q = mock(MQQueue.class);
        when(qm.accessQueue(eq("Q"), anyInt())).thenReturn(q);
        when(q.getCurrentDepth()).thenReturn(7);
        String found = Payloads.hex(Payloads.idBytes("FOUND"));
        String gone = Payloads.hex(Payloads.idBytes("GONE"));
        String zero = "00".repeat(24);
        doAnswer(inv -> {
            MQMessage m = inv.getArgument(0);
            if (Payloads.hex(m.messageId).equals(gone)) {
                throw mqe(CMQC.MQRC_NO_MSG_AVAILABLE);
            }
            return null;
        }).when(q).get(any(), any());

        MqOps.DeleteResult r = (MqOps.DeleteResult) call("delete", "connId", "c1", "queue", "Q", "msgIds", List.of(found, gone, zero));
        assertEquals(new MqOps.DeleteResult(1, List.of(gone, zero), 7), r);
        verify(qm).commit();
        verify(q, times(2)).get(any(), any());
    }

    @Test
    void deleteBacksOutOnOtherErrors() throws Exception {
        MQQueue q = mock(MQQueue.class);
        when(qm.accessQueue(eq("Q"), anyInt())).thenReturn(q);
        doThrow(mqe(CMQC.MQRC_GET_INHIBITED)).when(q).get(any(), any());
        assertThrows(MQException.class, () -> call("delete", "connId", "c1", "queue", "Q", "msgIds", List.of("0A")));
        verify(qm).backout();
        verify(qm, never()).commit();
        verify(q).close();
    }

    @Test
    void purgeClearsThroughPcf() throws Exception {
        MQQueue iq = mock(MQQueue.class);
        when(qm.accessQueue("Q", INQ)).thenReturn(iq);
        when(iq.getCurrentDepth()).thenReturn(12);
        assertEquals(new MqOps.PurgeResult(12, "CLEAR QLOCAL"), call("purge", "connId", "c1", "queue", "Q"));
        ArgumentCaptor<PCFMessage> req = ArgumentCaptor.forClass(PCFMessage.class);
        verify(pcf).send(req.capture());
        assertEquals(MQConstants.MQCMD_CLEAR_Q, req.getValue().getCommand());
        verify(iq).close();
    }

    @Test
    void purgeDrainsWhenClearIsNotAllowed() throws Exception {
        when(qm.accessQueue("Q", INQ)).thenThrow(mqe(CMQC.MQRC_NOT_AUTHORIZED));
        when(pcf.send(any())).thenThrow(new PCFException(2, CMQC.MQRC_OBJECT_IN_USE, "x"));
        MQQueue q = mock(MQQueue.class);
        when(qm.accessQueue("Q", CMQC.MQOO_INPUT_AS_Q_DEF | CMQC.MQOO_FAIL_IF_QUIESCING)).thenReturn(q);
        int[] left = {501};
        doAnswer(inv -> {
            if (left[0]-- == 0) {
                throw mqe(CMQC.MQRC_NO_MSG_AVAILABLE);
            }
            return null;
        }).when(q).get(any(), any());

        assertEquals(new MqOps.PurgeResult(501, "destructive get"), call("purge", "connId", "c1", "queue", "Q"));
        verify(qm, times(2)).commit();
        verify(q).close();
    }

    @Test
    void purgeWithoutPcfCommitsWhatItGotBeforeFailing() throws Exception {
        h.pcf = null;
        MQQueue q = mock(MQQueue.class);
        when(qm.accessQueue(eq("Q"), anyInt())).thenReturn(q);
        when(q.getCurrentDepth()).thenReturn(1);
        doAnswer(inv -> null).doThrow(mqe(CMQC.MQRC_CONNECTION_BROKEN)).when(q).get(any(), any());
        assertThrows(MQException.class, () -> call("purge", "connId", "c1", "queue", "Q"));
        verify(qm).commit();
        verify(q, times(2)).close();
    }
}
