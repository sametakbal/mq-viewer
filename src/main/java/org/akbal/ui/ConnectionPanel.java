package org.akbal.ui;

import org.akbal.model.MqConnectionConfig;
import org.akbal.service.ConnectionStore;

import javax.swing.*;
import java.awt.*;
import java.awt.event.ActionListener;
import java.util.List;

public class ConnectionPanel extends JPanel {

    private final JComboBox<MqConnectionConfig> savedConnectionsCombo = new JComboBox<>();
    private final JButton loadButton = new JButton("Yükle");
    private final JButton saveButton = new JButton("Kaydet");
    private final JButton deleteButton = new JButton("Sil");

    private final JTextField hostField = new JTextField("localhost", 15);
    private final JTextField portField = new JTextField("1414", 6);
    private final JTextField channelField = new JTextField("DEV.ADMIN.SVRCONN", 15);
    private final JTextField queueManagerField = new JTextField(15);
    private final JTextField queueNameField = new JTextField(15);
    private final JTextField usernameField = new JTextField(10);
    private final JPasswordField passwordField = new JPasswordField(10);
    private final JSpinner limitSpinner = new JSpinner(new SpinnerNumberModel(100, 1, 10000, 10));

    private final JButton testButton = new JButton("Bağlantı Testi");
    private final JButton browseButton = new JButton("Mesajları Getir");

    private final ConnectionStore connectionStore = new ConnectionStore();

    public ConnectionPanel() {
        setLayout(new BorderLayout(5, 5));
        setBorder(BorderFactory.createTitledBorder("IBM MQ Bağlantı Ayarları"));

        // Saved connections row
        JPanel savedPanel = new JPanel(new FlowLayout(FlowLayout.LEFT, 5, 3));
        savedPanel.add(new JLabel("Kayıtlı Bağlantılar:"));
        savedConnectionsCombo.setPreferredSize(new Dimension(250, 28));
        savedPanel.add(savedConnectionsCombo);
        loadButton.setPreferredSize(new Dimension(70, 28));
        saveButton.setPreferredSize(new Dimension(70, 28));
        deleteButton.setPreferredSize(new Dimension(55, 28));
        savedPanel.add(loadButton);
        savedPanel.add(saveButton);
        savedPanel.add(deleteButton);

        // Fields
        JPanel fieldsPanel = new JPanel(new GridBagLayout());
        GridBagConstraints gbc = new GridBagConstraints();
        gbc.insets = new Insets(3, 5, 3, 5);
        gbc.anchor = GridBagConstraints.WEST;

        // Row 0
        addField(fieldsPanel, gbc, 0, 0, "Host:", hostField);
        addField(fieldsPanel, gbc, 2, 0, "Port:", portField);
        addField(fieldsPanel, gbc, 4, 0, "Channel:", channelField);

        // Row 1
        addField(fieldsPanel, gbc, 0, 1, "Queue Manager:", queueManagerField);
        addField(fieldsPanel, gbc, 2, 1, "Queue Name:", queueNameField);
        addField(fieldsPanel, gbc, 4, 1, "Limit:", limitSpinner);

        // Row 2
        addField(fieldsPanel, gbc, 0, 2, "Kullanıcı:", usernameField);
        addField(fieldsPanel, gbc, 2, 2, "Şifre:", passwordField);

        JPanel topPanel = new JPanel(new BorderLayout());
        topPanel.add(savedPanel, BorderLayout.NORTH);
        topPanel.add(fieldsPanel, BorderLayout.CENTER);

        add(topPanel, BorderLayout.CENTER);

        JPanel buttonPanel = new JPanel(new FlowLayout(FlowLayout.RIGHT, 10, 5));
        testButton.setPreferredSize(new Dimension(140, 32));
        browseButton.setPreferredSize(new Dimension(140, 32));
        buttonPanel.add(testButton);
        buttonPanel.add(browseButton);
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
        panel.add(new JLabel(label), gbc);

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
        String name = JOptionPane.showInputDialog(this, "Bağlantı adı:", "Bağlantıyı Kaydet",
                JOptionPane.PLAIN_MESSAGE);
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

        JOptionPane.showMessageDialog(this, "Bağlantı kaydedildi: " + name, "Başarılı",
                JOptionPane.INFORMATION_MESSAGE);
    }

    private void onDeleteConnection() {
        MqConnectionConfig selected = (MqConnectionConfig) savedConnectionsCombo.getSelectedItem();
        if (selected == null)
            return;

        int confirm = JOptionPane.showConfirmDialog(this,
                "\"" + selected.getName() + "\" bağlantısını silmek istediğinize emin misiniz?",
                "Bağlantıyı Sil", JOptionPane.YES_NO_OPTION, JOptionPane.WARNING_MESSAGE);
        if (confirm == JOptionPane.YES_OPTION) {
            connectionStore.delete(selected.getName());
            refreshSavedConnections();
        }
    }
}
