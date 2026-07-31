package org.akbal.ui;

import org.akbal.model.MqConnectionConfig;
import org.akbal.service.ConnectionStore;

import javax.swing.*;
import javax.swing.border.EmptyBorder;
import java.awt.*;
import java.awt.event.ActionListener;
import java.util.List;

import static org.akbal.i18n.LocaleManager.msg;
import static org.akbal.ui.UIConstants.*;

public class ConnectionPanel extends JPanel {

    private final JComboBox<MqConnectionConfig> savedConnectionsCombo = new JComboBox<>();
    private final JButton loadButton;
    private final JButton saveButton;
    private final JButton deleteButton;

    private final JTextField hostField = new JTextField("localhost", 15);
    private final JTextField portField = new JTextField("1414", 6);
    private final JTextField channelField = new JTextField("DEV.ADMIN.SVRCONN", 15);
    private final JTextField queueManagerField = new JTextField(15);
    private final JTextField queueNameField = new JTextField(15);
    private final JTextField usernameField = new JTextField(10);
    private final JPasswordField passwordField = new JPasswordField(10);
    private final JSpinner limitSpinner = new JSpinner(new SpinnerNumberModel(100, 1, 10000, 10));

    private final JButton testButton;
    private final JButton browseButton;
    private final JButton liveButton;

    private final ConnectionStore connectionStore = new ConnectionStore();

