package org.akbal.service;

import org.akbal.model.MqConnectionConfig;
import org.akbal.model.MqMessage;

import javax.swing.*;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.function.BiConsumer;
import java.util.function.Consumer;

/**
 * Periodically polls an MQ queue and reports only newly-seen messages.
 * Uses a {@link javax.swing.Timer} so callbacks fire on the EDT.
 */
public class LiveModeService {

    private static final int POLL_INTERVAL_MS = 3_000;
    private static final int MAX_CONSECUTIVE_ERRORS = 3;

    private final MqService mqService;

    private Timer timer;
    private Set<String> seenMessageIds;
    private int consecutiveErrors;
    private int totalMessageCount;

    public LiveModeService(MqService mqService) {
        this.mqService = mqService;
    }

    /**
     * Starts live polling.
     *
     * @param config          MQ connection config
     * @param limit           max messages to browse per poll
     * @param onNewMessages   callback(newMessages, totalCount) — fires on EDT
     * @param onError         callback(errorMessage) — fires on EDT
     * @param onAutoStopped   callback() — fires when auto-stopped after repeated errors
     */
    public void start(MqConnectionConfig config, int limit,
                      BiConsumer<List<MqMessage>, Integer> onNewMessages,
                      Consumer<String> onError,
                      Runnable onAutoStopped) {

        if (isRunning()) {
            stop();
        }

        seenMessageIds = new LinkedHashSet<>();
        consecutiveErrors = 0;
        totalMessageCount = 0;

        timer = new Timer(POLL_INTERVAL_MS, e -> poll(config, limit, onNewMessages, onError, onAutoStopped));
        timer.setInitialDelay(0); // First poll immediately
        timer.start();
    }

    /** Stops live polling. */
    public void stop() {
        if (timer != null) {
            timer.stop();
            timer = null;
        }
        seenMessageIds = null;
        consecutiveErrors = 0;
    }

    /** Returns true if live mode is currently active. */
    public boolean isRunning() {
        return timer != null && timer.isRunning();
    }

    /** Returns total message count seen since start. */
    public int getTotalMessageCount() {
        return totalMessageCount;
    }

    private void poll(MqConnectionConfig config, int limit,
                      BiConsumer<List<MqMessage>, Integer> onNewMessages,
                      Consumer<String> onError,
                      Runnable onAutoStopped) {

        // Run the MQ browse on a background thread to avoid blocking EDT
        new SwingWorker<List<MqMessage>, Void>() {
            @Override
            protected List<MqMessage> doInBackground() throws Exception {
                return mqService.browseMessages(config, limit);
            }

            @Override
            protected void done() {
                if (!isRunning()) return; // Stopped while polling

                try {
                    List<MqMessage> allMessages = get();
                    consecutiveErrors = 0;

                    // Filter to only new messages
                    List<MqMessage> newMessages = new ArrayList<>();
                    for (MqMessage msg : allMessages) {
                        if (seenMessageIds.add(msg.getMessageId())) {
                            totalMessageCount++;
                            msg.setIndex(totalMessageCount);
                            newMessages.add(msg);
                        }
                    }

                    if (!newMessages.isEmpty()) {
                        onNewMessages.accept(newMessages, totalMessageCount);
                    }
                } catch (Exception ex) {
                    consecutiveErrors++;
                    String errorMsg = ex.getCause() != null ? ex.getCause().getMessage() : ex.getMessage();
                    onError.accept(errorMsg);

                    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                        stop();
                        onAutoStopped.run();
                    }
                }
            }
        }.execute();
    }
}
