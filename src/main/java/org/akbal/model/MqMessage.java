package org.akbal.model;

import java.time.LocalDateTime;

public class MqMessage {

    private int index;
    private String messageId;
    private String correlationId;
    private LocalDateTime putDateTime;
    private String format;
    private int size;
    private String payload;

    public int getIndex() {
        return index;
    }

    public void setIndex(int index) {
        this.index = index;
    }

    public String getMessageId() {
        return messageId;
    }

    public void setMessageId(String messageId) {
        this.messageId = messageId;
    }

    public String getCorrelationId() {
        return correlationId;
    }

    public void setCorrelationId(String correlationId) {
        this.correlationId = correlationId;
    }

    public LocalDateTime getPutDateTime() {
        return putDateTime;
    }

    public void setPutDateTime(LocalDateTime putDateTime) {
        this.putDateTime = putDateTime;
    }

    public String getFormat() {
        return format;
    }

    public void setFormat(String format) {
        this.format = format;
    }

    public int getSize() {
        return size;
    }

    public void setSize(int size) {
        this.size = size;
    }

    public String getPayload() {
        return payload;
    }

    public void setPayload(String payload) {
        this.payload = payload;
    }
}
