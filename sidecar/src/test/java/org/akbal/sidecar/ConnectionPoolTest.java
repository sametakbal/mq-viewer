package org.akbal.sidecar;

import com.ibm.mq.MQException;
import com.ibm.mq.MQQueueManager;
import com.ibm.mq.constants.CMQC;
import com.ibm.mq.headers.pcf.PCFMessageAgent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.MockedConstruction;
import org.mockito.MockedStatic;

import javax.net.ssl.SSLSocketFactory;
import java.security.cert.X509Certificate;
import java.util.Hashtable;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockConstruction;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ConnectionPoolTest {

    @AfterEach
    void restoreConnector() {
        ConnectionPool.connector = MQQueueManager::new;
    }

    private static Config cfg(String user, String password, Config.Tls tls) {
        return new Config("c1", "mq1", 1414, "DEV.APP.SVRCONN", "QM1", user, password, tls);
    }

    private static MQException mqe(int reason) {
        return new MQException(CMQC.MQCC_FAILED, reason, "test");
    }

    /** Connection properties passed to each MQQueueManager constructed under {@link #qmgrs()}. */
    private static final List<Hashtable<String, Object>> lastProps = new java.util.ArrayList<>();

    private static Hashtable<String, Object> props(MockedConstruction<MQQueueManager> qms, int i) {
        assertTrue(qms.constructed().size() > i);
        return lastProps.get(i);
    }

    @SuppressWarnings("unchecked")
    private static MockedConstruction<MQQueueManager> qmgrs() {
        lastProps.clear();
        return mockConstruction(MQQueueManager.class, (mock, ctx) -> {
            lastProps.add((Hashtable<String, Object>) ctx.arguments().get(1));
            when(mock.isConnected()).thenReturn(true);
        });
    }

    @Test
    void connectPassesClientPropertiesAndCredentials() throws Exception {
        try (MockedConstruction<MQQueueManager> qms = qmgrs();
             MockedConstruction<PCFMessageAgent> pcfs = mockConstruction(PCFMessageAgent.class)) {
            ConnectionPool pool = new ConnectionPool();
            ConnectionPool.Handle h = pool.connect(cfg("app", null, null));
            Hashtable<String, Object> p = props(qms, 0);
            assertEquals("mq1", p.get(CMQC.HOST_NAME_PROPERTY));
            assertEquals(1414, p.get(CMQC.PORT_PROPERTY));
            assertEquals("DEV.APP.SVRCONN", p.get(CMQC.CHANNEL_PROPERTY));
            assertEquals("app", p.get(CMQC.USER_ID_PROPERTY));
            assertEquals("", p.get(CMQC.PASSWORD_PROPERTY));
            assertEquals(true, p.get(CMQC.USE_MQCSP_AUTHENTICATION_PROPERTY));
            assertSame(qms.constructed().get(0), h.qmgr);
            assertSame(pcfs.constructed().get(0), h.pcf);
            assertNull(h.tls);

            pool.connect(new Config("c2", "mq1", 1414, "CH", null, " ", "x", null));
            assertFalse(props(qms, 1).containsKey(CMQC.USER_ID_PROPERTY));
            pool.connect(cfg("app", "secret", null));
            assertEquals("secret", props(qms, 2).get(CMQC.PASSWORD_PROPERTY));
            // The handle it replaced is closed.
            verify(qms.constructed().get(0)).disconnect();
            assertNull(h.qmgr);
            verify(pcfs.constructed().get(0)).disconnect();
        }
    }

    @Test
    void tlsSettingsGoToTheClient() throws Exception {
        SSLSocketFactory factory = mock(SSLSocketFactory.class);
        try (MockedConstruction<MQQueueManager> qms = qmgrs();
             MockedConstruction<PCFMessageAgent> ignored = mockConstruction(PCFMessageAgent.class);
             MockedStatic<TlsFactory> tls = mockStatic(TlsFactory.class)) {
            tls.when(() -> TlsFactory.create(any(), any())).thenReturn(factory);
            ConnectionPool pool = new ConnectionPool();

            Config.Tls blank = new Config.Tls(true, " ", null, null, null, null, null, null);
            ConnectionPool.Handle h = pool.connect(cfg(null, null, blank));
            assertEquals("*TLS13ORHIGHER", props(qms, 0).get(CMQC.SSL_CIPHER_SUITE_PROPERTY));
            assertSame(factory, props(qms, 0).get(CMQC.SSL_SOCKET_FACTORY_PROPERTY));
            assertFalse(props(qms, 0).containsKey(CMQC.SSL_PEER_NAME_PROPERTY));
            assertNotNull(h.tls);

            Config.Tls full = new Config.Tls(true, "TLS_AES_128_GCM_SHA256", null, null, null, null, null, "CN=QM1");
            pool.connect(cfg(null, null, full));
            assertEquals("TLS_AES_128_GCM_SHA256", props(qms, 1).get(CMQC.SSL_CIPHER_SUITE_PROPERTY));
            assertEquals("CN=QM1", props(qms, 1).get(CMQC.SSL_PEER_NAME_PROPERTY));

            pool.connect(cfg(null, null, new Config.Tls(true, null, null, null, null, null, null, " ")));
            assertEquals("*TLS13ORHIGHER", props(qms, 2).get(CMQC.SSL_CIPHER_SUITE_PROPERTY));
            assertFalse(props(qms, 2).containsKey(CMQC.SSL_PEER_NAME_PROPERTY));
        }
    }

    @Test
    void failedTlsHandshakeReportsTheServerChain() {
        X509Certificate cert = mock(X509Certificate.class);
        List<Errors.CertInfo> described = List.of(new Errors.CertInfo("Server", "CN=qm", "CN=ca", "Received"));
        ConnectionPool.connector = (name, props) -> {
            throw mqe(CMQC.MQRC_SSL_INITIALIZATION_ERROR);
        };
        try (MockedStatic<TlsFactory> tls = mockStatic(TlsFactory.class)) {
            tls.when(() -> TlsFactory.create(any(), any())).thenAnswer(inv -> {
                TlsFactory.Session s = inv.getArgument(1);
                s.serverChain = List.of(cert);
                return mock(SSLSocketFactory.class);
            });
            tls.when(() -> TlsFactory.describe(any())).thenReturn(described);

            Config.Tls on = new Config.Tls(true, null, null, null, null, null, null, null);
            Errors.OpException e = assertThrows(Errors.OpException.class, () -> new ConnectionPool().connect(cfg(null, null, on)));
            assertEquals(CMQC.MQRC_SSL_INITIALIZATION_ERROR, e.error.code());
            assertEquals(described, e.error.tlsChain());
        }
    }

    @Test
    void connectFailuresWithoutAChainAreRethrown() {
        ConnectionPool.connector = (name, props) -> {
            throw mqe(CMQC.MQRC_HOST_NOT_AVAILABLE);
        };
        try (MockedStatic<TlsFactory> tls = mockStatic(TlsFactory.class)) {
            tls.when(() -> TlsFactory.create(any(), any())).thenReturn(mock(SSLSocketFactory.class));
            MQException plain = assertThrows(MQException.class, () -> new ConnectionPool().connect(cfg(null, null, null)));
            assertEquals(CMQC.MQRC_HOST_NOT_AVAILABLE, plain.reasonCode);
            Config.Tls on = new Config.Tls(true, null, null, null, null, null, null, null);
            MQException noChain = assertThrows(MQException.class, () -> new ConnectionPool().connect(cfg(null, null, on)));
            assertEquals(CMQC.MQRC_HOST_NOT_AVAILABLE, noChain.reasonCode);
        }
    }

    @Test
    void worksWithoutPcfAccess() throws Exception {
        try (MockedConstruction<MQQueueManager> ignored = qmgrs();
             MockedConstruction<PCFMessageAgent> pcfs = mockConstruction(PCFMessageAgent.class, (m, ctx) -> {
                 throw mqe(CMQC.MQRC_NOT_AUTHORIZED);
             })) {
            ConnectionPool.Handle h = new ConnectionPool().openDetached(cfg(null, null, null));
            assertNotNull(h.qmgr);
            assertNull(h.pcf);
        }
    }

    @Test
    void withRequiresAConnection() {
        Errors.OpException e = assertThrows(Errors.OpException.class, () -> new ConnectionPool().with("nope", h -> 1));
        assertEquals(CMQC.MQRC_HCONN_ERROR, e.error.code());
    }

    @Test
    void withReopensBrokenHandlesAndRetriesOnce() throws Exception {
        try (MockedConstruction<MQQueueManager> qms = qmgrs();
             MockedConstruction<PCFMessageAgent> ignored = mockConstruction(PCFMessageAgent.class)) {
            ConnectionPool pool = new ConnectionPool();
            pool.connect(cfg(null, null, null));
            assertEquals(1, pool.<Integer>with("c1", h -> 1));

            // A handle that dropped is reopened before the operation.
            when(qms.constructed().get(0).isConnected()).thenReturn(false);
            assertEquals(2, pool.<Integer>with("c1", h -> 2));
            assertEquals(2, qms.constructed().size());

            // A broken connection mid-operation: reopen and run again.
            AtomicInteger calls = new AtomicInteger();
            assertEquals("ok", pool.with("c1", h -> {
                if (calls.incrementAndGet() == 1) {
                    throw mqe(CMQC.MQRC_CONNECTION_BROKEN);
                }
                return "ok";
            }));
            assertEquals(3, qms.constructed().size());

            // Other MQ errors are the caller's problem.
            MQException e = assertThrows(MQException.class, () -> pool.with("c1", h -> {
                throw mqe(CMQC.MQRC_NOT_AUTHORIZED);
            }));
            assertEquals(CMQC.MQRC_NOT_AUTHORIZED, e.reasonCode);

            ConnectionPool.Handle h = pool.connect(cfg(null, null, null));
            h.qmgr = null;
            assertEquals(3, pool.<Integer>with("c1", x -> 3));
        }
    }

    @Test
    void disconnectAndCloseAllIgnoreErrors() throws Exception {
        try (MockedConstruction<MQQueueManager> qms = qmgrs();
             MockedConstruction<PCFMessageAgent> pcfs = mockConstruction(PCFMessageAgent.class, (m, ctx) ->
                     doThrow(new IllegalStateException("gone")).when(m).disconnect())) {
            ConnectionPool pool = new ConnectionPool();
            pool.disconnect("never-connected");
            pool.connect(cfg(null, null, null));
            doThrow(mqe(CMQC.MQRC_CONNECTION_BROKEN)).when(qms.constructed().get(0)).disconnect();
            pool.disconnect("c1");
            verify(qms.constructed().get(0)).disconnect();
            verify(pcfs.constructed().get(0)).disconnect();
            assertThrows(Errors.OpException.class, () -> pool.with("c1", h -> 1));

            pool.connect(cfg(null, null, null));
            pool.connect(new Config("c2", "mq1", 1414, "CH", "QM1", null, null, null));
            pool.closeAll();
            verify(qms.constructed().get(1)).disconnect();
            verify(qms.constructed().get(2)).disconnect();
            assertThrows(Errors.OpException.class, () -> pool.with("c2", h -> 1));

            ConnectionPool.Handle empty = new ConnectionPool.Handle(cfg(null, null, null));
            ConnectionPool.close(empty);
            assertTrue(empty.qmgr == null && empty.pcf == null);
        }
    }
}
