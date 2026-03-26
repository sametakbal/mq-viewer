package org.akbal.ui;

import org.akbal.model.MqMessage;

import javax.swing.*;
import java.awt.*;
import java.time.format.DateTimeFormatter;

public class MessageDetailPanel extends JPanel {

    private static final DateTimeFormatter DT_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final JLabel messageIdLabel = new JLabel("-");
    private final JLabel correlationIdLabel = new JLabel("-");
    private final JLabel putDateLabel = new JLabel("-");
    private final JLabel formatLabel = new JLabel("-");
    private final JLabel sizeLabel = new JLabel("-");
    private final JTextArea payloadArea = new JTextArea();

    public MessageDetailPanel() {
        setLayout(new BorderLayout(5, 5));
        setBorder(BorderFactory.createTitledBorder("Mesaj Detayı"));

        JPanel metaPanel = new JPanel(new GridBagLayout());
        GridBagConstraints gbc = new GridBagConstraints();
        gbc.insets = new Insets(2, 5, 2, 5);
        gbc.anchor = GridBagConstraints.WEST;

        addMeta(metaPanel, gbc, 0, "Message ID:", messageIdLabel);
        addMeta(metaPanel, gbc, 1, "Correlation ID:", correlationIdLabel);
        addMeta(metaPanel, gbc, 2, "Put Tarih:", putDateLabel);
        addMeta(metaPanel, gbc, 3, "Format:", formatLabel);
        addMeta(metaPanel, gbc, 4, "Boyut:", sizeLabel);

        add(metaPanel, BorderLayout.NORTH);

        payloadArea.setEditable(false);
        payloadArea.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 13));
        payloadArea.setLineWrap(true);
        payloadArea.setWrapStyleWord(true);

        JScrollPane scrollPane = new JScrollPane(payloadArea);
        scrollPane.setBorder(BorderFactory.createTitledBorder("İçerik"));
        add(scrollPane, BorderLayout.CENTER);
    }

    private void addMeta(JPanel panel, GridBagConstraints gbc, int row, String label, JLabel value) {
        gbc.gridx = 0;
        gbc.gridy = row;
        gbc.weightx = 0;
        gbc.fill = GridBagConstraints.NONE;
        JLabel lbl = new JLabel(label);
        lbl.setFont(lbl.getFont().deriveFont(Font.BOLD));
        panel.add(lbl, gbc);

        gbc.gridx = 1;
        gbc.weightx = 1.0;
        gbc.fill = GridBagConstraints.HORIZONTAL;
        panel.add(value, gbc);
    }

    public void showMessage(MqMessage msg) {
        if (msg == null) {
            clear();
            return;
        }
        messageIdLabel.setText(msg.getMessageId());
        correlationIdLabel.setText(msg.getCorrelationId());
        putDateLabel.setText(msg.getPutDateTime() != null ? msg.getPutDateTime().format(DT_FMT) : "-");
        formatLabel.setText(msg.getFormat());
        sizeLabel.setText(msg.getSize() + " byte");
        payloadArea.setText(msg.getPayload());
        payloadArea.setCaretPosition(0);
    }

    public void clear() {
        messageIdLabel.setText("-");
        correlationIdLabel.setText("-");
        putDateLabel.setText("-");
        formatLabel.setText("-");
        sizeLabel.setText("-");
        payloadArea.setText("");
    }
}
