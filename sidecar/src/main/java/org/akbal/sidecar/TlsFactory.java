package org.akbal.sidecar;

import javax.net.ssl.HandshakeCompletedEvent;
import javax.net.ssl.KeyManager;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLEngine;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509ExtendedKeyManager;
import javax.net.ssl.X509TrustManager;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.Socket;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.Principal;
import java.security.PrivateKey;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Builds the SSLSocketFactory for a client channel from a keystore/truststore (JKS or PKCS#12),
 * remembers the server chain for the TLS error screen and records the negotiated protocol.
 */
public final class TlsFactory {

    /** Keeps what the handshake revealed so it can be reported on success or failure. */
    public static final class Session {
        volatile List<X509Certificate> serverChain = List.of();
        volatile String protocol;
        volatile String cipher;
        volatile boolean trusted;
        KeyStore trustStore;
    }

    private TlsFactory() {
    }

    public static SSLSocketFactory create(Config.Tls tls, Session session) throws Exception {
        KeyManager[] keyManagers = null;
        if (notBlank(tls.keystore())) {
            KeyStore ks = load(tls.keystore(), tls.keystorePassword());
            KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
            kmf.init(ks, chars(tls.keystorePassword()));
            keyManagers = kmf.getKeyManagers();
            if (notBlank(tls.certLabel())) {
                for (int i = 0; i < keyManagers.length; i++) {
                    if (keyManagers[i] instanceof X509ExtendedKeyManager km) {
                        keyManagers[i] = new LabelKeyManager(km, tls.certLabel());
                    }
                }
            }
        }

        KeyStore trustStore = null;
        if (notBlank(tls.truststore())) {
            trustStore = load(tls.truststore(), tls.truststorePassword());
        } else if (notBlank(tls.keystore())) {
            // Like the MQ C client's .kdb, a single keystore commonly holds the CA chain too.
            trustStore = load(tls.keystore(), tls.keystorePassword());
        }
        session.trustStore = trustStore;
        TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(trustStore);
        X509TrustManager delegate = null;
        for (TrustManager tm : tmf.getTrustManagers()) {
            if (tm instanceof X509TrustManager x) {
                delegate = x;
            }
        }
        if (delegate == null) {
            throw new IllegalStateException("No X509TrustManager available");
        }

        SSLContext ctx = SSLContext.getInstance("TLS");
        ctx.init(keyManagers, new TrustManager[]{new RecordingTrustManager(delegate, session)}, null);
        return new RecordingSocketFactory(ctx.getSocketFactory(), session);
    }

    public static KeyStore load(String file, String password) throws Exception {
        Path path = Path.of(expandHome(file));
        String name = path.getFileName().toString().toLowerCase(Locale.ROOT);
        String type = name.endsWith(".jks") ? "JKS" : "PKCS12";
        KeyStore ks = KeyStore.getInstance(type);
        try (InputStream in = new FileInputStream(path.toFile())) {
            ks.load(in, chars(password));
        } catch (IOException e) {
            if (!"JKS".equals(type)) {
                throw e;
            }
            // Modern JDKs read PKCS#12 even with a .jks extension and vice versa; try the other one.
            ks = KeyStore.getInstance("PKCS12");
            try (InputStream in = new FileInputStream(path.toFile())) {
                ks.load(in, chars(password));
            }
        }
        return ks;
    }

    /** Describes the presented chain for the UI: Server / Intermediate / Root with a trust verdict each. */
    public static List<Errors.CertInfo> describe(Session session) {
        List<X509Certificate> chain = session.serverChain;
        List<Errors.CertInfo> out = new ArrayList<>();
        for (int i = 0; i < chain.size(); i++) {
            X509Certificate c = chain.get(i);
            boolean selfSigned = c.getSubjectX500Principal().equals(c.getIssuerX500Principal());
            String role = i == 0 ? "Server" : selfSigned ? "Root" : "Intermediate";
            String status;
            if (i == 0) {
                status = session.trusted ? "Trusted" : "Received";
            } else {
                status = inTrustStore(session.trustStore, c) ? "In truststore" : session.trusted ? "Trusted" : "Not in truststore";
            }
            out.add(new Errors.CertInfo(role, c.getSubjectX500Principal().getName(), c.getIssuerX500Principal().getName(), status));
        }
        // Add the issuer the server did not send, so a missing root shows up in the list.
        if (!chain.isEmpty()) {
            X509Certificate last = chain.get(chain.size() - 1);
            if (!last.getSubjectX500Principal().equals(last.getIssuerX500Principal())) {
                String issuer = last.getIssuerX500Principal().getName();
                boolean known = issuerInTrustStore(session.trustStore, issuer);
                out.add(new Errors.CertInfo(chain.size() == 1 ? "Issuer" : "Root", issuer, issuer,
                        known ? "In truststore" : session.trusted ? "Trusted" : "Not verified"));
            }
        }
        return out;
    }

    private static boolean inTrustStore(KeyStore ts, X509Certificate cert) {
        if (ts == null) {
            return false;
        }
        try {
            return ts.getCertificateAlias(cert) != null;
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean issuerInTrustStore(KeyStore ts, String issuerDn) {
        if (ts == null) {
            return false;
        }
        try {
            for (String alias : Collections.list(ts.aliases())) {
                if (ts.getCertificate(alias) instanceof X509Certificate x
                        && x.getSubjectX500Principal().getName().equals(issuerDn)) {
                    return true;
                }
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    static String expandHome(String file) {
        if (file.startsWith("~/") || file.startsWith("~\\")) {
            return System.getProperty("user.home") + file.substring(1);
        }
        return file;
    }

    private static char[] chars(String s) {
        return s == null ? new char[0] : s.toCharArray();
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }

    private static final class RecordingTrustManager implements X509TrustManager {
        private final X509TrustManager delegate;
        private final Session session;

        RecordingTrustManager(X509TrustManager delegate, Session session) {
            this.delegate = delegate;
            this.session = session;
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            delegate.checkClientTrusted(chain, authType);
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            session.serverChain = List.of(chain);
            session.trusted = false;
            delegate.checkServerTrusted(chain, authType);
            session.trusted = true;
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return delegate.getAcceptedIssuers();
        }
    }

    /** Picks the client certificate by label (keystore alias), like CERTLABL on the MQ C client. */
    private static final class LabelKeyManager extends X509ExtendedKeyManager {
        private final X509ExtendedKeyManager delegate;
        private final String label;

        LabelKeyManager(X509ExtendedKeyManager delegate, String label) {
            this.delegate = delegate;
            this.label = label;
        }

        @Override
        public String chooseClientAlias(String[] keyType, Principal[] issuers, Socket socket) {
            return label;
        }

        @Override
        public String chooseEngineClientAlias(String[] keyType, Principal[] issuers, SSLEngine engine) {
            return label;
        }

        @Override
        public String[] getClientAliases(String keyType, Principal[] issuers) {
            return delegate.getClientAliases(keyType, issuers);
        }

        @Override
        public String[] getServerAliases(String keyType, Principal[] issuers) {
            return delegate.getServerAliases(keyType, issuers);
        }

        @Override
        public String chooseServerAlias(String keyType, Principal[] issuers, Socket socket) {
            return delegate.chooseServerAlias(keyType, issuers, socket);
        }

        @Override
        public X509Certificate[] getCertificateChain(String alias) {
            return delegate.getCertificateChain(alias);
        }

        @Override
        public PrivateKey getPrivateKey(String alias) {
            return delegate.getPrivateKey(alias);
        }
    }

    private static final class RecordingSocketFactory extends SSLSocketFactory {
        private final SSLSocketFactory delegate;
        private final Session session;

        RecordingSocketFactory(SSLSocketFactory delegate, Session session) {
            this.delegate = delegate;
            this.session = session;
        }

        private Socket track(Socket s) {
            if (s instanceof SSLSocket ssl) {
                ssl.addHandshakeCompletedListener((HandshakeCompletedEvent e) -> {
                    session.protocol = e.getSession().getProtocol();
                    session.cipher = e.getCipherSuite();
                });
            }
            return s;
        }

        @Override
        public String[] getDefaultCipherSuites() {
            return delegate.getDefaultCipherSuites();
        }

        @Override
        public String[] getSupportedCipherSuites() {
            return delegate.getSupportedCipherSuites();
        }

        @Override
        public Socket createSocket() throws IOException {
            return track(delegate.createSocket());
        }

        @Override
        public Socket createSocket(Socket s, String host, int port, boolean autoClose) throws IOException {
            return track(delegate.createSocket(s, host, port, autoClose));
        }

        @Override
        public Socket createSocket(String host, int port) throws IOException {
            return track(delegate.createSocket(host, port));
        }

        @Override
        public Socket createSocket(String host, int port, InetAddress localHost, int localPort) throws IOException {
            return track(delegate.createSocket(host, port, localHost, localPort));
        }

        @Override
        public Socket createSocket(InetAddress host, int port) throws IOException {
            return track(delegate.createSocket(host, port));
        }

        @Override
        public Socket createSocket(InetAddress address, int port, InetAddress localAddress, int localPort) throws IOException {
            return track(delegate.createSocket(address, port, localAddress, localPort));
        }
    }
}
