package org.akbal.sidecar;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLEngine;
import javax.net.ssl.SSLHandshakeException;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509ExtendedKeyManager;
import javax.net.ssl.X509TrustManager;
import java.io.IOException;
import java.lang.reflect.Constructor;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TlsFactoryTest {

    private static final String PW = "changeit";

    private static String res(String name) {
        try {
            return Path.of(TlsFactoryTest.class.getResource("/tls/" + name).toURI()).toString();
        } catch (URISyntaxException e) {
            throw new IllegalStateException(e);
        }
    }

    private static Config.Tls tls(String keystore, String truststore, String label) {
        return new Config.Tls(true, null, keystore, keystore == null ? null : PW, truststore, truststore == null ? null : PW, label, null);
    }

    private static X509Certificate[] chainOf(String store, String alias) throws Exception {
        Certificate[] c = TlsFactory.load(res(store), PW).getCertificateChain(alias);
        return Arrays.copyOf(c, c.length, X509Certificate[].class);
    }

    /** A one-shot TLS server presenting `serverStore`, asking for a client certificate trusted by trust.jks. */
    private static final class Server implements AutoCloseable {
        final SSLServerSocket socket;
        final CompletableFuture<String> clientDn = new CompletableFuture<>();

        Server(String serverStore) throws Exception {
            KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
            kmf.init(TlsFactory.load(res(serverStore), PW), PW.toCharArray());
            TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            tmf.init(TlsFactory.load(res("trust.jks"), PW));
            SSLContext ctx = SSLContext.getInstance("TLS");
            ctx.init(kmf.getKeyManagers(), tmf.getTrustManagers(), null);
            socket = (SSLServerSocket) ctx.getServerSocketFactory().createServerSocket(0, 1, InetAddress.getLoopbackAddress());
            socket.setWantClientAuth(true);
            Thread.ofVirtual().start(() -> {
                try (SSLSocket s = (SSLSocket) socket.accept()) {
                    s.startHandshake();
                    Certificate[] peer = s.getSession().getPeerCertificates();
                    clientDn.complete(((X509Certificate) peer[0]).getSubjectX500Principal().getName());
                    s.getInputStream().read();
                } catch (Exception e) {
                    clientDn.completeExceptionally(e);
                }
            });
        }

        int port() {
            return socket.getLocalPort();
        }

        @Override
        public void close() throws IOException {
            socket.close();
        }
    }

    private static void awaitProtocol(TlsFactory.Session s) throws InterruptedException {
        for (int i = 0; i < 100 && s.protocol == null; i++) {
            Thread.sleep(20);
        }
    }

    @Test
    void handshakeRecordsChainProtocolAndPresentsTheLabelledClientCert() throws Exception {
        for (String label : new String[]{"client", "other"}) {
            TlsFactory.Session session = new TlsFactory.Session();
            SSLSocketFactory f = TlsFactory.create(tls(res("client.p12"), res("trust.jks"), label), session);
            try (Server server = new Server("server.p12");
                 SSLSocket s = (SSLSocket) f.createSocket("localhost", server.port())) {
                s.startHandshake();
                String dn = server.clientDn.get(5, TimeUnit.SECONDS);
                assertEquals(label.equals("client") ? "CN=MQ Client" : "CN=Other Client", dn);
                awaitProtocol(session);
                assertTrue(session.trusted);
                assertEquals(2, session.serverChain.size());
                assertTrue(session.protocol.startsWith("TLS"));
                assertNotNull(session.cipher);
                assertNotNull(session.trustStore);
            }
        }
    }

    @Test
    void untrustedServerIsRecordedForTheErrorScreen() throws Exception {
        TlsFactory.Session session = new TlsFactory.Session();
        SSLSocketFactory f = TlsFactory.create(tls(null, res("trust.jks"), null), session);
        try (Server server = new Server("leaf.p12");
             SSLSocket s = (SSLSocket) f.createSocket("localhost", server.port())) {
            assertThrows(SSLHandshakeException.class, s::startHandshake);
        }
        assertFalse(session.trusted);
        List<Errors.CertInfo> d = TlsFactory.describe(session);
        assertEquals(2, d.size());
        assertEquals(new Errors.CertInfo("Server", "CN=leaf", "CN=Rogue CA", "Received"), d.get(0));
        assertEquals(new Errors.CertInfo("Root", "CN=Rogue CA", "CN=Rogue CA", "Not in truststore"), d.get(1));
    }

    @Test
    void keystoreDoublesAsTruststoreAndDefaultsWithoutEither() throws Exception {
        TlsFactory.Session s1 = new TlsFactory.Session();
        assertNotNull(TlsFactory.create(tls(res("server.p12"), null, null), s1));
        assertTrue(s1.trustStore.containsAlias("server"));

        TlsFactory.Session s2 = new TlsFactory.Session();
        assertNotNull(TlsFactory.create(new Config.Tls(true, null, " ", null, null, null, null, null), s2));
        assertNull(s2.trustStore);
    }

    @Test
    void describesChainsAgainstTheTruststore() throws Exception {
        KeyStore trust = TlsFactory.load(res("trust.jks"), PW);
        X509Certificate[] server = chainOf("server.p12", "server");
        X509Certificate[] leaf = chainOf("leaf.p12", "leaf");

        TlsFactory.Session s = new TlsFactory.Session();
        s.trustStore = trust;
        s.trusted = true;
        s.serverChain = List.of(server[0]);
        assertEquals(List.of(
                new Errors.CertInfo("Server", "CN=localhost", "CN=Test CA", "Trusted"),
                new Errors.CertInfo("Issuer", "CN=Test CA", "CN=Test CA", "In truststore")), TlsFactory.describe(s));

        s.serverChain = List.of(server);
        assertEquals("In truststore", TlsFactory.describe(s).get(1).status());

        s.serverChain = List.of(leaf);
        assertEquals("Trusted", TlsFactory.describe(s).get(1).status());

        s.trusted = false;
        s.trustStore = null;
        s.serverChain = List.of(leaf[0]);
        assertEquals(new Errors.CertInfo("Issuer", "CN=Rogue CA", "CN=Rogue CA", "Not verified"), TlsFactory.describe(s).get(1));
        s.trusted = true;
        assertEquals("Trusted", TlsFactory.describe(s).get(1).status());

        // A chain of a non-root intermediate gets the missing issuer as "Root".
        s.serverChain = List.of(server[0], server[0]);
        assertEquals("Root", TlsFactory.describe(s).get(2).role());
        assertEquals("Intermediate", TlsFactory.describe(s).get(1).role());

        // Truststores that cannot be read count as not containing anything.
        s.trustStore = KeyStore.getInstance("PKCS12");
        s.trusted = false;
        s.serverChain = List.of(server[0], server[1]);
        List<Errors.CertInfo> d = TlsFactory.describe(s);
        assertEquals("Not in truststore", d.get(1).status());

        s.serverChain = List.of(leaf[0]);
        assertEquals("Not verified", TlsFactory.describe(s).get(1).status());

        s.serverChain = List.of();
        assertTrue(TlsFactory.describe(s).isEmpty());
    }

    @Test
    void loadPicksTheStoreTypeAndRetriesJksAsPkcs12(@TempDir Path dir) throws Exception {
        assertTrue(TlsFactory.load(res("trust.jks"), PW).containsAlias("ca"));
        Path p12AsJks = dir.resolve("client.jks");
        Files.copy(Path.of(res("client.p12")), p12AsJks);
        assertTrue(TlsFactory.load(p12AsJks.toString(), PW).containsAlias("client"));
        assertThrows(IOException.class, () -> TlsFactory.load(res("trust.jks"), "wrong"));
        assertThrows(IOException.class, () -> TlsFactory.load(res("client.p12"), "wrong"));
        assertThrows(IOException.class, () -> TlsFactory.load(res("client.p12"), null));
    }

    @Test
    void expandsHome() {
        String home = System.getProperty("user.home");
        assertEquals(home + "/k.p12", TlsFactory.expandHome("~/k.p12"));
        assertEquals(home + "\\k.p12", TlsFactory.expandHome("~\\k.p12"));
        assertEquals("/abs/k.p12", TlsFactory.expandHome("/abs/k.p12"));
    }

    @Test
    void socketFactoryTracksEverySocketKind() throws Exception {
        TlsFactory.Session session = new TlsFactory.Session();
        SSLSocketFactory f = TlsFactory.create(tls(null, res("trust.jks"), null), session);
        assertTrue(f.getDefaultCipherSuites().length > 0);
        assertTrue(f.getSupportedCipherSuites().length > 0);

        InetAddress lo = InetAddress.getLoopbackAddress();
        try (ServerSocket plain = new ServerSocket(0, 50, lo)) {
            Thread.ofVirtual().start(() -> {
                while (!plain.isClosed()) {
                    try {
                        plain.accept();
                    } catch (IOException e) {
                        return;
                    }
                }
            });
            int port = plain.getLocalPort();
            try (Socket a = f.createSocket();
                 Socket b = f.createSocket(lo, port);
                 Socket c = f.createSocket(lo, port, lo, 0);
                 Socket d = f.createSocket("localhost", port, lo, 0);
                 Socket raw = new Socket(lo, port);
                 Socket e = f.createSocket(raw, "localhost", port, true)) {
                for (Socket s : List.of(a, b, c, d, e)) {
                    assertTrue(s instanceof SSLSocket);
                }
            }
        }
    }

    @Test
    void wrappersDelegate() throws Exception {
        X509TrustManager tm = mock(X509TrustManager.class);
        X509Certificate[] issuers = new X509Certificate[0];
        when(tm.getAcceptedIssuers()).thenReturn(issuers);
        Constructor<?> rtm = Class.forName("org.akbal.sidecar.TlsFactory$RecordingTrustManager")
                .getDeclaredConstructor(X509TrustManager.class, TlsFactory.Session.class);
        rtm.setAccessible(true);
        X509TrustManager recording = (X509TrustManager) rtm.newInstance(tm, new TlsFactory.Session());
        recording.checkClientTrusted(issuers, "EC");
        verify(tm).checkClientTrusted(issuers, "EC");
        assertArrayEquals(issuers, recording.getAcceptedIssuers());

        X509ExtendedKeyManager km = mock(X509ExtendedKeyManager.class);
        when(km.getClientAliases("EC", null)).thenReturn(new String[]{"a"});
        when(km.getServerAliases("EC", null)).thenReturn(new String[]{"s"});
        when(km.chooseServerAlias("EC", null, null)).thenReturn("s");
        when(km.getCertificateChain("a")).thenReturn(issuers);
        Constructor<?> lkm = Class.forName("org.akbal.sidecar.TlsFactory$LabelKeyManager")
                .getDeclaredConstructor(X509ExtendedKeyManager.class, String.class);
        lkm.setAccessible(true);
        X509ExtendedKeyManager label = (X509ExtendedKeyManager) lkm.newInstance(km, "mylabel");
        assertEquals("mylabel", label.chooseClientAlias(new String[]{"EC"}, null, null));
        assertEquals("mylabel", label.chooseEngineClientAlias(new String[]{"EC"}, null, (SSLEngine) null));
        assertArrayEquals(new String[]{"a"}, label.getClientAliases("EC", null));
        assertArrayEquals(new String[]{"s"}, label.getServerAliases("EC", null));
        assertEquals("s", label.chooseServerAlias("EC", null, null));
        assertArrayEquals(issuers, label.getCertificateChain("a"));
        assertNull(label.getPrivateKey("a"));
    }
}
