// Human explanations for the reason codes people actually hit, generalised from the design's
// error cards (2035, 2059, 2393). Unknown codes fall back to the sidecar's message.
import type { MqError } from "./types";

export interface Explained {
  code: number;
  name: string;
  icon: string;
  title: string;
  desc: string;
  causes: string[];
  /** Wording for the second button: fix credentials, fix TLS, or just edit. */
  edit: "credentials" | "tls" | "connection";
}

const CATALOG: Record<number, Omit<Explained, "code" | "name">> = {
  2035: {
    icon: "ph-lock-key", title: "Not authorized", edit: "credentials",
    desc: "The queue manager rejected this user. The credentials or a channel authentication rule did not allow the request.",
    causes: [
      "A CHLAUTH rule blocks this user or client address on the channel",
      "The saved password is wrong or has expired",
      "The user lacks +connect / +browse / +get / +put authority (setmqaut)",
    ],
  },
  2059: {
    icon: "ph-link-break", title: "Queue manager not available", edit: "connection",
    desc: "No queue manager answered on this host and port. The connection was refused or timed out.",
    causes: [
      "The queue manager is stopped or failing over (multi-instance / RDQM)",
      "The listener is not running on this port",
      "The channel is stopped, or the channel name is wrong",
      "A firewall or VPN is dropping the connection",
    ],
  },
  2538: {
    icon: "ph-plugs", title: "Host not available", edit: "connection",
    desc: "The TCP connection to the host could not be established.",
    causes: ["The host name or port is wrong", "Nothing is listening on that port", "A firewall blocks the connection"],
  },
  2058: {
    icon: "ph-hard-drives", title: "Queue manager name mismatch", edit: "connection",
    desc: "A queue manager answered, but not the one named in this connection.",
    causes: ["The queue manager name is misspelt (names are case-sensitive)", "The listener belongs to a different queue manager"],
  },
  2540: {
    icon: "ph-plugs-connected", title: "Unknown channel", edit: "connection",
    desc: "The server-connection channel does not exist on the queue manager.",
    causes: ["The channel name is wrong (names are case-sensitive)", "The SVRCONN channel has not been defined"],
  },
  2009: {
    icon: "ph-link-break", title: "Connection broken", edit: "connection",
    desc: "The connection to the queue manager was lost while working.",
    causes: ["The queue manager ended or the channel was stopped", "A network device closed an idle connection", "SHARECNV / heartbeat settings do not match"],
  },
  2393: {
    icon: "ph-shield-warning", title: "TLS initialisation failed", edit: "tls",
    desc: "The secure channel could not be set up on the client side.",
    causes: [
      "The keystore password is wrong or the file is not a valid PKCS#12 / JKS",
      "The issuing CA of the server certificate is missing from the truststore",
      "The cipher spec is not supported by this Java runtime",
    ],
  },
  2397: {
    icon: "ph-shield-warning", title: "TLS handshake failed", edit: "tls",
    desc: "The client and the channel could not agree on TLS settings.",
    causes: ["The cipher spec does not match SSLCIPH on the channel", "The server requires a client certificate (SSLCAUTH)", "The certificate label does not exist in the keystore"],
  },
  2398: {
    icon: "ph-identification-card", title: "TLS peer name mismatch", edit: "tls",
    desc: "The server certificate's distinguished name does not match the SSL peer name filter.",
    causes: ["The SSL peer name pattern is too strict or misspelt", "The server presented a different certificate than expected"],
  },
  2085: {
    icon: "ph-tray", title: "Queue not found", edit: "connection",
    desc: "The queue does not exist on this queue manager.",
    causes: ["The queue name is misspelt (names are case-sensitive)", "The queue was deleted", "It is defined on another queue manager in the cluster"],
  },
  2042: {
    icon: "ph-lock", title: "Queue in use", edit: "connection",
    desc: "The queue is open exclusively by another application.",
    causes: ["An application opened it with MQOO_INPUT_EXCLUSIVE", "CLEAR QLOCAL cannot run while the queue is open"],
  },
  2016: {
    icon: "ph-prohibit", title: "Gets inhibited", edit: "connection",
    desc: "GET(DISABLED) is set on the queue, so messages cannot be read or removed.",
    causes: ["An administrator disabled gets on the queue"],
  },
  2051: {
    icon: "ph-prohibit", title: "Puts inhibited", edit: "connection",
    desc: "PUT(DISABLED) is set on the queue, so new messages are rejected.",
    causes: ["An administrator disabled puts on the queue"],
  },
  2053: {
    icon: "ph-warning", title: "Queue full", edit: "connection",
    desc: "The queue has reached MAXDEPTH.",
    causes: ["Consumers are not keeping up", "MAXDEPTH is too low for the workload"],
  },
};

export function explain(err: MqError): Explained {
  const known = CATALOG[err.code];
  if (known) return { code: err.code, name: err.name, ...known };
  if (err.name === "SIDECAR_UNAVAILABLE" || err.name === "SIDECAR_EXITED") {
    return {
      code: 0, name: err.name, icon: "ph-plug", edit: "connection", title: "MQ engine is not running",
      desc: err.message, causes: ["The bundled Java runtime could not start", "The sidecar jar is missing from the installation"],
    };
  }
  return {
    code: err.code, name: err.name, icon: "ph-warning-octagon", edit: "connection",
    title: err.code ? err.name.replace(/^MQRC_/, "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "Request failed",
    desc: err.message, causes: [],
  };
}

/** One-line log text as on the error card: MQ message plus the Java root cause. */
export function logLine(err: MqError) {
  return [err.message, err.detail].filter(Boolean).join(" — ");
}

export function short(err: MqError) {
  return err.code ? `${err.code} ${err.name.replace(/^MQRC_/, "")}` : err.name;
}
