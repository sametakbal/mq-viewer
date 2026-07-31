package org.akbal.service;

import com.ibm.mq.MQException;
import com.ibm.mq.MQGetMessageOptions;
import com.ibm.mq.MQMessage;
import com.ibm.mq.MQQueue;
import com.ibm.mq.MQQueueManager;
import com.ibm.mq.constants.CMQC;
import org.akbal.model.MqConnectionConfig;
import org.akbal.model.MqMessage;

import java.io.IOException;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Hashtable;
import java.util.List;

import static org.akbal.i18n.LocaleManager.msg;

public class MqService {

    private Hashtable<String, Object> buildConnectionProperties(MqConnectionConfig config) {
        Hashtable<String, Object> props = new Hashtable<>();
        props.put(CMQC.HOST_NAME_PROPERTY, config.getHost());
        props.put(CMQC.PORT_PROPERTY, config.getPort());
        props.put(CMQC.CHANNEL_PROPERTY, config.getChannel());
        props.put(CMQC.TRANSPORT_PROPERTY, CMQC.TRANSPORT_MQSERIES_CLIENT);

        if (config.getUsername() != null && !config.getUsername().isBlank()) {
            props.put(CMQC.USER_ID_PROPERTY, config.getUsername());
            props.put(CMQC.PASSWORD_PROPERTY, config.getPassword());
        }

        return props;
    }

    public String testConnection(MqConnectionConfig config) {
        MQQueueManager queueManager = null;
        try {
            Hashtable<String, Object> props = buildConnectionProperties(config);
            queueManager = new MQQueueManager(config.getQueueManager(), props);
            return msg("mq.connection_success", queueManager.getName().trim());
        } catch (MQException e) {
            return msg("mq.connection_error", formatMqException(e));
        } finally {
            disconnect(queueManager);
        }
    }

    public List<MqMessage> browseMessages(MqConnectionConfig config, int limit) throws MQException, IOException {
        List<MqMessage> messages = new ArrayList<>();
        MQQueueManager queueManager = null;
        MQQueue queue = null;

        try {
            Hashtable<String, Object> props = buildConnectionProperties(config);
            queueManager = new MQQueueManager(config.getQueueManager(), props);

            int openOptions = CMQC.MQOO_BROWSE | CMQC.MQOO_FAIL_IF_QUIESCING;
            queue = queueManager.accessQueue(config.getQueueName(), openOptions);

            MQGetMessageOptions gmo = new MQGetMessageOptions();
            gmo.options = CMQC.MQGMO_BROWSE_FIRST | CMQC.MQGMO_NO_WAIT | CMQC.MQGMO_CONVERT;

            int index = 1;
            while (index <= limit) {
                MQMessage mqMsg = new MQMessage();
                try {
                    queue.get(mqMsg, gmo);
                } catch (MQException e) {
                    if (e.reasonCode == CMQC.MQRC_NO_MSG_AVAILABLE) {
                        break;
                    }
                    throw e;
                }

                MqMessage msg = new MqMessage();
                msg.setIndex(index);
                msg.setMessageId(bytesToHex(mqMsg.messageId));
                msg.setCorrelationId(bytesToHex(mqMsg.correlationId));
                msg.setFormat(mqMsg.format != null ? mqMsg.format.trim() : "");
                msg.setSize(mqMsg.getMessageLength());

                try {
                    LocalDateTime putDt = mqMsg.putDateTime.getTime().toInstant()
                            .atZone(ZoneId.systemDefault()).toLocalDateTime();
                    msg.setPutDateTime(putDt);
                } catch (Exception ignored) {
                }

                try {
                    msg.setPayload(mqMsg.readStringOfByteLength(mqMsg.getMessageLength()));
                } catch (Exception e) {
                    msg.setPayload(msg("mq.binary_data"));
                }

                messages.add(msg);
                gmo.options = CMQC.MQGMO_BROWSE_NEXT | CMQC.MQGMO_NO_WAIT | CMQC.MQGMO_CONVERT;
                index++;
            }
        } finally {
            if (queue != null) {
                try {
                    queue.close();
                } catch (MQException ignored) {
                }
            }
            disconnect(queueManager);
        }

        return messages;
    }

    private void disconnect(MQQueueManager queueManager) {
        if (queueManager != null) {
            try {
                queueManager.disconnect();
            } catch (MQException ignored) {
            }
        }
    }

    private String bytesToHex(byte[] bytes) {
        if (bytes == null)
            return "";
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format("%02X", b));
        }
        return sb.toString();
    }

    private String formatMqException(MQException e) {
        return String.format("CC=%d RC=%d - %s", e.completionCode, e.reasonCode, e.getMessage());
    }
}
