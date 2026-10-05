package org.akbal.sidecar;

import com.ibm.mq.constants.CMQC;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MqOpsTest {

    @Test
    void probeCountsOpenAndInUseAsAllowed() {
        assertTrue(MqOps.allowed(0));
        assertTrue(MqOps.allowed(CMQC.MQRC_OBJECT_IN_USE));
        assertFalse(MqOps.allowed(CMQC.MQRC_NOT_AUTHORIZED));
        assertFalse(MqOps.allowed(CMQC.MQRC_UNKNOWN_OBJECT_NAME));
        assertFalse(MqOps.allowed(CMQC.MQRC_OPTION_NOT_VALID_FOR_TYPE));
    }
}
