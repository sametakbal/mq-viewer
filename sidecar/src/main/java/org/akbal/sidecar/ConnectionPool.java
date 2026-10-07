package org.akbal.sidecar;

import com.ibm.mq.MQException;
import com.ibm.mq.MQQueueManager;
import com.ibm.mq.constants.CMQC;
import com.ibm.mq.headers.pcf.PCFMessageAgent;

import java.util.Hashtable;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;

/**
 * One open queue manager handle per saved connection. MQQueueManager is not safe for
 * concurrent use, so every operation on a connection runs under that connection's lock.
 */
public final class ConnectionPool {

    /** Reason codes after which the handle is unusable and a fresh connect is worth one retry. */
    private static final Set<Integer> BROKEN = Set.of(
            CMQC.MQRC_CONNECTION_BROKEN, CMQC.MQRC_Q_MGR_NOT_AVAILABLE, CMQC.MQRC_HCONN_ERROR,
            CMQC.MQRC_Q_MGR_QUIESCING, CMQC.MQRC_Q_MGR_STOPPING, CMQC.MQRC_CONNECTION_QUIESCING,
            CMQC.MQRC_CONNECTION_STOPPING, CMQC.MQRC_RECONNECT_FAILED);

    public static final class Handle {
        final Config config;
        final ReentrantLock lock = new ReentrantLock();
        MQQueueManager qmgr;
        PCFMessageAgent pcf;
        TlsFactory.Session tls;

        Handle(Config config) {
            this.config = config;
        }
    }

    public interface Op<T> {
        T run(Handle h) throws Exception;
    }

    /** Opens a queue manager connection; tests swap it to simulate connect failures. */
    interface Connector {
        MQQueueManager open(String qmgr, Hashtable<String, Object> props) throws MQException;
    }

    static Connector connector = MQQueueManager::new;

    private final Map<String, Handle> handles = new ConcurrentHashMap<>();

    /** Opens a new handle for the config, replacing any previous one. */
    public Handle connect(Config config) throws Exception {
        Handle h = new Handle(config);
        open(h);
        Handle old = handles.put(config.id(), h);
        if (old != null) {
            close(old);
        }
        return h;
    }

    /** Opens and immediately returns a handle that is not kept in the pool (used by "test connection"). */
    public Handle openDetached(Config config) throws Exception {
        Handle h = new Handle(config);
        open(h);
        return h;
    }

    public void disconnect(String id) {
        Handle h = handles.remove(id);
        if (h != null) {
            h.lock.lock();
            try {
                close(h);
            } finally {
                h.lock.unlock();
            }
        }
    }

    public <T> T with(String id, Op<T> op) throws Exception {
        Handle h = handles.get(id);
        if (h == null) {
            throw new Errors.OpException(new Errors.MqError(CMQC.MQRC_HCONN_ERROR, "MQRC_HCONN_ERROR", 2,
                    "Not connected — connect first", null, null), null);
        }
        h.lock.lock();
        try {
            if (h.qmgr == null || !h.qmgr.isConnected()) {
                reopen(h);
            }
            try {
                return op.run(h);
            } catch (MQException e) {
                if (!BROKEN.contains(e.reasonCode)) {
                    throw e;
                }
                reopen(h);
                return op.run(h);
            }
        } finally {
            h.lock.unlock();
        }
    }

    public void closeAll() {
        handles.values().forEach(ConnectionPool::close);
        handles.clear();
    }

    private static void reopen(Handle h) throws Exception {
        close(h);
        open(h);
    }

    static void open(Handle h) throws Exception {
        Config c = h.config;
        Hashtable<String, Object> props = new Hashtable<>();
        props.put(CMQC.HOST_NAME_PROPERTY, c.host());
        props.put(CMQC.PORT_PROPERTY, c.port());
        props.put(CMQC.CHANNEL_PROPERTY, c.channel());
        props.put(CMQC.TRANSPORT_PROPERTY, CMQC.TRANSPORT_MQSERIES_CLIENT);
        props.put(CMQC.APPNAME_PROPERTY, "mq-viewer");
        if (c.user() != null && !c.user().isBlank()) {
            props.put(CMQC.USER_ID_PROPERTY, c.user());
            props.put(CMQC.PASSWORD_PROPERTY, c.password() == null ? "" : c.password());
            props.put(CMQC.USE_MQCSP_AUTHENTICATION_PROPERTY, true);
        }

        TlsFactory.Session session = null;
        if (c.tlsEnabled()) {
            session = new TlsFactory.Session();
            String cipher = c.tls().cipher();
            props.put(CMQC.SSL_CIPHER_SUITE_PROPERTY, cipher == null || cipher.isBlank() ? "*TLS13ORHIGHER" : cipher);
            props.put(CMQC.SSL_SOCKET_FACTORY_PROPERTY, TlsFactory.create(c.tls(), session));
            if (c.tls().peerName() != null && !c.tls().peerName().isBlank()) {
                props.put(CMQC.SSL_PEER_NAME_PROPERTY, c.tls().peerName());
            }
        }
        h.tls = session;

        try {
            h.qmgr = connector.open(c.qmgr() == null ? "" : c.qmgr(), props);
        } catch (MQException e) {
            if (session != null && !session.serverChain.isEmpty()) {
                Errors.MqError base = Errors.toError(e);
                throw new Errors.OpException(new Errors.MqError(base.code(), base.name(), base.cc(), base.message(),
                        base.detail(), TlsFactory.describe(session)), e);
            }
            throw e;
        }
        try {
            h.pcf = new PCFMessageAgent(h.qmgr);
        } catch (Exception e) {
            // PCF needs access to SYSTEM.ADMIN.COMMAND.QUEUE; browsing still works without it.
            h.pcf = null;
        }
    }

    static void close(Handle h) {
        if (h.pcf != null) {
            try {
                h.pcf.disconnect();
            } catch (Exception ignored) {
            }
            h.pcf = null;
        }
        if (h.qmgr != null) {
            try {
                h.qmgr.disconnect();
            } catch (Exception ignored) {
            }
            h.qmgr = null;
        }
    }
}
