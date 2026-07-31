package org.akbal.ui;

import org.akbal.i18n.LocaleManager;
import org.akbal.model.MqMessage;
import org.akbal.service.LiveModeService;
import org.akbal.service.MqService;

import javax.swing.*;
import javax.swing.border.EmptyBorder;
import java.awt.*;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.awt.geom.RoundRectangle2D;
import java.util.List;
import java.util.Locale;

import static org.akbal.i18n.LocaleManager.msg;
import static org.akbal.ui.UIConstants.*;

public class MainFrame extends JFrame {

    private final ConnectionPanel connectionPanel;
    private final MessageTablePanel messageTablePanel;
    private final MessageDetailPanel messageDetailPanel;
    private final JLabel statusLabel;
    private final JLabel statusDot;
    private final JButton langButton;

    private final MqService mqService = new MqService();
    private final LiveModeService liveModeService = new LiveModeService(mqService);

    // Pulse animation for live mode
    private Timer pulseTimer;
    private boolean pulseBright = true;

    public MainFrame() {
        super(msg("app.title"));
        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        setSize(1200, 800);
        setMinimumSize(new Dimension(900, 600));
        setLocationRelativeTo(null);
        getContentPane().setBackground(BG_PRIMARY);

        connectionPanel = new ConnectionPanel();
        messageTablePanel = new MessageTablePanel();
        messageDetailPanel = new MessageDetailPanel();

        // ── Header bar ──────────────────────────────────────────────────────
        JPanel headerBar = new JPanel(new BorderLayout()) {
            @Override
            protected void paintComponent(Graphics g) {
                Graphics2D g2 = (Graphics2D) g.create();
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);

                // Gradient background
                GradientPaint gp = new GradientPaint(0, 0, BG_HEADER, getWidth(), 0, BG_SECONDARY);
                g2.setPaint(gp);
                g2.fillRect(0, 0, getWidth(), getHeight());

                // Bottom accent line
                g2.setColor(ACCENT_DIM);
                g2.fillRect(0, getHeight() - 2, getWidth(), 2);

                g2.dispose();
            }
        };
        headerBar.setPreferredSize(new Dimension(0, 52));
        headerBar.setBorder(new EmptyBorder(0, 20, 0, 20));

        JLabel titleLabel = new JLabel("⚡ " + msg("app.title"));
        titleLabel.setFont(FONT_TITLE);
        titleLabel.setForeground(TEXT_PRIMARY);
        headerBar.add(titleLabel, BorderLayout.WEST);

        // ── Language switcher + version ──────────────────────────────────────
        JPanel headerRight = new JPanel(new FlowLayout(FlowLayout.RIGHT, 10, 0));
        headerRight.setOpaque(false);

        langButton = createStyledButton(msg("lang.switch"), ButtonStyle.OUTLINE);
        langButton.setFont(FONT_BODY_BOLD);
        langButton.setPreferredSize(new Dimension(80, 30));
        langButton.addActionListener(e -> onSwitchLanguage());
        headerRight.add(langButton);

        JLabel versionLabel = new JLabel("v1.0");
        versionLabel.setFont(FONT_SMALL);
        versionLabel.setForeground(TEXT_MUTED);
        headerRight.add(versionLabel);

        headerBar.add(headerRight, BorderLayout.EAST);

        // ── Status bar ──────────────────────────────────────────────────────
        JPanel statusBar = new JPanel(new BorderLayout()) {
            @Override
            protected void paintComponent(Graphics g) {
                Graphics2D g2 = (Graphics2D) g.create();
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                g2.setColor(BG_HEADER);
                g2.fillRect(0, 0, getWidth(), getHeight());

                // Top accent line
                g2.setColor(BORDER_SUBTLE);
                g2.fillRect(0, 0, getWidth(), 1);
                g2.dispose();
            }
        };
        statusBar.setPreferredSize(new Dimension(0, 32));
        statusBar.setBorder(new EmptyBorder(0, 16, 0, 16));

        statusDot = new JLabel("●") {
            @Override
            protected void paintComponent(Graphics g) {
                Graphics2D g2 = (Graphics2D) g.create();
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                g2.setColor(getForeground());
                g2.fill(new RoundRectangle2D.Float(4, (getHeight() - 8) / 2f, 8, 8, 8, 8));
                g2.dispose();
            }
        };
        statusDot.setForeground(ACCENT);
        statusDot.setPreferredSize(new Dimension(18, 18));