    public ConnectionPanel() {
        setLayout(new BorderLayout(0, 4));
        setOpaque(false);
        setBorder(new EmptyBorder(PANEL_INSETS));

        // ── Styled buttons ──────────────────────────────────────────────────
        loadButton = createStyledButton(msg("conn.btn.load"), ButtonStyle.SUBTLE);
        saveButton = createStyledButton(msg("conn.btn.save"), ButtonStyle.SUBTLE);
        deleteButton = createStyledButton(msg("conn.btn.delete"), ButtonStyle.SUBTLE);
        testButton = createStyledButton(msg("conn.btn.test"), ButtonStyle.OUTLINE);
        browseButton = createStyledButton(msg("conn.btn.browse"), ButtonStyle.FILLED);
        liveButton = createStyledButton(msg("live.btn.start"), ButtonStyle.OUTLINE);

        loadButton.setPreferredSize(new Dimension(90, BUTTON_HEIGHT));
        saveButton.setPreferredSize(new Dimension(100, BUTTON_HEIGHT));
        deleteButton.setPreferredSize(new Dimension(75, BUTTON_HEIGHT));
        testButton.setPreferredSize(new Dimension(170, BUTTON_HEIGHT));
        browseButton.setPreferredSize(new Dimension(180, BUTTON_HEIGHT));
        liveButton.setPreferredSize(new Dimension(120, BUTTON_HEIGHT));

        // ── Style all inputs ────────────────────────────────────────────────
        styleTextField(hostField);
        styleTextField(portField);
        styleTextField(channelField);
        styleTextField(queueManagerField);
        styleTextField(queueNameField);
        styleTextField(usernameField);
        styleTextField(passwordField);
        styleSpinner(limitSpinner);
        styleComboBox(savedConnectionsCombo);

        // ── Section header ──────────────────────────────────────────────────
        JPanel sectionHeader = createSectionHeader("🔗", msg("conn.section_title"));

        // ── Saved connections row ───────────────────────────────────────────
        JPanel savedPanel = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 4));
        savedPanel.setOpaque(false);

        JLabel savedLabel = new JLabel(msg("conn.saved"));
        savedLabel.setFont(FONT_BODY);
        savedLabel.setForeground(TEXT_SECONDARY);
        savedPanel.add(savedLabel);

        savedConnectionsCombo.setPreferredSize(new Dimension(260, INPUT_HEIGHT));
        savedPanel.add(savedConnectionsCombo);
        savedPanel.add(loadButton);
        savedPanel.add(saveButton);
        savedPanel.add(deleteButton);

        // ── Fields grid ─────────────────────────────────────────────────────
        JPanel fieldsCard = createCardPanel();
        fieldsCard.setLayout(new GridBagLayout());
        GridBagConstraints gbc = new GridBagConstraints();
        gbc.insets = new Insets(6, 8, 6, 8);
        gbc.anchor = GridBagConstraints.WEST;

        // Row 0
        addField(fieldsCard, gbc, 0, 0, msg("conn.label.host"), hostField);
        addField(fieldsCard, gbc, 2, 0, msg("conn.label.port"), portField);
        addField(fieldsCard, gbc, 4, 0, msg("conn.label.channel"), channelField);

        // Row 1
        addField(fieldsCard, gbc, 0, 1, msg("conn.label.queue_manager"), queueManagerField);
        addField(fieldsCard, gbc, 2, 1, msg("conn.label.queue_name"), queueNameField);
        addField(fieldsCard, gbc, 4, 1, msg("conn.label.limit"), limitSpinner);

        // Row 2
        addField(fieldsCard, gbc, 0, 2, msg("conn.label.username"), usernameField);
        addField(fieldsCard, gbc, 2, 2, msg("conn.label.password"), passwordField);

        // ── Buttons row ─────────────────────────────────────────────────────
        JPanel buttonPanel = new JPanel(new FlowLayout(FlowLayout.RIGHT, 12, 6));
        buttonPanel.setOpaque(false);
        buttonPanel.add(testButton);
        buttonPanel.add(browseButton);
        buttonPanel.add(liveButton);

        // ── Assemble ────────────────────────────────────────────────────────
        JPanel topPanel = new JPanel(new BorderLayout(0, 4));
        topPanel.setOpaque(false);
        topPanel.add(sectionHeader, BorderLayout.NORTH);

        JPanel innerPanel = new JPanel(new BorderLayout(0, 8));
        innerPanel.setOpaque(false);
        innerPanel.add(savedPanel, BorderLayout.NORTH);
        innerPanel.add(fieldsCard, BorderLayout.CENTER);

        topPanel.add(innerPanel, BorderLayout.CENTER);

        add(topPanel, BorderLayout.CENTER);
        add(buttonPanel, BorderLayout.SOUTH);

        // Wire save/load/delete
        loadButton.addActionListener(e -> onLoadSelected());
        saveButton.addActionListener(e -> onSaveConnection());
        deleteButton.addActionListener(e -> onDeleteConnection());

        refreshSavedConnections();
    }

    private void addField(JPanel panel, GridBagConstraints gbc, int x, int y, String label, JComponent field) {
        gbc.gridx = x;
        gbc.gridy = y;
        gbc.fill = GridBagConstraints.NONE;
        gbc.weightx = 0;
        JLabel lbl = new JLabel(label);
        lbl.setFont(FONT_BODY);
        lbl.setForeground(TEXT_SECONDARY);
        panel.add(lbl, gbc);

        gbc.gridx = x + 1;
        gbc.fill = GridBagConstraints.HORIZONTAL;
        gbc.weightx = 1.0;
        panel.add(field, gbc);
    }

    public MqConnectionConfig getConfig() {
        MqConnectionConfig config = new MqConnectionConfig();
        config.setHost(hostField.getText().trim());
        try {
            config.setPort(Integer.parseInt(portField.getText().trim()));
        } catch (NumberFormatException e) {
            config.setPort(1414);
        }
        config.setChannel(channelField.getText().trim());
        config.setQueueManager(queueManagerField.getText().trim());
        config.setQueueName(queueNameField.getText().trim());
        config.setUsername(usernameField.getText().trim());
        config.setPassword(new String(passwordField.getPassword()));
        return config;
    }

    public int getMessageLimit() {
        return (int) limitSpinner.getValue();
    }

    public void addTestButtonListener(ActionListener listener) {
        testButton.addActionListener(listener);
    }

    public void addBrowseButtonListener(ActionListener listener) {
        browseButton.addActionListener(listener);
    }

    public void setButtonsEnabled(boolean enabled) {
        testButton.setEnabled(enabled);
        browseButton.setEnabled(enabled);
        liveButton.setEnabled(enabled);
    }

    public void addLiveButtonListener(ActionListener listener) {
        liveButton.addActionListener(listener);
    }

    /** Updates UI state for live mode on/off. */
    public void setLiveMode(boolean active) {
        liveButton.setText(active ? msg("live.btn.stop") : msg("live.btn.start"));
        testButton.setEnabled(!active);
        browseButton.setEnabled(!active);
        loadButton.setEnabled(!active);
        saveButton.setEnabled(!active);
        deleteButton.setEnabled(!active);

        // Disable/enable all input fields
        hostField.setEnabled(!active);
        portField.setEnabled(!active);
        channelField.setEnabled(!active);
        queueManagerField.setEnabled(!active);
        queueNameField.setEnabled(!active);
        usernameField.setEnabled(!active);
        passwordField.setEnabled(!active);
        limitSpinner.setEnabled(!active);
        savedConnectionsCombo.setEnabled(!active);
    }

    public void setConfig(MqConnectionConfig config) {
        hostField.setText(config.getHost());
        portField.setText(String.valueOf(config.getPort()));
        channelField.setText(config.getChannel());
        queueManagerField.setText(config.getQueueManager());
        queueNameField.setText(config.getQueueName());
        usernameField.setText(config.getUsername());
        passwordField.setText(config.getPassword());
    }

    private void refreshSavedConnections() {
        savedConnectionsCombo.removeAllItems();
        List<MqConnectionConfig> saved = connectionStore.loadAll();
        for (MqConnectionConfig c : saved) {
            savedConnectionsCombo.addItem(c);
        }
        deleteButton.setEnabled(savedConnectionsCombo.getItemCount() > 0);
        loadButton.setEnabled(savedConnectionsCombo.getItemCount() > 0);
    }

    private void onLoadSelected() {
        MqConnectionConfig selected = (MqConnectionConfig) savedConnectionsCombo.getSelectedItem();
        if (selected != null) {
            setConfig(selected);
        }
    }

    private void onSaveConnection() {
        String name = JOptionPane.showInputDialog(this, msg("conn.dialog.save_prompt"),
                msg("conn.dialog.save_title"), JOptionPane.PLAIN_MESSAGE);
        if (name == null || name.isBlank())
            return;

        MqConnectionConfig config = getConfig();
        config.setName(name.trim());
        connectionStore.addOrUpdate(config);
        refreshSavedConnections();

        // Select the saved one
        for (int i = 0; i < savedConnectionsCombo.getItemCount(); i++) {
            if (savedConnectionsCombo.getItemAt(i).getName().equals(name.trim())) {
                savedConnectionsCombo.setSelectedIndex(i);
                break;
            }
        }

        JOptionPane.showMessageDialog(this, msg("conn.dialog.save_success", name),
                msg("dialog.success"), JOptionPane.INFORMATION_MESSAGE);
    }

    private void onDeleteConnection() {
        MqConnectionConfig selected = (MqConnectionConfig) savedConnectionsCombo.getSelectedItem();
        if (selected == null)
            return;

        int confirm = JOptionPane.showConfirmDialog(this,
                msg("conn.dialog.delete_confirm", selected.getName()),
                msg("conn.dialog.delete_title"), JOptionPane.YES_NO_OPTION, JOptionPane.WARNING_MESSAGE);
        if (confirm == JOptionPane.YES_OPTION) {
            connectionStore.delete(selected.getName());
            refreshSavedConnections();
        }
    }
}
