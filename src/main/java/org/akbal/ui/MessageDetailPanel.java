package org.akbal.ui;

import org.akbal.model.MqMessage;

import javax.swing.*;
import javax.swing.border.EmptyBorder;
import java.awt.*;
import java.time.format.DateTimeFormatter;

import static org.akbal.i18n.LocaleManager.msg;
import static org.akbal.ui.UIConstants.*;

public class MessageDetailPanel extends JPanel {

    private static final DateTimeFormatter DT_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final JLabel messageIdLabel = new JLabel("-");
    private final JLabel correlationIdLabel = new JLabel("-");
    private final JLabel putDateLabel = new JLabel("-");
    private final JLabel formatLabel = new JLabel("-");
    private final JLabel sizeLabel = new JLabel("-");
    private final JTextArea payloadArea = new JTextArea();

    public MessageDetailPanel() {
        setLayout(new BorderLayout(0, 6));
        setOpaque(false);
        setBorder(new EmptyBorder(0, 0, 0, 0));

        // ── Section header ──────────────────────────────────────────────────
        JPanel header = createSectionHeader("📄", msg("detail.section_title"));
        header.setBorder(new EmptyBorder(8, 12, 4, 12));

        // ── Meta card ───────────────────────────────────────────────────────
        JPanel metaCard = createCardPanel();
        metaCard.setLayout(new GridBagLayout());
        GridBagConstraints gbc = new GridBagConstraints();
        gbc.insets = new Insets(4, 8, 4, 8);
        gbc.anchor = GridBagConstraints.WEST;

        styleValueLabel(messageIdLabel);
        styleValueLabel(correlationIdLabel);
        styleValueLabel(putDateLabel);
        styleValueLabel(formatLabel);
        styleValueLabel(sizeLabel);

        addMeta(metaCard, gbc, 0, msg("detail.message_id"), messageIdLabel);
        addMeta(metaCard, gbc, 1, msg("detail.correlation_id"), correlationIdLabel);
        addMeta(metaCard, gbc, 2, msg("detail.put_date"), putDateLabel);
        addMeta(metaCard, gbc, 3, msg("detail.format"), formatLabel);
        addMeta(metaCard, gbc, 4, msg("detail.size"), sizeLabel);

        JPanel metaWrapper = new JPanel(new BorderLayout());
        metaWrapper.setOpaque(false);
        metaWrapper.setBorder(new EmptyBorder(0, 8, 0, 8));
        metaWrapper.add(metaCard, BorderLayout.NORTH);

        // ── Payload area ────────────────────────────────────────────────────
        payloadArea.setEditable(false);
        payloadArea.setFont(FONT_MONO);
        payloadArea.setForeground(TEXT_PRIMARY);
        payloadArea.setBackground(BG_INPUT);
        payloadArea.setCaretColor(ACCENT);
        payloadArea.setSelectionColor(ACCENT_DIM);
        payloadArea.setSelectedTextColor(Color.WHITE);
        payloadArea.setLineWrap(true);
        payloadArea.setWrapStyleWord(true);
        payloadArea.setBorder(new EmptyBorder(12, 14, 12, 14));

        JScrollPane scrollPane = new JScrollPane(payloadArea);
        scrollPane.setBorder(BorderFactory.createLineBorder(BORDER_SUBTLE));
        scrollPane.getViewport().setBackground(BG_INPUT);

        JPanel payloadPanel = new JPanel(new BorderLayout(0, 4));
        payloadPanel.setOpaque(false);
        payloadPanel.setBorder(new EmptyBorder(4, 8, 8, 8));

        JPanel payloadHeader = createSectionHeader("📦", msg("detail.content"));
        payloadHeader.setBorder(new EmptyBorder(4, 4, 4, 0));
        payloadPanel.add(payloadHeader, BorderLayout.NORTH);
        payloadPanel.add(scrollPane, BorderLayout.CENTER);

        // ── Assemble ────────────────────────────────────────────────────────
        add(header, BorderLayout.NORTH);

        JPanel centerPanel = new JPanel(new BorderLayout(0, 4));
        centerPanel.setOpaque(false);
        centerPanel.add(metaWrapper, BorderLayout.NORTH);
        centerPanel.add(payloadPanel, BorderLayout.CENTER);
        add(centerPanel, BorderLayout.CENTER);
    }

    private void styleValueLabel(JLabel label) {
        label.setFont(FONT_BODY);
        label.setForeground(TEXT_PRIMARY);
    }

    private void addMeta(JPanel panel, GridBagConstraints gbc, int row, String label, JLabel value) {
        gbc.gridx = 0;
        gbc.gridy = row;
        gbc.weightx = 0;
        gbc.fill = GridBagConstraints.NONE;
        JLabel lbl = new JLabel(label);
        lbl.setFont(FONT_BODY_BOLD);
        lbl.setForeground(ACCENT);
        panel.add(lbl, gbc);

        gbc.gridx = 1;
        gbc.weightx = 1.0;
        gbc.fill = GridBagConstraints.HORIZONTAL;
        panel.add(value, gbc);
    }

    public void showMessage(MqMessage mqMsg) {
        if (mqMsg == null) {
            clear();
            return;
        }
        messageIdLabel.setText(mqMsg.getMessageId());
        correlationIdLabel.setText(mqMsg.getCorrelationId());
        putDateLabel.setText(mqMsg.getPutDateTime() != null ? mqMsg.getPutDateTime().format(DT_FMT) : "-");
        formatLabel.setText(mqMsg.getFormat());
        sizeLabel.setText(msg("detail.size_unit", mqMsg.getSize()));
        payloadArea.setText(mqMsg.getPayload());
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