        statusLabel = new JLabel(msg("status.ready"));
        statusLabel.setFont(FONT_SMALL);
        statusLabel.setForeground(TEXT_SECONDARY);

        JPanel statusLeftPanel = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        statusLeftPanel.setOpaque(false);
        statusLeftPanel.add(statusDot);
        statusLeftPanel.add(statusLabel);

        statusBar.add(statusLeftPanel, BorderLayout.WEST);

        // ── Split pane ──────────────────────────────────────────────────────
        JSplitPane splitPane = new JSplitPane(JSplitPane.HORIZONTAL_SPLIT, messageTablePanel, messageDetailPanel);
        splitPane.setDividerLocation(500);
        splitPane.setResizeWeight(0.45);
        splitPane.setBorder(null);
        splitPane.setDividerSize(6);
        splitPane.setBackground(BG_PRIMARY);

        // ── Content panel ───────────────────────────────────────────────────
        JPanel contentPanel = new JPanel(new BorderLayout(0, 0));
        contentPanel.setOpaque(false);
        contentPanel.setBorder(new EmptyBorder(4, 8, 4, 8));
        contentPanel.add(splitPane, BorderLayout.CENTER);

        // ── Connection panel wrapper ────────────────────────────────────────
        JPanel connectionWrapper = new JPanel(new BorderLayout());
        connectionWrapper.setOpaque(false);
        connectionWrapper.add(connectionPanel, BorderLayout.CENTER);

        // ── Assemble frame ──────────────────────────────────────────────────
        setLayout(new BorderLayout(0, 0));
        add(headerBar, BorderLayout.NORTH);

        JPanel mainContent = new JPanel(new BorderLayout(0, 0));
        mainContent.setBackground(BG_PRIMARY);
        mainContent.add(connectionWrapper, BorderLayout.NORTH);
        mainContent.add(contentPanel, BorderLayout.CENTER);

        add(mainContent, BorderLayout.CENTER);
        add(statusBar, BorderLayout.SOUTH);

        wireEvents();

