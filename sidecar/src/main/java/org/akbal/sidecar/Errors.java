package org.akbal.sidecar;

import com.ibm.mq.MQException;
import com.ibm.mq.constants.MQConstants;
import com.ibm.mq.headers.MQDataException;

import java.util.List;

/** Converts anything thrown by an operation into the error shape the UI understands. */
public final class Errors {

    private Errors() {
    }

    public record CertInfo(String role, String dn, String issuer, String status) {
    }

    public record MqError(int code, String name, int cc, String message, String detail, List<CertInfo> tlsChain) {
    }

    /** Thrown by operations that want to attach extra context (for example a TLS chain). */
    public static final class OpException extends RuntimeException {
        final MqError error;

        public OpException(MqError error, Throwable cause) {
            super(error.message(), cause);
            this.error = error;
        }
    }

    public static OpException invalid(String message) {
        return new OpException(new MqError(0, "INVALID_REQUEST", 2, message, null, null), null);
    }

    public static MqError toError(Throwable t) {
        if (t instanceof OpException op) {
            return op.error;
        }
        if (t instanceof MQException e) {
            return new MqError(e.reasonCode, reasonName(e.reasonCode), e.completionCode, e.getMessage(), rootCause(e), null);
        }
        if (t instanceof MQDataException e) {
            return new MqError(e.reasonCode, reasonName(e.reasonCode), e.completionCode, e.getMessage(), rootCause(e), null);
        }
        return new MqError(0, t.getClass().getSimpleName(), 2, String.valueOf(t.getMessage()), rootCause(t), null);
    }

    public static String reasonName(int rc) {
        String name = lookup(rc, "MQRC_.*");
        if (name == null) {
            name = lookup(rc, "MQRCCF_.*");
        }
        return name != null ? name : "MQRC_" + rc;
    }

    /**
     * Looks up a constant name such as MQMT_DATAGRAM, or returns null when there is no match.
     * MQConstants joins aliases with "/" (MQMT_SYSTEM_FIRST/MQMT_REQUEST); range markers and
     * defaults are dropped in favour of the specific name.
     */
    public static String lookup(int value, String filter) {
        String s;
        try {
            s = MQConstants.lookup(value, filter);
        } catch (Throwable ignored) {
            return null;
        }
        if (s == null || s.isBlank() || s.matches("-?\\d+")) {
            return null;
        }
        return pickAlias(s);
    }

    static String pickAlias(String joined) {
        String best = null;
        for (String name : joined.split("/")) {
            if (name.endsWith("_FIRST") || name.endsWith("_LAST") || name.endsWith("_DEFAULT")) {
                continue;
            }
            best = name;
        }
        return best != null ? best : joined.split("/")[0];
    }

    static String rootCause(Throwable t) {
        Throwable c = t.getCause();
        if (c == null) {
            return null;
        }
        while (c.getCause() != null && c.getCause() != c) {
            c = c.getCause();
        }
        return c.getClass().getName() + ": " + c.getMessage();
    }
}
