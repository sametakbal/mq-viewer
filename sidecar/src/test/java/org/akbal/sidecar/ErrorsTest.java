package org.akbal.sidecar;

import com.ibm.mq.MQException;
import com.ibm.mq.constants.CMQC;
import com.ibm.mq.headers.MQDataException;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

class ErrorsTest {

    @Test
    void opExceptionKeepsItsError() {
        Errors.MqError err = new Errors.MqError(1, "X", 2, "m", null, List.of());
        Errors.OpException op = new Errors.OpException(err, null);
        assertSame(err, Errors.toError(op));
        assertEquals("m", op.getMessage());
    }

    @Test
    void invalidRequestShape() {
        Errors.MqError e = Errors.toError(Errors.invalid("queue is required"));
        assertEquals(new Errors.MqError(0, "INVALID_REQUEST", 2, "queue is required", null, null), e);
    }

    @Test
    void mqExceptionUsesReasonNameAndRootCause() {
        MQException mq = new MQException(CMQC.MQCC_FAILED, CMQC.MQRC_NOT_AUTHORIZED, this);
        mq.initCause(new RuntimeException("outer", new IOException("socket closed")));
        Errors.MqError e = Errors.toError(mq);
        assertEquals(2035, e.code());
        assertEquals("MQRC_NOT_AUTHORIZED", e.name());
        assertEquals(2, e.cc());
        assertEquals("java.io.IOException: socket closed", e.detail());
    }

    @Test
    void mqDataException() {
        Errors.MqError e = Errors.toError(new MQDataException(CMQC.MQCC_FAILED, 3008, this));
        assertEquals(3008, e.code());
        assertEquals("MQRCCF_COMMAND_FAILED", e.name());
        assertNull(e.detail());
    }

    @Test
    void anyOtherThrowable() {
        Errors.MqError e = Errors.toError(new IllegalStateException());
        assertEquals(new Errors.MqError(0, "IllegalStateException", 2, "null", null, null), e);
    }

    @Test
    void reasonNames() {
        assertEquals("MQRC_Q_FULL", Errors.reasonName(CMQC.MQRC_Q_FULL));
        assertEquals("MQRC_987654", Errors.reasonName(987654));
    }

    @Test
    void lookupIgnoresMissingAndNumericResults() {
        assertEquals("MQPER_PERSISTENT", Errors.lookup(CMQC.MQPER_PERSISTENT, "MQPER_.*"));
        assertNull(Errors.lookup(987654, "MQRC_.*"));
        assertNull(Errors.lookup(1, "[invalid"));
    }

    @Test
    void pickAliasFallsBackToTheFirstName() {
        assertEquals("MQX_FIRST", Errors.pickAlias("MQX_FIRST/MQX_LAST"));
        assertEquals("MQX_A", Errors.pickAlias("MQX_A"));
    }

    @Test
    void rootCauseStopsAtSelfReference() {
        assertNull(Errors.rootCause(new RuntimeException("no cause")));
        Throwable selfish = new Throwable("loop") {
            @Override
            public synchronized Throwable getCause() {
                return this;
            }
        };
        assertEquals(selfish.getClass().getName() + ": loop", Errors.rootCause(new RuntimeException(selfish)));
    }
}