        // Stop live mode when window is closing
        addWindowListener(new WindowAdapter() {
            @Override
            public void windowClosing(WindowEvent e) {
                stopLiveMode();
            }
        });
    }

    private void wireEvents() {
        connectionPanel.addTestButtonListener(e -> onTestConnection());
        connectionPanel.addBrowseButtonListener(e -> onBrowseMessages());
        connectionPanel.addLiveButtonListener(e -> onToggleLiveMode());

        messageTablePanel.getTable().getSelectionModel().addListSelectionListener(e -> {
            if (!e.getValueIsAdjusting()) {
                MqMessage selected = messageTablePanel.getSelectedMessage();
                messageDetailPanel.showMessage(selected);
            }
        });
    }

    private void setStatus(String text, Color dotColor) {
        statusLabel.setText(text);
        statusDot.setForeground(dotColor);
        statusDot.repaint();
    }

    // ── Pulse animation for live mode ───────────────────────────────────────

    private void startPulseAnimation() {
        if (pulseTimer != null) pulseTimer.stop();
        pulseBright = true;
        pulseTimer = new Timer(600, e -> {
            pulseBright = !pulseBright;
            statusDot.setForeground(pulseBright ? ACCENT : ACCENT_DIM);
            statusDot.repaint();
        });
        pulseTimer.start();
    }

    private void stopPulseAnimation() {
        if (pulseTimer != null) {
            pulseTimer.stop();
            pulseTimer = null;
        }
    }

    // ── Language switching ───────────────────────────────────────────────────

    private void onSwitchLanguage() {
        LocaleManager lm = LocaleManager.getInstance();
        Locale current = lm.getLocale();
        Locale next = current.getLanguage().equals("tr") ? Locale.ENGLISH : Locale.of("tr");
        lm.setLocale(next);

        // Recreate the frame with the new locale
        SwingUtilities.invokeLater(() -> {
            Point location = getLocation();
            Dimension size = getSize();
            stopLiveMode();
            dispose();

            MainFrame newFrame = new MainFrame();
            newFrame.setLocation(location);
            newFrame.setSize(size);
            newFrame.setVisible(true);
        });
    }

    // ── Live mode ───────────────────────────────────────────────────────────

    private void onToggleLiveMode() {
        if (liveModeService.isRunning()) {
            stopLiveMode();
        } else {
            startLiveMode();
        }
    }

    private void startLiveMode() {
        String queueName = connectionPanel.getConfig().getQueueName();
        if (queueName == null || queueName.isBlank()) {
            JOptionPane.showMessageDialog(this, msg("conn.dialog.queue_required"),
                    msg("dialog.warning"), JOptionPane.WARNING_MESSAGE);
            return;
        }

        connectionPanel.setLiveMode(true);
        langButton.setEnabled(false);
        messageTablePanel.clearMessages();
        messageDetailPanel.clear();
        setStatus(msg("live.status.connecting"), UIConstants.WARNING);
        startPulseAnimation();

        liveModeService.start(
                connectionPanel.getConfig(),
                connectionPanel.getMessageLimit(),
                // onNewMessages
                (newMessages, totalCount) -> {
                    messageTablePanel.addMessages(newMessages);
                    setStatus(msg("live.status", totalCount), ACCENT);
                },
                // onError
                (errorMsg) -> {
                    setStatus(msg("live.status.error", errorMsg), UIConstants.ERROR);
                },
                // onAutoStopped
                () -> {
                    stopLiveMode();
                    setStatus(msg("live.status.auto_stopped"), UIConstants.ERROR);
                    JOptionPane.showMessageDialog(MainFrame.this,
                            msg("live.status.auto_stopped"),
                            msg("dialog.error"), JOptionPane.ERROR_MESSAGE);
                }
        );
    }

    private void stopLiveMode() {
        liveModeService.stop();
        stopPulseAnimation();
        connectionPanel.setLiveMode(false);
        langButton.setEnabled(true);
        setStatus(msg("status.ready"), ACCENT);
    }

    // ── Connection test ─────────────────────────────────────────────────────

    private void onTestConnection() {
        connectionPanel.setButtonsEnabled(false);
        setStatus(msg("status.testing"), UIConstants.WARNING);

        SwingWorker<String, Void> worker = new SwingWorker<>() {
            @Override
            protected String doInBackground() {
                return mqService.testConnection(connectionPanel.getConfig());
            }

            @Override
            protected void done() {
                try {
                    String result = get();
                    if (result.startsWith(msg("mq.connection_success", "").trim())) {
                        setStatus(result, UIConstants.SUCCESS);
                        JOptionPane.showMessageDialog(MainFrame.this, result,
                                msg("dialog.success"), JOptionPane.INFORMATION_MESSAGE);
                    } else {
                        setStatus(result, UIConstants.ERROR);
                        JOptionPane.showMessageDialog(MainFrame.this, result,
                                msg("dialog.error"), JOptionPane.ERROR_MESSAGE);
                    }
                } catch (Exception ex) {
                    setStatus(msg("status.error", ex.getMessage()), UIConstants.ERROR);
                    JOptionPane.showMessageDialog(MainFrame.this,
                            msg("dialog.unexpected_error", ex.getMessage()),
                            msg("dialog.error"), JOptionPane.ERROR_MESSAGE);
                } finally {
                    connectionPanel.setButtonsEnabled(true);
                }
            }
        };
        worker.execute();
    }

    // ── Browse messages ─────────────────────────────────────────────────────

    private void onBrowseMessages() {
        String queueName = connectionPanel.getConfig().getQueueName();
        if (queueName == null || queueName.isBlank()) {
            JOptionPane.showMessageDialog(this, msg("conn.dialog.queue_required"),
                    msg("dialog.warning"), JOptionPane.WARNING_MESSAGE);
            return;
        }

        connectionPanel.setButtonsEnabled(false);
        messageTablePanel.clearMessages();
        messageDetailPanel.clear();
        setStatus(msg("status.reading"), UIConstants.WARNING);

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
                    setStatus(msg("status.messages_found", messages.size()), UIConstants.SUCCESS);
                    if (messages.isEmpty()) {
                        JOptionPane.showMessageDialog(MainFrame.this, msg("msg.no_messages"),
                                msg("dialog.info"), JOptionPane.INFORMATION_MESSAGE);
                    }
                } catch (Exception ex) {
                    String errorMsg = ex.getCause() != null ? ex.getCause().getMessage() : ex.getMessage();
                    setStatus(msg("status.error", errorMsg), UIConstants.ERROR);
                    JOptionPane.showMessageDialog(MainFrame.this, msg("msg.read_error", errorMsg),
                            msg("dialog.error"), JOptionPane.ERROR_MESSAGE);
                } finally {
                    connectionPanel.setButtonsEnabled(true);
                }
            }
        };
        worker.execute();
    }
}
