package org.akbal.ui;

import org.akbal.model.MqMessage;
import org.akbal.service.MqService;

import javax.swing.*;
import java.awt.*;
import java.util.List;

public class MainFrame extends JFrame {

    private final ConnectionPanel connectionPanel;
    private final MessageTablePanel messageTablePanel;
    private final MessageDetailPanel messageDetailPanel;
    private final JLabel statusBar;

    private final MqService mqService = new MqService();

    public MainFrame() {
        super("IBM MQ Viewer");
        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        setSize(1000, 700);
        setMinimumSize(new Dimension(800, 550));
        setLocationRelativeTo(null);

        connectionPanel = new ConnectionPanel();
        messageTablePanel = new MessageTablePanel();
        messageDetailPanel = new MessageDetailPanel();

        statusBar = new JLabel(" Hazır");
        statusBar.setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createMatteBorder(1, 0, 0, 0, UIManager.getColor("Separator.foreground")),
                BorderFactory.createEmptyBorder(4, 8, 4, 8)));

        JSplitPane splitPane = new JSplitPane(JSplitPane.HORIZONTAL_SPLIT, messageTablePanel, messageDetailPanel);
        splitPane.setDividerLocation(450);
        splitPane.setResizeWeight(0.4);

        setLayout(new BorderLayout(0, 0));
        add(connectionPanel, BorderLayout.NORTH);
        add(splitPane, BorderLayout.CENTER);
        add(statusBar, BorderLayout.SOUTH);

        wireEvents();
    }

    private void wireEvents() {
        connectionPanel.addTestButtonListener(e -> onTestConnection());
        connectionPanel.addBrowseButtonListener(e -> onBrowseMessages());

        messageTablePanel.getTable().getSelectionModel().addListSelectionListener(e -> {
            if (!e.getValueIsAdjusting()) {
                MqMessage selected = messageTablePanel.getSelectedMessage();
                messageDetailPanel.showMessage(selected);
            }
        });
    }

    private void onTestConnection() {
        connectionPanel.setButtonsEnabled(false);
        statusBar.setText(" Bağlantı testi yapılıyor...");

        SwingWorker<String, Void> worker = new SwingWorker<>() {
            @Override
            protected String doInBackground() {
                return mqService.testConnection(connectionPanel.getConfig());
            }

            @Override
            protected void done() {
                try {
                    String result = get();
                    statusBar.setText(" " + result);
                    if (result.startsWith("Bağlantı başarılı")) {
                        JOptionPane.showMessageDialog(MainFrame.this, result, "Başarılı",
                                JOptionPane.INFORMATION_MESSAGE);
                    } else {
                        JOptionPane.showMessageDialog(MainFrame.this, result, "Hata", JOptionPane.ERROR_MESSAGE);
                    }
                } catch (Exception ex) {
                    statusBar.setText(" Hata: " + ex.getMessage());
                    JOptionPane.showMessageDialog(MainFrame.this, "Beklenmeyen hata: " + ex.getMessage(), "Hata",
                            JOptionPane.ERROR_MESSAGE);
                } finally {
                    connectionPanel.setButtonsEnabled(true);
                }
            }
        };
        worker.execute();
    }

    private void onBrowseMessages() {
        String queueName = connectionPanel.getConfig().getQueueName();
        if (queueName == null || queueName.isBlank()) {
            JOptionPane.showMessageDialog(this, "Lütfen bir kuyruk adı girin.", "Uyarı", JOptionPane.WARNING_MESSAGE);
            return;
        }

        connectionPanel.setButtonsEnabled(false);
        messageTablePanel.clearMessages();
        messageDetailPanel.clear();
        statusBar.setText(" Mesajlar okunuyor...");

        int limit = connectionPanel.getMessageLimit();

        SwingWorker<List<MqMessage>, Void> worker = new SwingWorker<>() {
            @Override
            protected List<MqMessage> doInBackground() throws Exception {
                return mqService.browseMessages(connectionPanel.getConfig(), limit);
            }

            @Override
            protected void done() {
                try {
                    List<MqMessage> messages = get();
                    messageTablePanel.setMessages(messages);
                    statusBar.setText(" " + messages.size() + " mesaj bulundu.");
                    if (messages.isEmpty()) {
                        JOptionPane.showMessageDialog(MainFrame.this, "Kuyrukta mesaj bulunamadı.", "Bilgi",
                                JOptionPane.INFORMATION_MESSAGE);
                    }
                } catch (Exception ex) {
                    String errorMsg = ex.getCause() != null ? ex.getCause().getMessage() : ex.getMessage();
                    statusBar.setText(" Hata: " + errorMsg);
                    JOptionPane.showMessageDialog(MainFrame.this, "Mesajlar okunamadı:\n" + errorMsg, "Hata",
                            JOptionPane.ERROR_MESSAGE);
                } finally {
                    connectionPanel.setButtonsEnabled(true);
                }
            }
        };
        worker.execute();
    }
}
