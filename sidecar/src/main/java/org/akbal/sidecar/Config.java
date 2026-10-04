package org.akbal.sidecar;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** Connection settings as sent by the UI; secrets are filled in by the Tauri side from the OS keyring. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record Config(String id, String host, int port, String channel, String qmgr,
                     String user, String password, Tls tls) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Tls(boolean enabled, String cipher, String keystore, String keystorePassword,
                      String truststore, String truststorePassword, String certLabel, String peerName) {
    }

    public boolean tlsEnabled() {
        return tls != null && tls.enabled();
    }

    public String endpoint() {
        return host + ":" + port;
    }
}
